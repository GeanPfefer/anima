/** @jest-environment node */
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('./retry-readiness', () => ({ readWorkRetryReadiness: jest.fn() }));
import { readWorkRetryReadiness } from './retry-readiness';
import { recoverFromHarnessDefect, type HarnessRecoveryGitPort } from './harness-recovery';

const readiness = readWorkRetryReadiness as jest.Mock;
const FIX = 'd17dcbe'.padEnd(40, 'a');
const exhausted = { status: 'BLOCKED', reason: 'attempt_budget_exhausted', failureEventId: '3ec5fee2-0d11-4c0d-9d86-ecbb0a944a21', proposalVersion: 3, sourceAttemptId: 'c284f09c', attemptsUsed: 1, maxAttempts: 1, remainingAttempts: 0 };
const git = (overrides: Partial<HarnessRecoveryGitPort> = {}): HarnessRecoveryGitPort => ({
  resolveCommit: async ref => (ref === 'd17dcbe' || ref === FIX ? FIX : null),
  containedInHead: async () => true,
  fileExists: () => true,
  ...overrides,
});
const client = (rpcResult: { data: unknown; error: unknown } = { data: { recoveryId: 'r1', successorWorkItemId: 's1', lineageId: 'l1', sourceAttemptId: 'c284f09c', replayed: false }, error: null }) => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const c = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return rpcResult; } } as unknown as SupabaseClient<Database>;
  return { c, calls };
};
const request = { fixCommits: ['d17dcbe'], evidenceReference: 'docs/registros/2026-09-25g-segunda-prova-paga-dev-readiness.md', reason: 'Defeito de harness corrigido: revisão de diff de arquivo novo' };

describe('recoverFromHarnessDefect', () => {
  beforeEach(() => readiness.mockReset().mockResolvedValue(exhausted));

  test('resolve o fix para SHA completo, ancora no evento de falha e pede exatamente um sucessor', async () => {
    const { c, calls } = client();
    const result = await recoverFromHarnessDefect(c, 'w1', request, git());
    expect(result).toMatchObject({ ok: true, successorWorkItemId: 's1', replayed: false, authorization: { fixCommits: [FIX], failureClass: 'harness', additionalAttempts: 1 } });
    expect(calls).toEqual([{ fn: 'authorize_harness_fix_recovery', args: expect.objectContaining({
      p_work_item_id: 'w1', p_expected_proposal_version: 3, p_failure_event_id: exhausted.failureEventId,
    }) }]);
  });

  test('requestId é determinístico por evento de falha (repetir o ato é replay)', async () => {
    const a = client(); const b = client();
    await recoverFromHarnessDefect(a.c, 'w1', request, git());
    await recoverFromHarnessDefect(b.c, 'w1', request, git());
    const id = (x: typeof a) => (x.calls[0]!.args.p_authorization as { requestId: string }).requestId;
    expect(id(a)).toBe(id(b));
  });

  test('com tentativas restantes o caminho é o retry governado: nada é pedido', async () => {
    readiness.mockResolvedValue({ ...exhausted, status: 'RETRY_READY', reason: null });
    const { c, calls } = client();
    expect(await recoverFromHarnessDefect(c, 'w1', request, git())).toMatchObject({ ok: false, code: 'budget_not_exhausted_or_not_failed' });
    expect(calls).toHaveLength(0);
  });

  test('fix fora do HEAD executado pelo host é recusado', async () => {
    const { c, calls } = client();
    expect(await recoverFromHarnessDefect(c, 'w1', request, git({ containedInHead: async () => false }))).toMatchObject({ ok: false, code: 'fix_commit_not_in_head' });
    expect(calls).toHaveLength(0);
  });

  test('commit inexistente e registro de evidência ausente são recusados', async () => {
    const { c } = client();
    expect(await recoverFromHarnessDefect(c, 'w1', { ...request, fixCommits: ['deadbee'] }, git())).toMatchObject({ ok: false, code: 'fix_commit_unknown' });
    expect(await recoverFromHarnessDefect(c, 'w1', request, git({ fileExists: () => false }))).toMatchObject({ ok: false, code: 'evidence_missing' });
  });

  test('recusa da RPC por regra propaga como rejeição', async () => {
    const { c } = client({ data: null, error: { code: '55000', message: 'recovery_already_allocated' } });
    expect(await recoverFromHarnessDefect(c, 'w1', request, git())).toEqual({ ok: false, code: '55000', message: 'recovery_already_allocated', rejected: true });
  });
});
