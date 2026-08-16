import type { HostObservedGateEvidenceV1, ObservedGateInput } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  gateEvidenceSinkFor,
  persistHostObservedGateEvidence,
  type GateEvidenceSink,
} from './gate-evidence';

const correlation = { workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2 };
const passing: ObservedGateInput = { label: 'unit', command: 'npm test', exitCode: 0, durationMs: 100, timedOut: false, cancelled: false };
const failing: ObservedGateInput = { label: 'unit', command: 'npm test', exitCode: 1, durationMs: 50, timedOut: false, cancelled: false };
const at = () => new Date('2026-08-16T12:00:00.000Z');

describe('persistHostObservedGateEvidence (fail-open)', () => {
  const capturing = () => {
    const calls: HostObservedGateEvidenceV1[] = [];
    const sink: GateEvidenceSink = { record: async (e) => { calls.push(e); return { ok: true, action: 'recorded' }; } };
    return { sink, calls };
  };

  test('constrói e persiste; o outcome é DERIVADO do exitCode observado', async () => {
    const { sink, calls } = capturing();
    const outcome = await persistHostObservedGateEvidence(correlation, [passing, failing], sink, at);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.action).toBe('recorded');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2 });
    expect(calls[0]!.gates.map(g => g.outcome)).toEqual(['passed', 'failed']);
    expect(calls[0]!.coverage).toEqual({ gates: true });
  });

  test('nenhum gate observado ⇒ skipped e o sink NUNCA é chamado', async () => {
    const { sink, calls } = capturing();
    const outcome = await persistHostObservedGateEvidence(correlation, [], sink, at);
    expect(outcome).toMatchObject({ ok: false, stage: 'skipped' });
    expect(calls).toHaveLength(0);
  });

  test('fatos malformados ⇒ stage build (fail-closed antes de persistir)', async () => {
    const { sink, calls } = capturing();
    const outcome = await persistHostObservedGateEvidence(correlation, [{ ...passing, label: '   ' }], sink, at);
    expect(outcome).toMatchObject({ ok: false, stage: 'build' });
    expect(calls).toHaveLength(0);
  });

  test('fail-open: sink recusa ⇒ stage persist', async () => {
    const refusing: GateEvidenceSink = { record: async () => ({ ok: false, message: 'rpc recusou' }) };
    const outcome = await persistHostObservedGateEvidence(correlation, [passing], refusing, at);
    expect(outcome).toMatchObject({ ok: false, stage: 'persist', reason: 'rpc recusou' });
  });

  test('fail-open: sink que LANÇA é capturado', async () => {
    const throwing: GateEvidenceSink = { record: async () => { throw new Error('boom'); } };
    const outcome = await persistHostObservedGateEvidence(correlation, [passing], throwing, at);
    expect(outcome).toMatchObject({ ok: false, stage: 'persist', reason: 'boom' });
  });
});

describe('gateEvidenceSinkFor — tradução para a RPC record_host_observed_gate_evidence', () => {
  const evidence = (): HostObservedGateEvidenceV1 => ({
    schemaVersion: 1, workItemId: 'work-9', attemptId: 'attempt-9', approvedProposalVersion: 4,
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 1, timedOut: false, cancelled: false, outcome: 'passed' }],
    observedAt: '2026-08-16T10:00:00Z', coverage: { gates: true },
  });

  test('deriva os parâmetros da RPC da própria evidência e mapeia recorded/replayed', async () => {
    let seen: Record<string, unknown> | null = null;
    const client = { rpc: async (_fn: string, args: Record<string, unknown>) => { seen = args; return { data: { action: 'replayed' }, error: null }; } } as unknown as SupabaseClient<Database>;
    const ev = evidence();
    const result = await gateEvidenceSinkFor(client).record(ev);
    expect(result).toEqual({ ok: true, action: 'replayed' });
    expect(seen).toEqual({ work_item_id: 'work-9', expected_proposal_version: 4, attempt_id: 'attempt-9', evidence: ev });
  });

  test('erro da RPC vira ok:false message', async () => {
    const client = { rpc: async () => ({ data: null, error: { message: 'attempt not found' } }) } as unknown as SupabaseClient<Database>;
    expect(await gateEvidenceSinkFor(client).record(evidence())).toEqual({ ok: false, message: 'attempt not found' });
  });
});
