import {
  buildHostObservedGateEvidence,
  type MachineSnapshotV1,
  type ObservedGateInput,
  type WorkEvent,
  type WorkItem,
} from '@anima/core';
import type { Json } from '@anima/types';
import { composeHostResourceGovernorView, composeItemGateAdvisory, composeSupervisorResourceAdvisory, declaredGateCommands } from './resource-governor';

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

// Consumidor real do Supervisor: advisory por workload contra o snapshot vivo.
describe('composeSupervisorResourceAdvisory (read-model do supervisor-turn)', () => {
  const advisoryFor = (report: NonNullable<ReturnType<typeof composeSupervisorResourceAdvisory>>, command: string) =>
    report.advisories.find(a => a.key.command === command)?.advisory.recommendation;

  test('histórico insuficiente (nenhum gate observado) → null (nada a aconselhar)', () => {
    expect(composeSupervisorResourceAdvisory({ events: [], readSnapshot: () => snapshot(8_000) })).toBeNull();
  });

  test('múltiplos comandos/perfis → um parecer por workload, relativo ao próprio custo', () => {
    const report = composeSupervisorResourceAdvisory({
      events,
      reserve: { interactiveReserveActive: true, minFreeMemFraction: 0.1, comfortableFreeMemFraction: 0.25 },
      readSnapshot: () => snapshot(8_000), // pressão baixa, mas usuário ativo
    })!;
    expect(report.advisories.map(a => a.key.command).sort()).toEqual(['npm run test:e2e', 'npm run typecheck']);
    // Barato → seguro sempre; caro + usuário ativo → janela de máquina exclusiva.
    expect(advisoryFor(report, 'npm run typecheck')).toBe('safe_to_run');
    expect(advisoryFor(report, 'npm run test:e2e')).toBe('machine_exclusive_recommended');
  });

  test('máquina sob baixa pressão, workload caro sem reserva ativa → safe_to_run', () => {
    const report = composeSupervisorResourceAdvisory({ events, readSnapshot: () => snapshot(8_000) })!;
    expect(report.pressure).toBe('low');
    expect(advisoryFor(report, 'npm run test:e2e')).toBe('safe_to_run');
  });

  test('máquina sob pressão, workload caro → machine_exclusive_recommended', () => {
    const report = composeSupervisorResourceAdvisory({ events, readSnapshot: () => snapshot(400) })!;
    expect(report.pressure).toBe('high');
    expect(advisoryFor(report, 'npm run test:e2e')).toBe('machine_exclusive_recommended');
    // Barato segue seguro mesmo sob pressão: o custo do workload domina.
    expect(advisoryFor(report, 'npm run typecheck')).toBe('safe_to_run');
  });

  test('telemetria parcial (sem memória livre) → pressão unknown, sem inventar número', () => {
    const partial: MachineSnapshotV1 = { schemaVersion: 1, capturedAt: '2026-08-17T12:00:00.000Z', observer: 'host', cpuCount: 8 };
    const report = composeSupervisorResourceAdvisory({ events, readSnapshot: () => partial })!;
    expect(report.pressure).toBe('unknown');
    // Custo conhecido ainda aconselha; a pressão unknown apenas não escala a recomendação.
    expect(advisoryFor(report, 'npm run typecheck')).toBe('safe_to_run');
  });

  test('a distribuição de referência acompanha o report (o que "caro" significa aqui)', () => {
    const report = composeSupervisorResourceAdvisory({ events, readSnapshot: () => snapshot(8_000) })!;
    expect(report.distribution.count).toBe(12);
    expect(report.distribution.maxMs).toBe(90_000);
  });

  test('determinismo com snapshot injetado: recomputar dá o mesmo report', () => {
    const once = composeSupervisorResourceAdvisory({ events, readSnapshot: () => snapshot(400) });
    const twice = composeSupervisorResourceAdvisory({ events, readSnapshot: () => snapshot(400) });
    expect(once).toEqual(twice);
  });

  test('MACHINE-WIDE: o mesmo comando em itens DIFERENTES vira um único perfil (custo é da máquina)', () => {
    const forItem = (workItemId: string, attemptId: string, durationMs: number): WorkEvent => {
      const built = buildHostObservedGateEvidence({ workItemId, attemptId, approvedProposalVersion: 2, gates: [gate('npm run typecheck', durationMs)], observedAt: '2026-08-17T12:00:00.000Z' });
      if (!built.ok) throw new Error(`fixture inválida: ${built.explanation}`);
      return {
        id: `mw-${++seq}`, workItemId, type: 'host_observed_gate_evidence_recorded', author: 'system', proposalVersion: 2,
        payload: { data: { work_item_id: workItemId, attempt_id: attemptId, approved_proposal_version: 2, evidence: built.value as unknown as Json } },
        occurredAt: new Date('2026-08-17T12:00:00.000Z'),
      };
    };
    // Três itens distintos rodando o MESMO comando: sem escopo de item, o Governor os funde.
    const crossItem = [forItem('item-a', 'a1', 300), forItem('item-b', 'b1', 320), forItem('item-c', 'c1', 310)];
    const report = composeSupervisorResourceAdvisory({ events: crossItem, readSnapshot: () => snapshot(8_000) })!;
    const typecheck = report.advisories.filter(a => a.key.command === 'npm run typecheck');
    expect(typecheck).toHaveLength(1);                          // um perfil, não um por item
    expect(typecheck[0]!.advisory.basis.sampleCount).toBe(3);   // as três observações agregadas
  });
});

// Advisory ANTES de rodar, sobre os gates declarados no contrato do item.
describe('declaredGateCommands + composeItemGateAdvisory (pré-execução)', () => {
  const itemWith = (validationCriteria: unknown): WorkItem => ({
    id: 'work-1', userId: 'u', sourceMessageId: 'm', state: 'approved', impactLevel: 'low', capability: 'programming',
    originalRequest: 'x', intent: { execution_spec: { validation_criteria: validationCriteria } } as unknown as WorkItem['intent'],
    proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
    proposalVersion: 2, createdAt: new Date(), updatedAt: new Date(),
  });

  test('declaredGateCommands extrai os comandos, ignorando entradas sem command', () => {
    const item = itemWith([{ label: 'Typecheck', command: 'npm run typecheck' }, { label: 'sem comando' }, { command: '  ' }, { command: 'npm run test:e2e' }]);
    expect(declaredGateCommands(item)).toEqual(['npm run typecheck', 'npm run test:e2e']);
  });

  test('item sem contrato/validation_criteria → lista vazia (fail-safe)', () => {
    expect(declaredGateCommands({ ...itemWith(undefined), intent: {} as WorkItem['intent'] })).toEqual([]);
    expect(declaredGateCommands(itemWith('não-é-array'))).toEqual([]);
  });

  test('gate declarado com histórico → advised; declarado mas nunca observado → insufficient', () => {
    const report = composeItemGateAdvisory({
      commands: ['npm run typecheck', 'npm run brand-new-gate'],
      events, readSnapshot: () => snapshot(8_000),
    });
    const byCommand = new Map(report.advisories.map(a => [a.key.command, a.advisory.recommendation]));
    expect(byCommand.get('npm run typecheck')).toBe('safe_to_run');
    expect(byCommand.get('npm run brand-new-gate')).toBe('insufficient_evidence'); // não some
  });

  test('SEMPRE devolve report: sem histórico, cada gate declarado vira insufficient (não null)', () => {
    const report = composeItemGateAdvisory({ commands: ['a', 'b'], events: [], readSnapshot: () => snapshot(8_000) });
    expect(report.advisories.map(a => a.key.command)).toEqual(['a', 'b']);
    expect(report.advisories.every(a => a.advisory.recommendation === 'insufficient_evidence')).toBe(true);
  });
});
