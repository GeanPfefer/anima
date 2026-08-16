import {
  buildWorktreeHandoff,
  computeVerifierOpinion,
  type VerifierOpinionV1,
  type WorkEvent,
  type WorkItem,
  type WorktreeHandoffV1,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeAndPersistVerifierOpinion,
  verifierOpinionSinkFor,
  type VerifierOpinionSink,
} from './verifier-opinion';

const BASE = 'a'.repeat(40);
const COMMIT = 'b'.repeat(40);

const item = (): WorkItem => ({
  id: 'work-1', userId: 'user-1', sourceMessageId: 'msg-1',
  state: 'review', impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: {
    execution_spec: {
      schema_version: 1, target: { kind: 'project', reference: 'proj' },
      permissions: ['workspace_read', 'workspace_write_isolated'],
      validation_criteria: [{ label: 'unit', command: 'npm test' }], limits: { max_attempts: 3 },
    },
  } as unknown as WorkItem['intent'],
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: ['src/a.ts'], excludedScope: [], expectedEffects: ['e'], risks: [] } },
  proposalVersion: 2, createdAt: new Date('2026-08-16T00:00:00Z'), updatedAt: new Date('2026-08-16T00:00:00Z'),
});

const handoff = (): WorktreeHandoffV1 => {
  const built = buildWorktreeHandoff({
    workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
    executorId: 'worktree-v1', backendId: 'fake', model: null,
    baseSha: BASE, branch: 'anima-work/attempt-1', commitSha: COMMIT, status: 'succeeded',
    changedFiles: ['src/a.ts'], diffFiles: [{ path: 'src/a.ts', insertions: 1, deletions: 0 }],
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, outcome: 'passed' }],
  });
  if (!built.ok) throw new Error(built.explanation);
  return built.value;
};

const resultEvent = (): WorkEvent => ({
  id: 'ev-result', workItemId: 'work-1', type: 'result_submitted', author: 'executor', proposalVersion: 2,
  payload: { schema_version: 1, data: { work_item_id: 'work-1', attempt_id: 'attempt-1', approved_proposal_version: 2, executor_signal: { worktreeHandoff: handoff() as unknown as Json } } } as unknown as Json,
  occurredAt: new Date('2026-08-16T00:00:00Z'),
});

describe('computeAndPersistVerifierOpinion (fail-open)', () => {
  const capturing = () => {
    const calls: VerifierOpinionV1[] = [];
    const sink: VerifierOpinionSink = { record: async (o) => { calls.push(o); return { ok: true, action: 'recorded' }; } };
    return { sink, calls };
  };

  test('com resultado durável: calcula e persiste; o parecer carrega a correlação real', async () => {
    const { sink, calls } = capturing();
    const outcome = await computeAndPersistVerifierOpinion({ item: item(), events: [resultEvent()] }, sink);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.action).toBe('recorded');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2, verdict: 'verified' });
    expect(calls[0]!.evidenceBasis.resultEventId).toBe('ev-result');
  });

  test('sem resultado durável ⇒ skipped e o sink NUNCA é chamado', async () => {
    const { sink, calls } = capturing();
    const outcome = await computeAndPersistVerifierOpinion({ item: item(), events: [] }, sink);
    expect(outcome).toMatchObject({ ok: false, stage: 'skipped' });
    expect(calls).toHaveLength(0);
  });

  test('fail-open: sink recusa ⇒ stage persist, sem lançar', async () => {
    const refusing: VerifierOpinionSink = { record: async () => ({ ok: false, message: 'rpc recusou' }) };
    const outcome = await computeAndPersistVerifierOpinion({ item: item(), events: [resultEvent()] }, refusing);
    expect(outcome).toMatchObject({ ok: false, stage: 'persist', reason: 'rpc recusou' });
  });

  test('fail-open: sink que LANÇA é capturado (nunca quebra a volta)', async () => {
    const throwing: VerifierOpinionSink = { record: async () => { throw new Error('boom'); } };
    const outcome = await computeAndPersistVerifierOpinion({ item: item(), events: [resultEvent()] }, throwing);
    expect(outcome).toMatchObject({ ok: false, stage: 'persist', reason: 'boom' });
  });
});

describe('verifierOpinionSinkFor — tradução para a RPC record_verifier_opinion', () => {
  const opinion = (): VerifierOpinionV1 => computeVerifierOpinion(item(), [resultEvent()])!;

  test('deriva os parâmetros da RPC do PRÓPRIO parecer e mapeia recorded/replayed', async () => {
    let seen: Record<string, unknown> | null = null;
    const client = { rpc: async (_fn: string, args: Record<string, unknown>) => { seen = args; return { data: { action: 'replayed' }, error: null }; } } as unknown as SupabaseClient<Database>;
    const op = opinion();
    const result = await verifierOpinionSinkFor(client).record(op);
    expect(result).toEqual({ ok: true, action: 'replayed' });
    expect(seen).toEqual({ work_item_id: 'work-1', expected_proposal_version: 2, attempt_id: 'attempt-1', opinion: op });
  });

  test('erro da RPC vira ok:false message', async () => {
    const client = { rpc: async () => ({ data: null, error: { message: 'attempt not found' } }) } as unknown as SupabaseClient<Database>;
    const result = await verifierOpinionSinkFor(client).record(opinion());
    expect(result).toEqual({ ok: false, message: 'attempt not found' });
  });
});
