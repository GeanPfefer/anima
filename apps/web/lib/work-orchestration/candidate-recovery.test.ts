/** @jest-environment node */
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseArgs, USAGE } from '@/cli/args';
import { runWorkRecoverCandidate } from '@/cli/app';
import { renderHuman } from '@/cli/render';
import { EXIT } from '@/cli/exit-codes';

jest.mock('./retry-readiness', () => ({ readWorkRetryReadiness: jest.fn() }));
import { readWorkRetryReadiness } from './retry-readiness';
import { recoverFromFailedCandidate, type CandidateRecoveryGitPort } from './candidate-recovery';

const readiness = readWorkRetryReadiness as jest.Mock;
const ATTEMPT = '96000000-0000-4000-8000-0000000000a1';
const COMMIT = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const exhausted = { status: 'BLOCKED', reason: 'attempt_budget_exhausted', failureEventId: '3ec5fee2-0d11-4c0d-9d86-ecbb0a944a21', proposalVersion: 3, sourceAttemptId: ATTEMPT, attemptsUsed: 1, maxAttempts: 1, remainingAttempts: 0 };
const rpcOk = { recoveryId: 'r1', successorWorkItemId: 's1', lineageId: 'l1', sourceAttemptId: ATTEMPT, checkpointCommitSha: COMMIT, replayed: false };

const git = (overrides: Partial<CandidateRecoveryGitPort> = {}): CandidateRecoveryGitPort => ({
  resolveCommit: async ref => (ref === COMMIT ? COMMIT : null),
  resolveBranch: async branch => (branch === `anima-work/${ATTEMPT}` ? COMMIT : null),
  isAncestor: async (ancestor, descendant) => ancestor === BASE && descendant === COMMIT,
  fileExists: () => true,
  ...overrides,
});

const client = (opts: { rpc?: { data: unknown; error: unknown }; base?: string | null } = {}) => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const base = opts.base === undefined ? BASE : opts.base;
  const rows = base ? [{ payload: { data: { evidence: { attemptId: ATTEMPT, baseSha: base } } } }] : [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order']) chain[m] = () => chain;
  chain.limit = async () => ({ data: rows, error: null });
  const c = {
    from: () => chain,
    rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return opts.rpc ?? { data: rpcOk, error: null }; },
  } as unknown as SupabaseClient<Database>;
  return { c, calls };
};

const request = (): Record<string, unknown> => ({
  schemaVersion: 1,
  kind: 'production_candidate_incorrect_v1',
  reason: 'Candidato com erro de tipo real em produção',
  finding: 'production_candidate_incorrect',
  candidateCommitSha: COMMIT,
  sourceAttemptId: ATTEMPT,
  gate: { label: 'typecheck', command: 'npm run typecheck --workspace=apps/web', exitCode: 2 },
  location: { path: 'apps/web/lib/x.ts', line: 12 },
  observedError: "TS2322: Type 'string' is not assignable to type 'number'.",
  evidenceReference: 'docs/registros/2026-10-03-x.md',
  corrections: [{ kind: 'type_error', instruction: 'Alinhar o tipo retornado ao contrato público.' }],
  additionalAttempts: 1,
});

describe('recoverFromFailedCandidate', () => {
  beforeEach(() => readiness.mockReset().mockResolvedValue(exhausted));

  test('predecessor failed → pede exatamente um sucessor ancorado no evento de falha', async () => {
    const { c, calls } = client();
    const result = await recoverFromFailedCandidate(c, 'w1', request(), git());
    expect(result).toMatchObject({ ok: true, successorWorkItemId: 's1', checkpointCommitSha: COMMIT, replayed: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ fn: 'authorize_candidate_recovery', args: {
      p_work_item_id: 'w1', p_expected_proposal_version: 3, p_failure_event_id: exhausted.failureEventId,
      p_authorization: expect.objectContaining({ kind: 'production_candidate_incorrect_v1', candidateCommitSha: COMMIT, sourceAttemptId: ATTEMPT, additionalAttempts: 1 }),
    } });
  });

  test('requestId é determinístico por evento de falha (replay seguro)', async () => {
    const a = client(); const b = client();
    await recoverFromFailedCandidate(a.c, 'w1', request(), git());
    await recoverFromFailedCandidate(b.c, 'w1', request(), git());
    const id = (x: typeof a) => (x.calls[0]!.args.p_authorization as { requestId: string }).requestId;
    expect(id(a)).toMatch(/^[0-9a-f-]{36}$/);
    expect(id(a)).toBe(id(b));
    readiness.mockResolvedValue({ ...exhausted, failureEventId: '4ec5fee2-0d11-4c0d-9d86-ecbb0a944a21' });
    const d = client();
    await recoverFromFailedCandidate(d.c, 'w1', request(), git());
    expect(id(d)).not.toBe(id(a));
  });

  test('replay devolvido pela RPC é propagado', async () => {
    const { c } = client({ rpc: { data: { ...rpcOk, replayed: true }, error: null } });
    expect(await recoverFromFailedCandidate(c, 'w1', request(), git())).toMatchObject({ ok: true, replayed: true });
  });

  test('orçamento NÃO esgotado ⇒ recusa antes da RPC', async () => {
    readiness.mockResolvedValue({ ...exhausted, status: 'RETRY_READY', reason: null });
    const { c, calls } = client();
    expect(await recoverFromFailedCandidate(c, 'w1', request(), git())).toMatchObject({ ok: false, code: 'budget_not_exhausted_or_not_failed', rejected: true });
    expect(calls).toHaveLength(0);
  });

  test('leitura de prontidão falha ⇒ erro não-rejeição', async () => {
    readiness.mockResolvedValue({ ...exhausted, reason: 'read_failed' });
    expect(await recoverFromFailedCandidate(client().c, 'w1', request(), git())).toMatchObject({ ok: false, code: 'read_failed', rejected: false });
  });

  test('candidato ausente, branch para outro commit, sem descendência e evidência inexistente', async () => {
    const { c, calls } = client();
    expect(await recoverFromFailedCandidate(c, 'w1', request(), git({ resolveCommit: async () => null }))).toMatchObject({ ok: false, code: 'candidate_commit_unknown' });
    expect(await recoverFromFailedCandidate(c, 'w1', request(), git({ resolveBranch: async () => 'c'.repeat(40) }))).toMatchObject({ ok: false, code: 'candidate_branch_mismatch' });
    expect(await recoverFromFailedCandidate(c, 'w1', request(), git({ resolveBranch: async () => null }))).toMatchObject({ ok: false, code: 'candidate_branch_mismatch' });
    expect(await recoverFromFailedCandidate(c, 'w1', request(), git({ isAncestor: async () => false }))).toMatchObject({ ok: false, code: 'candidate_not_descendant_of_base' });
    expect(await recoverFromFailedCandidate(c, 'w1', request(), git({ fileExists: () => false }))).toMatchObject({ ok: false, code: 'evidence_missing' });
    expect(calls).toHaveLength(0);
  });

  test('sem evidência host do base_sha ⇒ recusa antes da RPC', async () => {
    const { c, calls } = client({ base: null });
    expect(await recoverFromFailedCandidate(c, 'w1', request(), git())).toMatchObject({ ok: false, code: 'base_sha_unknown' });
    expect(calls).toHaveLength(0);
  });

  test('diagnóstico inválido, requestId fornecido ou attempt divergente', async () => {
    const { c, calls } = client();
    expect(await recoverFromFailedCandidate(c, 'w1', { ...request(), finding: 'outro' }, git())).toMatchObject({ ok: false, code: 'authorization_invalid' });
    expect(await recoverFromFailedCandidate(c, 'w1', { ...request(), extra: 1 }, git())).toMatchObject({ ok: false, code: 'authorization_invalid' });
    expect(await recoverFromFailedCandidate(c, 'w1', { ...request(), requestId: '96000000-0000-4000-8000-0000000000b1' }, git())).toMatchObject({ ok: false, code: 'authorization_invalid' });
    expect(await recoverFromFailedCandidate(c, 'w1', null, git())).toMatchObject({ ok: false, code: 'authorization_invalid' });
    expect(await recoverFromFailedCandidate(c, 'w1', { ...request(), sourceAttemptId: '96000000-0000-4000-8000-0000000000a2' }, git())).toMatchObject({ ok: false, code: 'source_attempt_mismatch' });
    expect(calls).toHaveLength(0);
  });

  test('o serviço não restringe backend: codex-cli e claude-code seguem para a RPC (que decide)', async () => {
    for (const backend of ['codex-cli', 'claude-code']) {
      const { c, calls } = client();
      // O backend vive no spec do item (lido pela RPC), nunca no diagnóstico enviado.
      expect(await recoverFromFailedCandidate(c, `w-${backend}`, request(), git())).toMatchObject({ ok: true });
      expect(calls[0]!.args.p_work_item_id).toBe(`w-${backend}`);
    }
  });

  test('recusa da RPC por regra ⇒ rejected; erro de infraestrutura ⇒ não rejected; resposta inválida', async () => {
    expect(await recoverFromFailedCandidate(client({ rpc: { data: null, error: { code: '55000', message: 'budget_not_exhausted' } } }).c, 'w1', request(), git()))
      .toEqual({ ok: false, code: '55000', message: 'budget_not_exhausted', rejected: true });
    expect(await recoverFromFailedCandidate(client({ rpc: { data: null, error: { code: '57014', message: 'timeout' } } }).c, 'w1', request(), git()))
      .toMatchObject({ ok: false, rejected: false });
    expect(await recoverFromFailedCandidate(client({ rpc: { data: { recoveryId: 'r1' }, error: null } }).c, 'w1', request(), git()))
      .toMatchObject({ ok: false, code: 'response_invalid', rejected: false });
  });
});

describe('work recover-candidate (CLI)', () => {
  test('parse exige um id e --diagnosis', () => {
    expect(parseArgs(['work', 'recover-candidate', 'w1', '--diagnosis', 'd.json']))
      .toEqual({ ok: true, command: { kind: 'work-recover-candidate', id: 'w1', diagnosisPath: 'd.json', json: false } });
    expect(parseArgs(['work', 'recover-candidate', 'w1', '--diagnosis', 'd.json', '--json']))
      .toMatchObject({ ok: true, command: { json: true } });
  });

  test('autoridade humana obrigatória: sem --diagnosis, extras ou --reason ⇒ uso inválido', () => {
    expect(parseArgs(['work', 'recover-candidate', 'w1']).ok).toBe(false);
    expect(parseArgs(['work', 'recover-candidate', '--diagnosis', 'd.json']).ok).toBe(false);
    expect(parseArgs(['work', 'recover-candidate', 'w1', 'w2', '--diagnosis', 'd.json']).ok).toBe(false);
    expect(parseArgs(['work', 'recover-candidate', 'w1', '--diagnosis', 'd.json', '--reason', 'x']).ok).toBe(false);
    expect(parseArgs(['work', 'retry', 'w1', '--diagnosis', 'd.json']).ok).toBe(false);
  });

  test('work replan permanece com o contrato legado', () => {
    expect(parseArgs(['work', 'replan', 'w1', '--diagnosis', 'd.json']))
      .toEqual({ ok: true, command: { kind: 'work-replan', id: 'w1', diagnosisPath: 'd.json', json: false } });
    expect(parseArgs(['work', 'replan', 'w1'])).toMatchObject({ ok: true, command: { diagnosisPath: null } });
  });

  test('USAGE documenta o comando', () => {
    expect(USAGE).toContain('work recover-candidate <id> --diagnosis');
  });

  test('sucesso: payload, JSON e texto (aprovação/execução seguem separadas)', async () => {
    const result = await runWorkRecoverCandidate(async () => ({ ok: true, ...rpcOk }), 'w1');
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({
      ok: true, kind: 'work-recover-candidate', workItemId: 'w1', successorWorkItemId: 's1', lineageId: 'l1',
      recoveryId: 'r1', sourceAttemptId: ATTEMPT, checkpointCommitSha: COMMIT, replayed: false,
    });
    const text = renderHuman(result.payload);
    expect(text).toContain('Sucessor: s1');
    expect(text).toContain('Checkpoint: aaaaaaa');
    expect(text).toContain('continuam atos humanos separados');
    expect(JSON.parse(JSON.stringify(result.payload))).toMatchObject({ kind: 'work-recover-candidate', successorWorkItemId: 's1' });
  });

  test('replay é sinalizado', async () => {
    const result = await runWorkRecoverCandidate(async () => ({ ok: true, ...rpcOk, replayed: true }), 'w1');
    expect(renderHuman(result.payload)).toContain('(replay)');
  });

  test('recusa por regra ⇒ REJECTED; falha de infraestrutura ⇒ ERROR', async () => {
    expect((await runWorkRecoverCandidate(async () => ({ ok: false, code: '55000', message: 'budget_not_exhausted', rejected: true }), 'w1')).exitCode).toBe(EXIT.REJECTED);
    expect((await runWorkRecoverCandidate(async () => ({ ok: false, code: 'read_failed', message: 'x', rejected: false }), 'w1')).exitCode).toBe(EXIT.ERROR);
  });

  test('o runner só chama o serviço de recovery: nenhuma attempt é iniciada', async () => {
    const recover = jest.fn(async () => ({ ok: true as const, ...rpcOk }));
    await runWorkRecoverCandidate(recover, 'w1');
    expect(recover).toHaveBeenCalledTimes(1);
    const { c, calls } = client();
    await recoverFromFailedCandidate(c, 'w1', request(), git());
    expect(calls.map(call => call.fn)).toEqual(['authorize_candidate_recovery']);
  });
});
