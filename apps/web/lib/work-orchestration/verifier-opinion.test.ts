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
import { renderInvestigationSummary } from '@anima/core';

const BASE = 'a'.repeat(40);
const COMMIT = 'b'.repeat(40);

const item = (): WorkItem => ({
  id: 'work-1', userId: 'user-1', sourceMessageId: 'msg-1',
  state: 'review', impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: {
    execution_spec: {
      schema_version: 1, target: { kind: 'project', reference: 'proj' },
      permissions: ['workspace_read', 'workspace_write_isolated'],
      validation_criteria: [{ label: 'unit', command: 'npm test', covers: ['e'], claim_kind: 'gate_assertion' }], limits: { max_attempts: 3 },
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

describe('SDC-10 isolated investigation opinion', () => {
  const investigation = () => ({ schemaVersion: 1 as const, outcome: 'inconclusive' as const, findings: [], gaps: ['History unavailable.'],
    hostVerification: { baseSha: BASE, snapshotHead: BASE, snapshotClean: true as const, snapshotDetached: true as const, prohibitedRefsBefore: ['refs/heads/anima-work/previous'] } });
  const investigationItem = (): WorkItem => ({ ...item(), capability: 'research', intent: { execution_spec: { effect_class: 'read_only', executor: 'investigation-v1', base_sha: BASE, target: { kind: 'project', reference: 'fixture' }, permissions: ['workspace_read'], verifier_requirement: 'advisory' } } as unknown as WorkItem['intent'] });
  const event = (): WorkEvent => ({ ...resultEvent(), payload: { schema_version: 1, data: { work_item_id: 'work-1', attempt_id: 'attempt-1', approved_proposal_version: 2,
    executor_signal: { kind: 'result', origin: 'executor', workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2, sequence: 1, investigation: investigation(), summary: renderInvestigationSummary(investigation()), handoffReference: 'investigation:result' } } } as unknown as Json });
  const dependencies = () => ({ resolveTarget: () => ({ repoRoot: 'fixture', baseSha: BASE }), resolveEvidence: jest.fn(async () => true), readRefs: jest.fn(async () => ['refs/heads/anima-work/previous']) });
  test('re-resolves D, rechecks C and persists through existing sink; A/B remain attested', async () => {
    const deps = dependencies(); const calls: VerifierOpinionV1[] = [];
    const outcome = await computeAndPersistVerifierOpinion({ item: investigationItem(), events: [event()] }, { record: async opinion => { calls.push(opinion); return { ok: true, action: 'recorded' }; } }, deps);
    expect(outcome.ok).toBe(true);
    expect(deps.resolveEvidence).toHaveBeenCalledWith('fixture', investigation());
    expect(deps.readRefs).toHaveBeenCalledWith('fixture', 'attempt-1');
    expect(calls[0]).toMatchObject({ verdict: 'verified', verifierVersion: 'investigation-verifier-v1', restsOnAttestedEvidence: true, summary: { attested: 2, independent: 3 }, evidenceBasis: { resultEventId: 'ev-result', observedEventId: null, observedGateEventId: null, coverage: { git: false, gates: false } } });
    expect(calls[0]!.findings.map(f => f.provenance)).toEqual(['attested', 'attested', 'independent', 'independent', 'independent']);
  });
  test.each(['references', 'refs', 'structure'])('failed %s recheck cannot produce verified', async failure => {
    const deps = dependencies(); let value: VerifierOpinionV1 | undefined;
    if (failure === 'references') deps.resolveEvidence.mockResolvedValue(false);
    if (failure === 'refs') deps.readRefs.mockResolvedValue(['refs/heads/anima-work/new']);
    const bad = event();
    if (failure === 'structure') {
      const payload = bad.payload as { data: { executor_signal: { investigation: { gaps: string[] } } } };
      payload.data.executor_signal.investigation.gaps = [];
    }
    await computeAndPersistVerifierOpinion({ item: investigationItem(), events: [bad] }, { record: async opinion => { value = opinion; return { ok: true, action: 'recorded' }; } }, deps);
    expect(value?.verdict).toBe('inconclusive');
  });
  test('cross-attempt signal or mandated lane is skipped rather than programming fallback', async () => {
    const sink = { record: jest.fn(async () => ({ ok: true as const, action: 'recorded' as const })) };
    const bad = event();
    const payload = bad.payload as { data: { executor_signal: { attemptId: string } } };
    payload.data.executor_signal.attemptId = 'another-attempt';
    expect(await computeAndPersistVerifierOpinion({ item: investigationItem(), events: [bad] }, sink, dependencies())).toMatchObject({ ok: false, stage: 'skipped' });
    const mandated = investigationItem();
    const intent = mandated.intent as { execution_spec: { verifier_requirement: string } };
    intent.execution_spec.verifier_requirement = 'required_fail_closed';
    expect(await computeAndPersistVerifierOpinion({ item: mandated, events: [event()] }, sink, dependencies())).toMatchObject({ ok: false, stage: 'skipped' });
    expect(sink.record).not.toHaveBeenCalled();
  });
  test('RPC translation accepts the investigation version without independent git/gate event claims', async () => {
    const rpc = jest.fn(async () => ({ data: { action: 'recorded' }, error: null }));
    const result = await computeAndPersistVerifierOpinion({ item: investigationItem(), events: [event()] }, verifierOpinionSinkFor({ rpc } as unknown as SupabaseClient<Database>), dependencies());
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('record_verifier_opinion', expect.objectContaining({ work_item_id: 'work-1', attempt_id: 'attempt-1', opinion: expect.objectContaining({ verifierVersion: 'investigation-verifier-v1', evidenceBasis: expect.objectContaining({ observedEventId: null, observedGateEventId: null }) }) }));
  });
});
