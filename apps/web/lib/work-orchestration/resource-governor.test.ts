import {
  buildHostObservedGateEvidence,
  type MachineSnapshotV1,
  type ObservedGateInput,
  type WorkEvent,
} from '@anima/core';
import type { Json } from '@anima/types';
import { composeHostResourceGovernorView } from './resource-governor';

let seq = 0;
const gateEvidenceEvent = (attemptId: string, gates: ObservedGateInput[], observedAt = '2026-08-17T12:00:00.000Z'): WorkEvent => {
  const built = buildHostObservedGateEvidence({ workItemId: 'work-1', attemptId, approvedProposalVersion: 2, gates, observedAt });
  if (!built.ok) throw new Error(`fixture inválida: ${built.explanation}`);
  return {
    id: `ev-${++seq}`, workItemId: 'work-1', type: 'host_observed_gate_evidence_recorded',
    author: 'system', proposalVersion: 2,
    payload: { data: { work_item_id: 'work-1', attempt_id: attemptId, approved_proposal_version: 2, evidence: built.value as unknown as Json } },
    occurredAt: new Date(observedAt),
  };
};

const gate = (command: string, durationMs: number): ObservedGateInput =>
  ({ label: command, command, exitCode: 0, durationMs, timedOut: false, cancelled: false });

const snapshot = (freeMemBytes: number): MachineSnapshotV1 =>
  ({ schemaVersion: 1, capturedAt: '2026-08-17T12:00:00.000Z', observer: 'host', totalMemBytes: 16_000, freeMemBytes });

// Histórico da máquina: um gate barato repetido muitas vezes + um caro raro — o cenário
// realista em que "caro" emerge dos próprios dados, não de um threshold universal.
const events: WorkEvent[] = [
  ...Array.from({ length: 9 }, (_, i) => gateEvidenceEvent(`cheap-${i}`, [gate('npm run typecheck', 300)])),
  ...Array.from({ length: 3 }, (_, i) => gateEvidenceEvent(`heavy-${i}`, [gate('npm run test:e2e', 90_000)])),
];

describe('composeHostResourceGovernorView (seam central, ponta a ponta)', () => {
  test('deriva o histórico dos eventos de gate já persistidos e projeta perfis por comando', () => {
    const view = composeHostResourceGovernorView({ events, readSnapshot: () => snapshot(8_000) });
    expect(view.profiles.map(p => p.key.command).sort()).toEqual(['npm run test:e2e', 'npm run typecheck']);
    const typecheck = view.profiles.find(p => p.key.command === 'npm run typecheck')!;
    expect(typecheck.count).toBe(9);
    expect(typecheck.durationMedianMs).toBe(300);
  });

  test('alvo caro + usuário ativo → machine_exclusive_recommended (advisory, não ação)', () => {
    const view = composeHostResourceGovernorView({
      events,
      reserve: { interactiveReserveActive: true, minFreeMemFraction: 0.1, comfortableFreeMemFraction: 0.25 },
      target: { workloadKind: 'gate', command: 'npm run test:e2e', repo: null },
      readSnapshot: () => snapshot(8_000),
    });
    expect(view.advisory?.basis.workloadClass).toBe('high');
    expect(view.advisory?.recommendation).toBe('machine_exclusive_recommended');
  });

  test('alvo barato → safe_to_run mesmo com memória baixa agora', () => {
    const view = composeHostResourceGovernorView({
      events,
      target: { workloadKind: 'gate', command: 'npm run typecheck', repo: null },
      readSnapshot: () => snapshot(400), // pressão alta
    });
    expect(view.advisory?.basis.workloadClass).toBe('low');
    expect(view.advisory?.recommendation).toBe('safe_to_run');
  });

  test('sem histórico (nenhum evento de gate) → insufficient_evidence para o alvo', () => {
    const view = composeHostResourceGovernorView({
      events: [],
      target: { workloadKind: 'gate', command: 'npm run test:e2e', repo: null },
      readSnapshot: () => snapshot(8_000),
    });
    expect(view.advisory?.recommendation).toBe('insufficient_evidence');
    expect(view.profiles).toHaveLength(0);
  });

  test('a pressão da máquina reflete o snapshot vivo injetado', () => {
    expect(composeHostResourceGovernorView({ events, readSnapshot: () => snapshot(400) }).pressure).toBe('high');
    expect(composeHostResourceGovernorView({ events, readSnapshot: () => snapshot(8_000) }).pressure).toBe('low');
  });
});
