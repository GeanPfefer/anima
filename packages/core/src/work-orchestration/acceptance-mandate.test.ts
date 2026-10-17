/** @jest-environment node */
import {
  ACCEPTANCE_MANDATE_MAX_DURATION_MS,
  ACCEPTANCE_MANDATE_POLICY_VERSION,
  evaluateCandidateIntegrity,
  evaluateMandateAcceptance,
  deriveAcceptanceFacts,
  evaluateMandateGrantRequest,
  isSafeMandateScopePath,
  readPersistedMandatedAcceptance,
  type AcceptanceFacts,
  type AcceptanceMandateGrantRequestV1,
  type CandidateIntegrityContext,
  type CandidateIntegrityV1,
  type MandateRecordView,
  type WorkEvent,
} from './index';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const U = '11111111-1111-4111-8111-111111111111';
const SHA = 'a'.repeat(64);
const BASE = 'b'.repeat(40);
const COMMIT = 'c'.repeat(40);
const FILES = ['packages/core/src/x.test.ts', 'packages/core/src/x.ts'];

const grant = (over: Partial<AcceptanceMandateGrantRequestV1> = {}): AcceptanceMandateGrantRequestV1 => ({
  workItemId: U, proposalVersion: 1, contractSha256: SHA, baseSha: BASE, scopeFiles: [...FILES].reverse(),
  notBefore: '2026-10-17T12:00:00.000Z', expiresAt: '2026-10-18T11:00:00.000Z', requestId: '22222222-2222-4222-8222-222222222222', ...over,
});

describe('isSafeMandateScopePath', () => {
  test('aceita caminhos relativos normais', () => {
    expect(FILES.every(isSafeMandateScopePath)).toBe(true);
  });
  test.each([
    ['vazio', ''], ['absoluto', '/etc/passwd'], ['windows', 'C:\\x\\y.ts'], ['barra invertida', 'a\\b.ts'], ['escape', '../x.ts'], ['meio com ..', 'a/../b.ts'],
    ['ponto', './a.ts'], ['dupla barra', 'a//b.ts'], ['espaço nas pontas', ' a.ts'], ['nulo', 'a\0b.ts'],
    ['migrations', 'supabase/migrations/1.sql'], ['supabase tests', 'supabase/tests/a.sql'], ['claude', '.claude/settings.json'], ['github', '.github/workflows/a.yml'],
    ['env', '.env.local'], ['env web', 'apps/web/.env.local'], ['scripts raiz', 'scripts/a.ts'], ['scripts web', 'apps/web/scripts/a.ts'],
    ['política de autorização', 'packages/core/src/work-orchestration/autonomous-authorization.ts'],
    ['a própria política do mandato', 'packages/core/src/work-orchestration/acceptance-mandate.ts'],
    ['writer', 'apps/web/lib/work-orchestration/trusted-system-writer.ts'],
    ['caixa diferente (NTFS aliasa)', 'Supabase/migrations/1.sql'], ['caixa em scripts', 'SCRIPTS/a.ts'], ['caixa em .github', '.GitHub/workflows/a.yml'],
    ['caixa no writer', 'apps/web/lib/work-orchestration/Trusted-System-Writer.ts'], ['caixa na política do mandato', 'packages/core/src/work-orchestration/Acceptance-Mandate.ts'],
    ['.gitmodules', '.gitmodules'], ['.gitattributes', '.gitattributes'], ['dentro de .git', '.git/hooks/pre-commit'],
    ['nome curto 8.3', 'SUPABA~1/x.sql'], ['stream alternativo', 'packages/core/src/a.ts:evil'], ['curinga', 'packages/core/src/*.ts'], ['caractere de controle', 'packages/core/src/a.ts'],
    ['ponto final no segmento', 'packages/core/src/a.'], ['espaço final no segmento', 'packages /core/src/a.ts'], ['aspas', 'packages/core/src/"a".ts'],
  ])('recusa %s', (_n, path) => { expect(isSafeMandateScopePath(path)).toBe(false); });
  test('recusa tipos não-string', () => {
    for (const v of [null, undefined, 1, {}, []]) expect(isSafeMandateScopePath(v)).toBe(false);
  });
});

describe('evaluateMandateGrantRequest', () => {
  test('normaliza (escopo ordenado) e aceita um pedido válido', () => {
    const r = evaluateMandateGrantRequest(grant(), NOW);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.value.scopeFiles).toEqual(FILES);
  });
  test('aceita exatamente 24 h', () => {
    expect(evaluateMandateGrantRequest(grant({ expiresAt: new Date(Date.parse('2026-10-17T12:00:00.000Z') + ACCEPTANCE_MANDATE_MAX_DURATION_MS).toISOString() }), NOW).ok).toBe(true);
  });
  test.each([
    ['item inválido', { workItemId: 'x' }, 'invalid_work_item'],
    ['versão 0', { proposalVersion: 0 }, 'invalid_proposal_version'],
    ['versão fracionária', { proposalVersion: 1.5 }, 'invalid_proposal_version'],
    ['hash curto', { contractSha256: 'abc' }, 'invalid_contract_hash'],
    ['hash maiúsculo', { contractSha256: 'A'.repeat(64) }, 'invalid_contract_hash'],
    ['base curta', { baseSha: 'abc' }, 'invalid_base_sha'],
    ['request_id inválido', { requestId: 'x' }, 'invalid_request_id'],
    ['escopo vazio', { scopeFiles: [] }, 'invalid_scope'],
    ['escopo duplicado', { scopeFiles: [FILES[0]!, FILES[0]!] }, 'invalid_scope'],
    ['escopo grande demais', { scopeFiles: Array.from({ length: 21 }, (_, i) => `packages/core/src/f${i}.ts`) }, 'invalid_scope'],
    ['caminho sensível', { scopeFiles: ['supabase/migrations/1.sql'] }, 'unsafe_scope_path'],
    ['janela invertida', { notBefore: '2026-10-18T00:00:00Z', expiresAt: '2026-10-17T13:00:00Z' }, 'invalid_window'],
    ['janela inválida', { expiresAt: 'ontem' }, 'invalid_window'],
    ['já expirado', { notBefore: '2026-10-17T08:00:00Z', expiresAt: '2026-10-17T11:00:00Z' }, 'window_in_past'],
    ['mais de 24 h', { expiresAt: '2026-10-18T12:00:01Z' }, 'window_too_long'],
  ] as const)('recusa %s', (_n, over, defect) => {
    expect(evaluateMandateGrantRequest(grant(over as Partial<AcceptanceMandateGrantRequestV1>), NOW)).toMatchObject({ ok: false, defect });
  });
});

const integrity = (over: Partial<CandidateIntegrityV1> = {}): CandidateIntegrityV1 => ({
  schemaVersion: 1, commitSha: COMMIT, baseSha: BASE, parentShas: [BASE], commitCount: 1, mergeCount: 0, baseIsAncestor: true,
  changedFiles: FILES, changeStatuses: FILES.map(path => ({ path, status: 'A' })), checkedAt: NOW.toISOString(), ...over,
});
const ctx = (over: Partial<CandidateIntegrityContext> = {}): CandidateIntegrityContext => ({
  mandateBaseSha: BASE, mandateScopeFiles: FILES, hostObservedCommitSha: COMMIT, hostObservedBaseSha: BASE,
  hostObservedChangedFiles: FILES, handoffCommitSha: COMMIT, ...over,
});

describe('evaluateCandidateIntegrity', () => {
  test('candidato íntegro: filho único da base, sem merges, escopo exato, só adições', () => {
    expect(evaluateCandidateIntegrity(integrity(), ctx())).toEqual({ ok: true });
  });
  test.each([
    ['commit diferente do handoff', integrity({ commitSha: 'd'.repeat(40) }), ctx(), 'integrity_commit_mismatch'],
    ['commit diferente do observado pelo host', integrity(), ctx({ hostObservedCommitSha: 'd'.repeat(40) }), 'integrity_commit_mismatch'],
    ['base diferente do mandato', integrity({ baseSha: 'd'.repeat(40), parentShas: ['d'.repeat(40)] }), ctx(), 'integrity_base_mismatch'],
    ['base diferente da observada', integrity(), ctx({ hostObservedBaseSha: 'd'.repeat(40) }), 'integrity_base_mismatch'],
    ['base não é ancestral', integrity({ baseIsAncestor: false }), ctx(), 'base_not_ancestor'],
    ['tem merges', integrity({ mergeCount: 1 }), ctx(), 'has_merges'],
    ['dois commits', integrity({ commitCount: 2 }), ctx(), 'not_single_child_of_base'],
    ['pai diferente da base', integrity({ parentShas: ['d'.repeat(40)] }), ctx(), 'not_single_child_of_base'],
    ['dois pais', integrity({ parentShas: [BASE, 'd'.repeat(40)] }), ctx(), 'not_single_child_of_base'],
    ['arquivo extra', integrity({ changedFiles: [...FILES, 'packages/core/src/y.ts'], changeStatuses: [...FILES, 'packages/core/src/y.ts'].map(path => ({ path, status: 'A' })) }), ctx(), 'scope_mismatch'],
    ['arquivo a menos', integrity({ changedFiles: [FILES[0]!], changeStatuses: [{ path: FILES[0]!, status: 'A' }] }), ctx(), 'scope_mismatch'],
    ['escopo do host diverge', integrity(), ctx({ hostObservedChangedFiles: [FILES[0]!] }), 'host_scope_mismatch'],
    ['modificação em vez de adição', integrity({ changeStatuses: FILES.map(path => ({ path, status: 'M' })) }), ctx(), 'disallowed_change_status'],
    ['status sem um dos arquivos', integrity({ changeStatuses: [{ path: FILES[0]!, status: 'A' }] }), ctx(), 'disallowed_change_status'],
    ['forma inválida', { ...integrity(), schemaVersion: 2 } as unknown as CandidateIntegrityV1, ctx(), 'invalid_integrity_shape'],
    ['campos ausentes', {} as CandidateIntegrityV1, ctx(), 'invalid_integrity_shape'],
  ] as const)('recusa %s', (_n, i, c, defect) => {
    expect(evaluateCandidateIntegrity(i, c)).toEqual({ ok: false, defect });
  });
  test('permite status adicionais somente quando o contexto os autoriza', () => {
    expect(evaluateCandidateIntegrity(integrity({ changeStatuses: FILES.map(path => ({ path, status: 'M' })) }), ctx({ allowedStatuses: ['A', 'M'] }))).toEqual({ ok: true });
  });
});

const mandate = (over: Partial<MandateRecordView> = {}): MandateRecordView => ({
  id: '33333333-3333-4333-8333-333333333333', workItemId: U, proposalVersion: 1, contractSha256: SHA, baseSha: BASE, scopeFiles: FILES,
  notBefore: '2026-10-17T11:00:00.000Z', expiresAt: '2026-10-18T11:00:00.000Z', allowedActions: ['accept'],
  policyVersion: ACCEPTANCE_MANDATE_POLICY_VERSION, revokedAt: null, consumedAt: null, grantedEventSeq: 10, ...over,
});
const facts = (over: Partial<AcceptanceFacts> = {}): AcceptanceFacts => ({
  itemState: 'review', itemProposalVersion: 1, impactLevel: 'low', currentContractSha256: SHA, latestResultEventId: 'r1', reviewedResultEventId: 'r1',
  executionStartedSeq: 20, executionStartedCount: 1,
  verifier: { verdict: 'verified', version: 'work-verifier-v6', gaps: 0, violations: 0, correlatedToResult: true, testBindingRequired: true, testBindingIndependent: true },
  contextFact: { executionMode: 'unattended', attemptMatches: true }, classificationHumanConfirmed: true,
  paidComputeObserved: false, integrationObserved: false, pendingHumanResolution: false, ...over,
});

describe('evaluateMandateAcceptance', () => {
  test('todas as condições satisfeitas', () => {
    expect(evaluateMandateAcceptance(mandate(), facts(), NOW)).toEqual({ ok: true });
  });
  test.each([
    ['ação ampliada', mandate({ allowedActions: ['accept', 'integrate'] }), facts(), 'action_not_allowed'],
    ['ação diferente', mandate({ allowedActions: ['integrate'] }), facts(), 'action_not_allowed'],
    ['política alterada', mandate({ policyVersion: 'acceptance-mandate-v0' }), facts(), 'policy_changed'],
    ['revogado', mandate({ revokedAt: '2026-10-17T11:30:00Z' }), facts(), 'mandate_revoked'],
    ['consumido (replay)', mandate({ consumedAt: '2026-10-17T11:30:00Z' }), facts(), 'mandate_consumed'],
    ['ainda não vigente', mandate({ notBefore: '2026-10-17T13:00:00Z', expiresAt: '2026-10-17T20:00:00Z' }), facts(), 'mandate_not_yet_valid'],
    ['expirado', mandate({ expiresAt: '2026-10-17T11:59:59Z' }), facts(), 'mandate_expired'],
    ['expira exatamente agora', mandate({ expiresAt: '2026-10-17T12:00:00Z' }), facts(), 'mandate_expired'],
    ['outra versão', mandate({ proposalVersion: 2 }), facts(), 'wrong_item_or_version'],
    ['item não está em review', mandate(), facts({ itemState: 'completed' }), 'item_not_in_review'],
    ['resultado revisado não é o mais recente', mandate(), facts({ reviewedResultEventId: 'r0' }), 'result_not_latest'],
    ['contrato mudou', mandate(), facts({ currentContractSha256: 'f'.repeat(64) }), 'contract_changed'],
    ['impacto não é baixo', mandate(), facts({ impactLevel: 'significant' }), 'impact_not_low'],
    ['mandato concedido depois da attempt', mandate({ grantedEventSeq: 25 }), facts(), 'not_anticipated'],
    ['mandato concedido no mesmo seq', mandate({ grantedEventSeq: 20 }), facts(), 'not_anticipated'],
    ['sem attempt', mandate(), facts({ executionStartedSeq: null }), 'not_anticipated'],
    ['duas attempts', mandate(), facts({ executionStartedCount: 2 }), 'multiple_attempts'],
    ['sem parecer', mandate(), facts({ verifier: null }), 'verifier_missing'],
    ['parecer inconclusivo', mandate(), facts({ verifier: { ...facts().verifier!, verdict: 'inconclusive' } }), 'verifier_not_verified'],
    ['parecer rejeitado', mandate(), facts({ verifier: { ...facts().verifier!, verdict: 'rejected' } }), 'verifier_not_verified'],
    ['verifier v5', mandate(), facts({ verifier: { ...facts().verifier!, version: 'work-verifier-v5' } }), 'verifier_version_too_old'],
    ['lacunas', mandate(), facts({ verifier: { ...facts().verifier!, gaps: 1 } }), 'verifier_gaps_or_violations'],
    ['violações', mandate(), facts({ verifier: { ...facts().verifier!, violations: 1 } }), 'verifier_gaps_or_violations'],
    ['parecer de outro resultado', mandate(), facts({ verifier: { ...facts().verifier!, correlatedToResult: false } }), 'verifier_not_correlated'],
    ['test_binding não independente', mandate(), facts({ verifier: { ...facts().verifier!, testBindingIndependent: false } }), 'test_binding_not_independent'],
    ['sem fato de contexto', mandate(), facts({ contextFact: null }), 'context_fact_missing_or_invalid'],
    ['fato de outra attempt', mandate(), facts({ contextFact: { executionMode: 'unattended', attemptMatches: false } }), 'context_fact_missing_or_invalid'],
    ['fato manual', mandate(), facts({ contextFact: { executionMode: 'manual', attemptMatches: true } }), 'context_fact_missing_or_invalid'],
    ['classificação não humana', mandate(), facts({ classificationHumanConfirmed: false }), 'classification_not_human_confirmed'],
    ['compute pago', mandate(), facts({ paidComputeObserved: true }), 'paid_compute_present'],
    ['integração anterior', mandate(), facts({ integrationObserved: true }), 'integration_present'],
    ['decisão humana pendente', mandate(), facts({ pendingHumanResolution: true }), 'human_resolution_pending'],
  ] as const)('recusa %s', (_n, m, f, defect) => {
    const r = evaluateMandateAcceptance(m, f, NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.defects).toContain(defect);
  });
  test('test_binding independente só é exigido quando o contrato o declara', () => {
    expect(evaluateMandateAcceptance(mandate(), facts({ verifier: { ...facts().verifier!, testBindingRequired: false, testBindingIndependent: false } }), NOW)).toEqual({ ok: true });
  });
  test('acumula todos os defeitos (não para no primeiro)', () => {
    const r = evaluateMandateAcceptance(mandate({ revokedAt: 'x', consumedAt: 'y' }), facts({ impactLevel: 'high', paidComputeObserved: true }), NOW);
    expect(!r.ok && r.defects).toEqual(expect.arrayContaining(['mandate_revoked', 'mandate_consumed', 'impact_not_low', 'paid_compute_present']));
  });
});

const accepted = (over: { author?: WorkEvent['author']; data?: Record<string, unknown>; authority?: Record<string, unknown>; type?: string } = {}): WorkEvent => ({
  id: 'e1', workItemId: U, type: (over.type ?? 'result_accepted') as WorkEvent['type'], author: over.author ?? 'system', proposalVersion: 1, seq: 99, occurredAt: NOW,
  payload: { schema_version: 1, data: {
    accepted_result_event_id: 'r1', decided_by: 'trusted_system_writer', verifier_event_id: 'v1', execution_context_event_id: 'c1',
    candidate: { commit_sha: COMMIT, base_sha: BASE },
    authority: { kind: 'human_mandate', mandate_id: '33333333-3333-4333-8333-333333333333', grant_event_seq: 10, contract_sha256: SHA, policy_version: ACCEPTANCE_MANDATE_POLICY_VERSION, ...over.authority },
    ...over.data,
  } } as unknown as WorkEvent['payload'],
});

describe('readPersistedMandatedAcceptance', () => {
  test('lê o aceite mandatado íntegro', () => {
    expect(readPersistedMandatedAcceptance(accepted())).toMatchObject({ eventSeq: 99, mandateId: '33333333-3333-4333-8333-333333333333', grantEventSeq: 10, commitSha: COMMIT });
  });
  test('aceite HUMANO (autor user) nunca é lido como mandatado, mesmo com payload idêntico', () => {
    for (const author of ['user', 'anima', 'executor'] as const) expect(readPersistedMandatedAcceptance(accepted({ author }))).toBeNull();
  });
  test('tipo diferente de result_accepted é ignorado', () => {
    expect(readPersistedMandatedAcceptance(accepted({ type: 'changes_requested' }))).toBeNull();
  });
  test.each([
    ['sem decided_by', { decided_by: undefined }, {}],
    ['decided_by errado', { decided_by: 'runner' }, {}],
    ['authority.kind errado', {}, { kind: 'human' }],
    ['mandate_id inválido', {}, { mandate_id: 'x' }],
    ['grant_event_seq ausente', {}, { grant_event_seq: undefined }],
    ['hash inválido', {}, { contract_sha256: 'abc' }],
    ['política antiga', {}, { policy_version: 'acceptance-mandate-v0' }],
    ['sem verifier_event_id', { verifier_event_id: undefined }, {}],
    ['sem fato de contexto', { execution_context_event_id: undefined }, {}],
    ['commit inválido', { candidate: { commit_sha: 'x' } }, {}],
    ['sem accepted_result_event_id', { accepted_result_event_id: undefined }, {}],
  ])('recusa %s', (_n, data, authority) => {
    expect(readPersistedMandatedAcceptance(accepted({ data, authority }))).toBeNull();
  });
  test('payload vazio ou histórico (aceite antigo sem authority) ⇒ null', () => {
    expect(readPersistedMandatedAcceptance({ ...accepted(), payload: {} })).toBeNull();
    expect(readPersistedMandatedAcceptance({ ...accepted(), payload: { data: { accepted_result_event_id: 'r1' } } })).toBeNull();
  });
});

describe('deriveAcceptanceFacts (a partir do ledger)', () => {
  const ev = (seq: number, type: string, data: Record<string, unknown>, author: WorkEvent['author'] = 'system', id = `e${seq}`): WorkEvent => ({
    id, workItemId: U, type: type as WorkEvent['type'], author, proposalVersion: 1, seq, occurredAt: NOW,
    payload: { schema_version: 1, data } as unknown as WorkEvent['payload'],
  });
  const ledger = (): WorkEvent[] => [
    ev(1, 'work_approved', {}, 'user'),
    ev(2, 'work_intelligence_classified', { classification: { complexity: 'bounded', risk: 'low', reversibility: 'reversible', planClarity: 'clear', provenance: { kind: 'human_confirmed' } } }, 'user'),
    ev(10, 'work_mandate_granted', {}, 'user'),
    ev(20, 'execution_started', { attempt_id: 'att' }, 'anima'),
    ev(30, 'result_submitted', { attempt_id: 'att', executor_signal: { worktreeHandoff: { commitSha: COMMIT } } }, 'executor', 'res'),
    ev(31, 'host_observed_evidence_recorded', { attempt_id: 'att', evidence: { baseSha: BASE, observedCommitSha: COMMIT, observedChangedFiles: FILES } }, 'system', 'git'),
    ev(32, 'host_observed_execution_context_recorded', {
      attempt_id: 'att', approved_proposal_version: 1, origin: 'host', recorded_by: 'trusted_system_writer', execution_mode: 'unattended', actor_kind: 'automated_runner',
      evidence: { attemptId: 'att', approvedProposalVersion: 1, executionMode: 'unattended', actorKind: 'automated_runner' },
      authority: { approval_author: 'user', approval_authority: 'human', approved_seq: 1, classified_seq: 2, leases_observed: 0, human_acts_after_mandate: 0 },
    }),
    ev(33, 'verifier_opinion_recorded', { attempt_id: 'att', result_event_id: 'res', verdict: 'verified', verifier_version: 'work-verifier-v6', observed_event_id: 'git',
      opinion: { verifierVersion: 'work-verifier-v6', summary: { gaps: 0, violations: 0 }, findings: [{ code: 'test_binding_satisfied', provenance: 'independent' }] } }),
  ];
  const derive = (events: WorkEvent[], over: Partial<Parameters<typeof deriveAcceptanceFacts>[0]> = {}) =>
    deriveAcceptanceFacts({ itemState: 'review', itemProposalVersion: 1, impactLevel: 'low', testBindingRequired: true, events, reviewedResultEventId: 'res', contractSha256FromMandate: SHA, ...over });

  test('ledger completo ⇒ fatos coerentes e avaliação aprova', () => {
    const d = derive(ledger());
    expect(d).toMatchObject({ attemptId: 'att', handoffCommitSha: COMMIT, hostEvidence: { observedCommitSha: COMMIT, baseSha: BASE } });
    expect(d.facts.verifier).toMatchObject({ verdict: 'verified', version: 'work-verifier-v6', gaps: 0, violations: 0, correlatedToResult: true, testBindingIndependent: true });
    expect(d.facts.contextFact).toEqual({ executionMode: 'unattended', attemptMatches: true });
    expect(d.facts.executionStartedSeq).toBe(20);
    expect(evaluateMandateAcceptance(mandate({ grantedEventSeq: 10 }), d.facts, NOW)).toEqual({ ok: true });
  });
  test('sem parecer / sem fato / sem evidência git ⇒ defeitos explícitos', () => {
    const events = ledger().filter(e => e.type !== 'verifier_opinion_recorded' && e.type !== 'host_observed_execution_context_recorded' && e.type !== 'host_observed_evidence_recorded');
    const d = derive(events);
    expect(d.facts.verifier).toBeNull(); expect(d.facts.contextFact).toBeNull(); expect(d.hostEvidence).toBeNull();
    const r = evaluateMandateAcceptance(mandate({ grantedEventSeq: 10 }), d.facts, NOW);
    expect(!r.ok && r.defects).toEqual(expect.arrayContaining(['verifier_missing', 'context_fact_missing_or_invalid']));
  });
  test('parecer de OUTRO resultado não é correlacionado', () => {
    const events = ledger().map(e => e.type === 'verifier_opinion_recorded' ? ({ ...e, payload: { data: { ...(e.payload as { data: Record<string, unknown> }).data, result_event_id: 'outro' } } as unknown as WorkEvent['payload'] }) : e);
    expect(derive(events).facts.verifier).toBeNull();
  });
  test('fato de contexto não gravado pelo sistema ⇒ não vale', () => {
    const events = ledger().map(e => e.type === 'host_observed_execution_context_recorded' ? { ...e, author: 'user' as const } : e);
    expect(derive(events).facts.contextFact).toBeNull();
  });
  test('classificação de sistema, compute pago, integração e segunda attempt são detectados', () => {
    const base = ledger();
    const sys = [...base, ev(40, 'work_intelligence_classified', { classification: { complexity: 'bounded', risk: 'low', reversibility: 'reversible', planClarity: 'clear', provenance: { kind: 'system_assessed' } } })];
    expect(derive(sys).facts.classificationHumanConfirmed).toBe(false);
    expect(derive([...base, ev(41, 'compute_preference_recorded', { preference: { strategy: 'provider_api' } }, 'user')]).facts.paidComputeObserved).toBe(true);
    expect(derive([...base, ev(42, 'integration_decided', {}, 'user')]).facts.integrationObserved).toBe(true);
    expect(derive([...base, ev(43, 'execution_started', { attempt_id: 'att2' }, 'anima')]).facts.executionStartedCount).toBe(2);
  });
  test('resultado revisado diferente do mais recente é marcado', () => {
    const d = derive([...ledger(), ev(50, 'result_submitted', { attempt_id: 'att' }, 'executor', 'res2')]);
    expect(d.facts.latestResultEventId).toBe('res2');
    expect(evaluateMandateAcceptance(mandate({ grantedEventSeq: 10 }), d.facts, NOW)).toMatchObject({ ok: false });
  });
});
