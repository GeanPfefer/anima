import type { Json } from '@anima/types';
import {
  buildIntegrationEffectReceipt,
  buildWorktreeHandoff,
  classifyIntegrationTarget,
  integrationOperationKey,
  integrationReceiptMatchesAuthorization,
  isAllowedIntegrationMode,
  isAllowedIntegrationTargetRef,
  planIntegrationEffect,
  projectIntegrationCompleted,
  projectIntegrationEffectAuthorization,
  projectIntegrationStatus,
  sameIntegrationEffect,
  type IntegrationEffectAuthorizationV1,
  type WorkEvent,
  type WorkItem,
} from './index';

const BASE = 'a'.repeat(40);
const COMMIT = 'b'.repeat(40);
const DEV = 'c'.repeat(40);
const REPO = 'https://github.com/example/anima';

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: 'work-1', userId: 'u', sourceMessageId: 'm', state: 'completed', impactLevel: 'low', capability: 'programming',
  originalRequest: 'x', intent: {} as WorkItem['intent'],
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
  proposalVersion: 1, createdAt: new Date(), updatedAt: new Date(), ...over,
});

const handoff = () => {
  const built = buildWorktreeHandoff({
    workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 1, executorId: 'worktree-v1', backendId: 'fake', model: null,
    baseSha: BASE, branch: 'anima-work/attempt-1', commitSha: COMMIT, status: 'succeeded',
    changedFiles: ['a.ts'], diffFiles: [{ path: 'a.ts', insertions: 1, deletions: 0 }], gates: [{ label: 'g', command: 'npm test', exitCode: 0, outcome: 'passed' }],
  });
  if (!built.ok) throw new Error(built.explanation);
  return built.value;
};

const ev = (id: string, type: string, data: Record<string, unknown>, author = 'system'): WorkEvent => ({
  id, workItemId: 'work-1', type: type as WorkEvent['type'], author: author as WorkEvent['author'], proposalVersion: 1,
  payload: { schema_version: 1, data } as unknown as Json, occurredAt: new Date(),
});

const authData = (over: Record<string, unknown> = {}) => {
  const base = {
    authorization_id: 'auth-1', work_item_id: 'work-1', approved_proposal_version: 1, attempt_id: 'attempt-1',
    accepted_result_event_id: 'ev-result', result_commit_sha: COMMIT, repository_id: REPO, target_ref: 'refs/heads/dev',
    expected_target_sha: DEV, mode: 'merge_no_ff', ...over,
  };
  return {
    ...base,
    operation_key: integrationOperationKey({
      authorizationId: base.authorization_id, acceptedResultEventId: base.accepted_result_event_id, repositoryId: base.repository_id,
      targetRef: base.target_ref, expectedTargetSha: base.expected_target_sha, resultCommitSha: base.result_commit_sha, mode: base.mode,
    }),
    ...(over.operation_key ? { operation_key: over.operation_key } : {}),
  };
};

const chain = (authOver: Record<string, unknown> = {}, extra: WorkEvent[] = []): WorkEvent[] => [
  ev('ev-result', 'result_submitted', { attempt_id: 'attempt-1', summary: 'x', result_references: [], executor_signal: { worktreeHandoff: handoff() } }, 'executor'),
  ev('ev-accept', 'result_accepted', { accepted_result_event_id: 'ev-result' }, 'user'),
  ...extra,
  ev('ev-auth', 'integration_effect_authorized', authData(authOver), 'user'),
];

const plan = (events: WorkEvent[], over: Partial<{ item: WorkItem; authorizationId: string; trustedRepositoryId: string }> = {}) =>
  planIntegrationEffect({ item: over.item ?? item(), events, authorizationId: over.authorizationId ?? 'auth-1', trustedRepositoryId: over.trustedRepositoryId ?? REPO });

describe('integration effect — alvo', () => {
  test.each(['refs/heads/main', 'main', 'origin/main', 'refs/remotes/origin/main', 'dev', 'refs/remotes/origin/dev', 'refs/heads/dev2', ''])(
    '12/26. %p negado', (ref) => expect(isAllowedIntegrationTargetRef(ref)).toBe(false));
  test('só refs/heads/dev', () => expect(isAllowedIntegrationTargetRef('refs/heads/dev')).toBe(true));
});

describe('planIntegrationEffect — revalidação contra fatos persistidos', () => {
  test('1. cadeia completa ⇒ plano', () => {
    const result = plan(chain());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.authorization).toMatchObject({ resultCommitSha: COMMIT, expectedTargetSha: DEV, targetRef: 'refs/heads/dev' });
  });

  test('2/13. sem autorização de merge ⇒ negado (aceite sozinho não integra)', () => {
    const events = chain().filter((event) => event.type !== 'integration_effect_authorized');
    expect(plan(events)).toEqual({ ok: false, defect: 'authorization_not_found' });
  });

  test('16. integration_decided (V1) NÃO serve como autorização de merge', () => {
    const decided = ev('ev-decided', 'integration_decided', { decision: 'authorize', decision_id: 'auth-1', accepted_result_event_id: 'ev-result', attempt_id: 'attempt-1' }, 'user');
    const events = [...chain().filter((event) => event.type !== 'integration_effect_authorized'), decided];
    expect(plan(events)).toEqual({ ok: false, defect: 'authorization_not_found' });
  });

  test('autorização precisa ser author=user', () => {
    const events = chain().map((event) => event.type === 'integration_effect_authorized' ? { ...event, author: 'system' as WorkEvent['author'] } : event);
    expect(plan(events)).toEqual({ ok: false, defect: 'authorization_not_found' });
  });

  test('3/24. autorização para outro resultado aceito ⇒ negado', () => {
    expect(plan(chain({ accepted_result_event_id: 'ev-other' }))).toEqual({ ok: false, defect: 'accepted_result_changed' });
  });

  test('4. versão/attempt/commit divergentes ⇒ negado', () => {
    expect(plan(chain(), { item: item({ proposalVersion: 2 }) })).toEqual({ ok: false, defect: 'proposal_version_changed' });
    expect(plan(chain({ attempt_id: 'attempt-x' }))).toEqual({ ok: false, defect: 'attempt_mismatch' });
    expect(plan(chain({ result_commit_sha: 'd'.repeat(40) }))).toEqual({ ok: false, defect: 'result_commit_mismatch' });
  });

  test('14. autorização sem aceite / item não concluído ⇒ negado', () => {
    const noAccept = chain().filter((event) => event.type !== 'result_accepted');
    expect(plan(noAccept)).toEqual({ ok: false, defect: 'acceptance_missing' });
    expect(plan(chain(), { item: item({ state: 'review' }) })).toEqual({ ok: false, defect: 'item_not_completed' });
  });

  test('11/12/26. alvo/modo/repositório fora da allowlist ⇒ negado (payload com main é negado)', () => {
    expect(plan(chain({ target_ref: 'refs/heads/main' }))).toEqual({ ok: false, defect: 'target_not_allowed' });
    expect(plan(chain({ mode: 'fast_forward' }))).toEqual({ ok: false, defect: 'mode_not_allowed' });
    expect(plan(chain(), { trustedRepositoryId: 'https://github.com/evil/other' })).toEqual({ ok: false, defect: 'repository_mismatch' });
  });

  test('23. chave de operação divergente ⇒ negado', () => {
    expect(plan(chain({ operation_key: 'integration-effect:forjada' }))).toEqual({ ok: false, defect: 'operation_key_mismatch' });
  });

  test('item diferente da autorização ⇒ negado', () => {
    expect(plan(chain({ work_item_id: 'work-2' }))).toEqual({ ok: false, defect: 'item_mismatch' });
  });
});

describe('classifyIntegrationTarget — TOCTOU e ambiguidade', () => {
  const auth = projectIntegrationEffectAuthorization(chain(), 'auth-1') as IntegrationEffectAuthorizationV1;

  test('alvo no SHA esperado ⇒ ready', () => {
    expect(classifyIntegrationTarget(auth, { targetSha: DEV, targetParents: [], resultCommitInTarget: false })).toBe('ready');
  });
  test('5. alvo avançou ⇒ stale (nunca rebase/recalcular)', () => {
    expect(classifyIntegrationTarget(auth, { targetSha: 'e'.repeat(40), targetParents: [DEV], resultCommitInTarget: false })).toBe('stale');
  });
  test('9. alvo é o merge exato [esperado, resultado] ⇒ already_effected (reconciliar, não repetir)', () => {
    expect(classifyIntegrationTarget(auth, { targetSha: 'f'.repeat(40), targetParents: [DEV, COMMIT], resultCommitInTarget: true })).toBe('already_effected');
  });
  test('17. alvo contém o commit sem ser o merge exato ⇒ ambiguous', () => {
    expect(classifyIntegrationTarget(auth, { targetSha: COMMIT, targetParents: [BASE], resultCommitInTarget: true })).toBe('ambiguous');
  });
  test('22. merge com pais inesperados ⇒ não é o efeito', () => {
    expect(classifyIntegrationTarget(auth, { targetSha: 'f'.repeat(40), targetParents: [COMMIT, DEV], resultCommitInTarget: true })).toBe('ambiguous');
    expect(classifyIntegrationTarget(auth, { targetSha: 'f'.repeat(40), targetParents: [DEV, COMMIT, BASE], resultCommitInTarget: true })).toBe('ambiguous');
  });
});

describe('receipt', () => {
  const auth = projectIntegrationEffectAuthorization(chain(), 'auth-1') as IntegrationEffectAuthorizationV1;
  const merge = '1'.repeat(40);

  test('15. receipt reproduz exatamente o efeito observado', () => {
    const receipt = buildIntegrationEffectReceipt(auth, { mergeCommitSha: merge, mergeParents: [DEV, COMMIT], resultingTargetSha: merge }, 'effected');
    expect(receipt).toMatchObject({
      authorizationId: 'auth-1', workItemId: 'work-1', proposalVersion: 1, attemptId: 'attempt-1', acceptedResultEventId: 'ev-result',
      resultCommitSha: COMMIT, repositoryId: REPO, targetRef: 'refs/heads/dev', mode: 'merge_no_ff',
      previousTargetSha: DEV, resultingTargetSha: merge, mergeCommitSha: merge, mergeParents: [DEV, COMMIT], observed: true,
    });
  });

  test('22. pais inesperados ou alvo ≠ merge ⇒ sem receipt', () => {
    expect(buildIntegrationEffectReceipt(auth, { mergeCommitSha: merge, mergeParents: [COMMIT, DEV], resultingTargetSha: merge }, 'effected')).toBeNull();
    expect(buildIntegrationEffectReceipt(auth, { mergeCommitSha: merge, mergeParents: [DEV, COMMIT], resultingTargetSha: DEV }, 'effected')).toBeNull();
  });

  test('mesma identidade de efeito independe da disposição e da ordem das chaves', () => {
    const a = buildIntegrationEffectReceipt(auth, { mergeCommitSha: merge, mergeParents: [DEV, COMMIT], resultingTargetSha: merge }, 'effected')!;
    const b = buildIntegrationEffectReceipt(auth, { mergeCommitSha: merge, mergeParents: [DEV, COMMIT], resultingTargetSha: merge }, 'reconciled')!;
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(b).reverse())));
    expect(sameIntegrationEffect(a, reordered)).toBe(true);
    expect(sameIntegrationEffect(a, { ...b, mergeCommitSha: '2'.repeat(40), resultingTargetSha: '2'.repeat(40) })).toBe(false);
  });
});

describe('Trusted System Writer V0 — projeção endurecida (defesa em profundidade)', () => {
  const merge = '1'.repeat(40);
  const auth = projectIntegrationEffectAuthorization(chain(), 'auth-1') as IntegrationEffectAuthorizationV1;
  const receipt = buildIntegrationEffectReceipt(auth, { mergeCommitSha: merge, mergeParents: [DEV, COMMIT], resultingTargetSha: merge }, 'effected')!;
  const completed = (author: string, r: unknown = receipt) => ev('ev-integrated', 'integration_completed', { authorization_id: 'auth-1', receipt: r }, author);

  test('21. receipt de sistema válido ⇒ integrated', () => {
    expect(projectIntegrationStatus([...chain(), completed('system')])).toBe('integrated');
  });

  test('receipt gravado por sessão humana (author=user) NÃO conta', () => {
    expect(projectIntegrationCompleted([...chain(), completed('user')])).toBeNull();
    expect(projectIntegrationStatus([...chain(), completed('user')])).toBe('not_integrated');
  });

  test.each([
    ['pais invertidos', { mergeParents: [COMMIT, DEV] }],
    ['alvo main', { targetRef: 'refs/heads/main' }],
    ['SHA anterior diferente do esperado', { previousTargetSha: 'e'.repeat(40) }],
    ['alvo resultante ≠ merge', { resultingTargetSha: DEV }],
    ['commit diferente', { resultCommitSha: 'd'.repeat(40) }],
    ['chave de operação diferente', { operationKey: 'integration-effect:x' }],
    ['não observado', { observed: false }],
  ])('receipt de sistema que não reproduz a autorização (%s) ⇒ invalid_receipt', (_name, patch) => {
    expect(projectIntegrationStatus([...chain(), completed('system', { ...receipt, ...patch })])).toBe('invalid_receipt');
  });

  test('receipt sem autorização humana correspondente ⇒ invalid_receipt', () => {
    const events = [...chain().filter((e) => e.type !== 'integration_effect_authorized'), completed('system')];
    expect(projectIntegrationStatus(events)).toBe('invalid_receipt');
  });

  test('plano sinaliza receipt persistido divergente', () => {
    const result = plan([...chain(), completed('system', { ...receipt, mergeParents: [COMMIT, DEV] })]);
    expect(result.ok && result.plan.persistedMismatch).toBe(true);
    const clean = plan([...chain(), completed('system')]);
    expect(clean.ok && clean.plan.persistedMismatch).toBe(false);
  });
});

describe('modo ff_only (V1)', () => {
  const ffChain = (over: Record<string, unknown> = {}, extra: WorkEvent[] = []) => chain({ mode: 'ff_only', ...over }, extra);
  const ffAuth = projectIntegrationEffectAuthorization(ffChain(), 'auth-1') as IntegrationEffectAuthorizationV1;
  const mergeAuth = projectIntegrationEffectAuthorization(chain(), 'auth-1') as IntegrationEffectAuthorizationV1;
  const ffObserved = { mergeCommitSha: null, mergeParents: [] as string[], resultingTargetSha: COMMIT };
  const ffReceipt = () => buildIntegrationEffectReceipt(ffAuth, ffObserved, 'effected')!;

  test('allowlist de modos: só merge_no_ff e ff_only (comparação exata)', () => {
    expect(isAllowedIntegrationMode('merge_no_ff')).toBe(true);
    expect(isAllowedIntegrationMode('ff_only')).toBe(true);
    for (const mode of ['fast_forward', 'ff', 'FF_ONLY', 'merge', '', undefined, null]) expect(isAllowedIntegrationMode(mode)).toBe(false);
  });

  test('plano aceita ff_only; modo desconhecido ⇒ mode_not_allowed; alvo main segue negado', () => {
    expect(plan(ffChain()).ok).toBe(true);
    expect(plan(chain({ mode: 'ff' }))).toEqual({ ok: false, defect: 'mode_not_allowed' });
    expect(plan(ffChain({ target_ref: 'refs/heads/main' }))).toEqual({ ok: false, defect: 'target_not_allowed' });
    expect(plan(ffChain({ target_ref: 'origin/main' }))).toEqual({ ok: false, defect: 'target_not_allowed' });
  });

  test('o modo faz parte da chave de operação (ff_only ≠ merge_no_ff para a mesma autorização)', () => {
    expect(ffAuth.operationKey).not.toBe(mergeAuth.operationKey);
    expect(ffAuth.operationKey.endsWith(':ff_only')).toBe(true);
    expect(plan(ffChain({ operation_key: mergeAuth.operationKey }))).toEqual({ ok: false, defect: 'operation_key_mismatch' });
  });

  test('classificação: alvo no SHA esperado ⇒ ready', () => {
    expect(classifyIntegrationTarget(ffAuth, { targetSha: DEV, targetParents: [], resultCommitInTarget: false })).toBe('ready');
  });
  test('classificação: alvo avançou (sem o resultado) ⇒ stale', () => {
    expect(classifyIntegrationTarget(ffAuth, { targetSha: 'e'.repeat(40), targetParents: [DEV], resultCommitInTarget: false, expectedTargetInTargetHistory: true })).toBe('stale');
  });
  test('classificação: alvo = commit do resultado descendente do esperado ⇒ already_effected', () => {
    expect(classifyIntegrationTarget(ffAuth, { targetSha: COMMIT, targetParents: [DEV], resultCommitInTarget: true, expectedTargetInTargetHistory: true })).toBe('already_effected');
  });
  test('classificação: alvo = commit do resultado SEM comprovar descendência do esperado ⇒ ambiguous (não conclui)', () => {
    expect(classifyIntegrationTarget(ffAuth, { targetSha: COMMIT, targetParents: [BASE], resultCommitInTarget: true })).toBe('ambiguous');
    expect(classifyIntegrationTarget(ffAuth, { targetSha: COMMIT, targetParents: [BASE], resultCommitInTarget: true, expectedTargetInTargetHistory: false })).toBe('ambiguous');
  });
  test('classificação: alvo contém o resultado mas está além dele (ou é merge) ⇒ ambiguous', () => {
    expect(classifyIntegrationTarget(ffAuth, { targetSha: 'f'.repeat(40), targetParents: [DEV, COMMIT], resultCommitInTarget: true, expectedTargetInTargetHistory: true })).toBe('ambiguous');
  });
  test('merge_no_ff intocado: o merge exato continua already_effected e o ff NÃO é aceito como efeito dele', () => {
    expect(classifyIntegrationTarget(mergeAuth, { targetSha: 'f'.repeat(40), targetParents: [DEV, COMMIT], resultCommitInTarget: true })).toBe('already_effected');
    expect(classifyIntegrationTarget(mergeAuth, { targetSha: COMMIT, targetParents: [DEV], resultCommitInTarget: true, expectedTargetInTargetHistory: true })).toBe('ambiguous');
  });

  test('receipt ff_only válido: mode, previous/resulting/result e NENHUM merge commit', () => {
    expect(ffReceipt()).toMatchObject({
      mode: 'ff_only', previousTargetSha: DEV, resultingTargetSha: COMMIT, resultCommitSha: COMMIT,
      mergeCommitSha: null, mergeParents: [], observed: true, disposition: 'effected', targetRef: 'refs/heads/dev',
    });
  });

  test.each([
    ['merge commit inventado', { mergeCommitSha: '1'.repeat(40), mergeParents: [] as string[], resultingTargetSha: COMMIT }],
    ['pais de merge', { mergeCommitSha: null, mergeParents: [DEV, COMMIT], resultingTargetSha: COMMIT }],
    ['alvo resultante ≠ commit do resultado', { mergeCommitSha: null, mergeParents: [] as string[], resultingTargetSha: DEV }],
  ])('receipt ff_only inconsistente (%s) ⇒ sem receipt', (_name, observed) => {
    expect(buildIntegrationEffectReceipt(ffAuth, observed, 'effected')).toBeNull();
  });

  test('receipt ff_only não é aceito para autorização merge_no_ff (e vice-versa)', () => {
    expect(buildIntegrationEffectReceipt(mergeAuth, ffObserved, 'effected')).toBeNull();
    expect(buildIntegrationEffectReceipt(ffAuth, { mergeCommitSha: '1'.repeat(40), mergeParents: [DEV, COMMIT], resultingTargetSha: '1'.repeat(40) }, 'effected')).toBeNull();
    expect(integrationReceiptMatchesAuthorization(mergeAuth, ffReceipt())).toBe(false);
  });

  test('projeção: receipt ff_only de sistema reproduzindo a autorização ⇒ integrated', () => {
    const done = ev('ev-integrated', 'integration_completed', { authorization_id: 'auth-1', receipt: ffReceipt() }, 'system');
    expect(projectIntegrationStatus([...ffChain(), done])).toBe('integrated');
  });

  test.each([
    ['merge commit inventado', { mergeCommitSha: '1'.repeat(40) }],
    ['pais de merge', { mergeParents: [DEV, COMMIT] }],
    ['alvo resultante ≠ commit do resultado', { resultingTargetSha: DEV }],
    ['modo divergente da autorização', { mode: 'merge_no_ff' }],
    ['SHA anterior diferente do esperado', { previousTargetSha: 'e'.repeat(40) }],
    ['alvo main', { targetRef: 'refs/heads/main' }],
  ])('projeção: receipt ff_only inconsistente (%s) ⇒ invalid_receipt', (_name, patch) => {
    const done = ev('ev-integrated', 'integration_completed', { authorization_id: 'auth-1', receipt: { ...ffReceipt(), ...patch } }, 'system');
    expect(projectIntegrationStatus([...ffChain(), done])).toBe('invalid_receipt');
  });

  test('identidade de efeito ff_only: independe da disposição; difere se o alvo resultante difere', () => {
    const a = ffReceipt();
    const b = buildIntegrationEffectReceipt(ffAuth, ffObserved, 'reconciled')!;
    expect(sameIntegrationEffect(a, b)).toBe(true);
    expect(sameIntegrationEffect(a, { ...b, resultingTargetSha: DEV })).toBe(false);
    expect(sameIntegrationEffect(a, { ...b, mergeParents: [DEV] })).toBe(false);
  });
});
