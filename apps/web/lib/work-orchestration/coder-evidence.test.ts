import type { HostObservedCoderEvidenceV1, ObservedCoderInput } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  coderEvidenceSinkFor,
  persistHostObservedCoderEvidence,
  type CoderEvidenceSink,
} from './coder-evidence';

const correlation = { workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2 };
const succeeded: ObservedCoderInput = { backendId: 'ollama-coder', durationMs: 84_000, outcome: 'succeeded' };
const at = () => new Date('2026-08-17T12:00:00.000Z');

describe('persistHostObservedCoderEvidence (fail-open)', () => {
  const capturing = () => {
    const calls: HostObservedCoderEvidenceV1[] = [];
    const sink: CoderEvidenceSink = { record: async (e) => { calls.push(e); return { ok: true, action: 'recorded' }; } };
    return { sink, calls };
  };

  test('constrói e persiste a duração host-observed com o backendId e o desfecho', async () => {
    const { sink, calls } = capturing();
    const outcome = await persistHostObservedCoderEvidence(correlation, succeeded, sink, at);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.action).toBe('recorded');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2, backendId: 'ollama-coder', durationMs: 84_000, outcome: 'succeeded' });
    expect(calls[0]!.observedAt).toBe('2026-08-17T12:00:00.000Z');
  });

  test('persiste identidade remota conhecida pelo host junto da duração e outcome', async () => {
    const { sink, calls } = capturing();
    const outcome = await persistHostObservedCoderEvidence(correlation, {
      backendId: 'ollama:remote/gpu-a:qwen3-coder:latest', durationMs: 321, outcome: 'succeeded',
      placement: 'remote', nodeId: 'gpu-a', model: 'qwen3-coder:latest',
    }, sink, at);
    expect(outcome.ok).toBe(true);
    expect(calls[0]).toMatchObject({ placement: 'remote', nodeId: 'gpu-a', model: 'qwen3-coder:latest', durationMs: 321 });
  });

  test('multiple coder turns aggregate into one attempt evidence', async () => {
    const { sink, calls } = capturing();

    const observations: readonly ObservedCoderInput[] = [
      {
        backendId: 'ollama-coder',
        durationMs: 1_200,
        outcome: 'succeeded',
      },
      {
        backendId: 'ollama-coder',
        durationMs: 800,
        outcome: 'succeeded',
      },
    ];

    const outcome = await persistHostObservedCoderEvidence(
      correlation,
      observations,
      sink,
      at,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      workItemId: 'work-1',
      attemptId: 'attempt-1',
      approvedProposalVersion: 2,
      backendId: 'ollama-coder',
      durationMs: 2_000,
      outcome: 'succeeded',
    });
  });

  test('agrega usage provider-reported sem misturar com duração host-observed', async () => {
    const { sink, calls } = capturing();
    await persistHostObservedCoderEvidence(correlation, [
      { ...succeeded, providerUsage: { schemaVersion: 1, inputTokens: 10, outputTokens: 2, totalTokens: 12 } },
      { ...succeeded, durationMs: 1, providerUsage: { schemaVersion: 1, inputTokens: 3, outputTokens: 4, totalTokens: 7, cachedInputTokens: 1 } },
    ], sink, at);
    expect(calls[0]?.providerUsage).toEqual({ schemaVersion: 1, inputTokens: 13, outputTokens: 6, totalTokens: 19, cachedInputTokens: 1 });
  });

  test('agrega chamadas observadas sem fabricar usage ausente', async () => {
    const { sink, calls } = capturing();
    await persistHostObservedCoderEvidence(correlation, [
      { ...succeeded, providerCallCount: 2 }, { ...succeeded, providerCallCount: 1 },
    ], sink, at);
    expect(calls[0]?.providerCallCount).toBe(3);
    expect(calls[0]).not.toHaveProperty('providerUsage');
  });

  test('nenhuma edição de coder observada ⇒ skipped e o sink NUNCA é chamado', async () => {
    const { sink, calls } = capturing();
    const outcome = await persistHostObservedCoderEvidence(correlation, null, sink, at);
    expect(outcome).toMatchObject({ ok: false, stage: 'skipped' });
    expect(calls).toHaveLength(0);
  });

  test('fato malformado ⇒ stage build (fail-closed antes de persistir)', async () => {
    const { sink, calls } = capturing();
    const outcome = await persistHostObservedCoderEvidence(correlation, { ...succeeded, durationMs: -1 }, sink, at);
    expect(outcome).toMatchObject({ ok: false, stage: 'build' });
    expect(calls).toHaveLength(0);
  });

  test('fail-open: sink recusa ⇒ stage persist', async () => {
    const refusing: CoderEvidenceSink = { record: async () => ({ ok: false, message: 'rpc recusou' }) };
    const outcome = await persistHostObservedCoderEvidence(correlation, succeeded, refusing, at);
    expect(outcome).toMatchObject({ ok: false, stage: 'persist', reason: 'rpc recusou' });
  });

  test('fail-open: sink que LANÇA é capturado', async () => {
    const throwing: CoderEvidenceSink = { record: async () => { throw new Error('boom'); } };
    const outcome = await persistHostObservedCoderEvidence(correlation, succeeded, throwing, at);
    expect(outcome).toMatchObject({ ok: false, stage: 'persist', reason: 'boom' });
  });
});

describe('coderEvidenceSinkFor — tradução para a RPC record_host_observed_coder_evidence', () => {
  const evidence = (): HostObservedCoderEvidenceV1 => ({
    schemaVersion: 1, workItemId: 'work-9', attemptId: 'attempt-9', approvedProposalVersion: 4,
    backendId: 'gpt-coder', durationMs: 12_345, outcome: 'succeeded', observedAt: '2026-08-17T10:00:00Z',
  });

  test('deriva os parâmetros da RPC da própria evidência e mapeia recorded/replayed', async () => {
    let seen: Record<string, unknown> | null = null;
    const client = { rpc: async (_fn: string, args: Record<string, unknown>) => { seen = args; return { data: { action: 'replayed' }, error: null }; } } as unknown as SupabaseClient<Database>;
    const ev = evidence();
    const result = await coderEvidenceSinkFor(client).record(ev);
    expect(result).toEqual({ ok: true, action: 'replayed' });
    expect(seen).toEqual({ work_item_id: 'work-9', expected_proposal_version: 4, attempt_id: 'attempt-9', evidence: ev });
  });

  test('erro da RPC vira ok:false message', async () => {
    const client = { rpc: async () => ({ data: null, error: { message: 'attempt not found' } }) } as unknown as SupabaseClient<Database>;
    expect(await coderEvidenceSinkFor(client).record(evidence())).toEqual({ ok: false, message: 'attempt not found' });
  });
});
