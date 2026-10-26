import {
  buildIntegrationEffectReceipt, externalIntegrationRepositoryId, integrationOperationKey, integrationReceiptMatchesAuthorization,
  isAllowedExternalIntegrationTargetRef, planIntegrationEffect, projectIntegrationEffectAuthorization, projectIntegrationStatus,
} from './integration-effect';
import type { WorkEvent, WorkItem } from './types';

// T5 — a política EXTERNA (destino local, ff_only, identidade congelada) convive com a INTERNA (só refs/heads/dev) sem regressão.
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const EXTERNAL = { reference: 'ext:shop', repo_root_canonical: 'G:\\lab\\', git_common_dir_canonical: 'G:\\lab\\.git', root_commit_sha: A, base_sha: A };

function authEvent(over: { external?: unknown; targetRef?: string; repositoryId?: string; mode?: string } = {}): WorkEvent {
  const targetRef = over.targetRef ?? 'refs/heads/main';
  const repositoryId = over.repositoryId ?? externalIntegrationRepositoryId('ext:shop');
  const mode = over.mode ?? 'ff_only';
  const operation_key = integrationOperationKey({ authorizationId: 'au-1', acceptedResultEventId: 'res-1', repositoryId, targetRef, expectedTargetSha: C, resultCommitSha: B, mode });
  return {
    id: 'e-auth', workItemId: 'w1', type: 'integration_effect_authorized', author: 'user', proposalVersion: 1, occurredAt: new Date(),
    payload: { schema_version: 1, data: {
      authorization_id: 'au-1', operation_key, work_item_id: 'w1', approved_proposal_version: 1, attempt_id: 'att', accepted_result_event_id: 'res-1',
      result_commit_sha: B, repository_id: repositoryId, target_ref: targetRef, expected_target_sha: C, mode, ...('external' in over ? (over.external === undefined ? {} : { external: over.external }) : { external: EXTERNAL }),
    } } as never,
  } as WorkEvent;
}
const item = { id: 'w1', state: 'completed', proposalVersion: 1 } as unknown as WorkItem;
const receiptFor = (events: WorkEvent[]) => {
  const auth = projectIntegrationEffectAuthorization(events, 'au-1')!;
  return { auth, receipt: buildIntegrationEffectReceipt(auth, { mergeCommitSha: null, mergeParents: [], resultingTargetSha: B }, 'effected')! };
};

describe('isAllowedExternalIntegrationTargetRef (espelho do SQL)', () => {
  test.each(['refs/heads/main', 'refs/heads/release/1.0', 'refs/heads/feature_x-1.2'])('aceita %s', ref => expect(isAllowedExternalIntegrationTargetRef(ref)).toBe(true));
  test.each(['main', 'refs/tags/v1', 'refs/remotes/origin/main', 'refs/heads/', 'refs/heads/a..b', 'refs/heads/a//b', 'refs/heads/x/', 'refs/heads/x.lock', 'refs/heads/x.lock/y',
    'refs/heads/anima-work/att-1', 'refs/heads/-x', 'refs/heads/a b', 'refs/heads/a~1', `refs/heads/${'a'.repeat(201)}`, null, undefined, 42])('nega %p', ref => expect(isAllowedExternalIntegrationTargetRef(ref)).toBe(false));
});

describe('autorização externa projetada', () => {
  test('carrega a identidade congelada; ausente ⇒ interna; malformada ⇒ inválida (fail-closed)', () => {
    expect(projectIntegrationEffectAuthorization([authEvent()], 'au-1')?.external).toEqual({
      reference: 'ext:shop', repoRootCanonical: 'G:\\lab\\', gitCommonDirCanonical: 'G:\\lab\\.git', rootCommitSha: A, baseSha: A });
    expect(projectIntegrationEffectAuthorization([authEvent({ external: undefined, targetRef: 'refs/heads/dev', repositoryId: 'https://x/y' })], 'au-1')?.external).toBeUndefined();
    expect(projectIntegrationEffectAuthorization([authEvent({ external: { reference: 'ext:shop' } })], 'au-1')).toBeNull();
    expect(projectIntegrationEffectAuthorization([authEvent({ external: 'x' })], 'au-1')).toBeNull();
  });

  test('recibo ff_only externo coerente ⇒ integrated; destino main só vale para autorização externa', () => {
    const events = [authEvent()];
    const { auth, receipt } = receiptFor(events);
    expect(integrationReceiptMatchesAuthorization(auth, receipt)).toBe(true);
    const done = { id: 'e-done', workItemId: 'w1', type: 'integration_completed', author: 'system', proposalVersion: 1, occurredAt: new Date(), payload: { schema_version: 1, data: { authorization_id: 'au-1', receipt } } } as unknown as WorkEvent;
    expect(projectIntegrationStatus([...events, done])).toBe('integrated');
    // a MESMA forma sem a identidade externa (interna) com destino main é inválida
    const internal = [authEvent({ external: undefined, repositoryId: 'https://x/y' })];
    const iAuth = projectIntegrationEffectAuthorization(internal, 'au-1')!;
    const iReceipt = { ...receipt, operationKey: iAuth.operationKey, repositoryId: 'https://x/y' };
    expect(integrationReceiptMatchesAuthorization(iAuth, iReceipt)).toBe(false);
  });

  test('autorização externa com repositório de outra referência, modo merge_no_ff ou destino de attempt ⇒ recibo recusado', () => {
    for (const over of [{ repositoryId: externalIntegrationRepositoryId('ext:other') }, { mode: 'merge_no_ff' }, { targetRef: 'refs/heads/anima-work/x' }]) {
      const auth = projectIntegrationEffectAuthorization([authEvent(over)], 'au-1')!;
      const receipt = { kind: 'integration_effect', operationKey: auth.operationKey, authorizationId: 'au-1', workItemId: 'w1', proposalVersion: 1, attemptId: 'att', acceptedResultEventId: 'res-1',
        resultCommitSha: B, repositoryId: auth.repositoryId, targetRef: auth.targetRef, mode: auth.mode, previousTargetSha: C, resultingTargetSha: B, mergeCommitSha: null, mergeParents: [], observed: true, disposition: 'effected' } as const;
      expect(integrationReceiptMatchesAuthorization(auth, receipt)).toBe(false);
    }
  });
});

describe('planIntegrationEffect — escopos não se misturam', () => {
  const plan = (events: WorkEvent[], scope?: 'internal' | 'external', repo = externalIntegrationRepositoryId('ext:shop')) =>
    planIntegrationEffect({ item, events, authorizationId: 'au-1', trustedRepositoryId: repo, ...(scope ? { scope } : {}) });
  test('autorização externa no escopo interno (default) ⇒ target_not_allowed (nenhum executor interno a executa)', () => {
    expect(plan([authEvent()])).toEqual({ ok: false, defect: 'target_not_allowed' });
    expect(plan([authEvent()], 'internal')).toEqual({ ok: false, defect: 'target_not_allowed' });
  });
  test('autorização interna no escopo externo ⇒ target_not_allowed', () => {
    expect(plan([authEvent({ external: undefined, targetRef: 'refs/heads/dev', repositoryId: 'https://x/y' })], 'external', 'https://x/y')).toEqual({ ok: false, defect: 'target_not_allowed' });
  });
  test('escopo externo valida destino, modo e repositório', () => {
    expect(plan([authEvent({ targetRef: 'refs/heads/anima-work/x' })], 'external')).toEqual({ ok: false, defect: 'target_not_allowed' });
    expect(plan([authEvent({ mode: 'merge_no_ff' })], 'external')).toEqual({ ok: false, defect: 'target_not_allowed' });
    expect(plan([authEvent()], 'external', externalIntegrationRepositoryId('ext:other'))).toEqual({ ok: false, defect: 'repository_mismatch' });
    // passa da política; falha adiante por não haver resultado aceito (aceite ausente) — prova que a política externa admitiu o destino
    expect(plan([authEvent()], 'external')).toEqual({ ok: false, defect: 'acceptance_missing' });
  });
});
