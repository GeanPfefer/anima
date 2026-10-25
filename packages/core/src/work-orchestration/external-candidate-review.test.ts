import { externalTargetToSpecTarget } from './external-target';
import {
  EXTERNAL_CRITERION_REVIEW_KIND, evaluateExternalReviewGate, findExternalPhysicalConflicts, humanReviewCriteria, parseExternalCriterionReview, readExternalCandidate,
  type ExternalCriterionReviewV1,
} from './external-candidate-review';
import { buildExternalWorkProposal, type ExternalWorkInput } from './external-work-proposal';
import { buildWorktreeHandoff } from './worktree-handoff';
import type { WorkEvent, WorkItem } from './types';

const BASE = 'b'.repeat(40), ROOT = 'a'.repeat(40), COMMIT = 'c'.repeat(40), OTHER_COMMIT = 'd'.repeat(40);
const DIGEST = 'e'.repeat(64);
const spec = (reference = 'ext:shop') => externalTargetToSpecTarget({ reference, identity: { repoRootCanonical: 'C:\\work\\shop', gitCommonDirCanonical: 'C:\\work\\shop\\.git', rootCommitSha: ROOT, baseSha: BASE } });
const FILE = 'src/clamp.test.js';
const input = (extra: Partial<ExternalWorkInput> = {}): ExternalWorkInput => ({
  reference: 'ext:shop', objective: 'Corrigir clamp', scope: ['src/clamp.js', FILE], excluded: ['package.json'],
  acceptance: [{ id: 'A1', text: 'clamp(15, 0, 10) retorna 10' }, { id: 'A2', text: 'npm test passa' }, { id: 'A3', text: 'Os testes existentes não foram enfraquecidos' }],
  gates: [{ command: 'npm test', covers: ['A2'] }], bindings: [{ covers: ['A1'], file: FILE, minNewTests: 0, boundTests: ['clamp retorna max quando excede'] }], reviews: ['A3'], backend: 'codex-cli', ...extra,
});
const command = (extra: Partial<ExternalWorkInput> = {}) => { const r = buildExternalWorkProposal(input(extra), spec(), '2026-10-25T12:00:00.000Z'); if (!r.ok) throw new Error(r.code); return r.command; };
const itemOf = (extra: Partial<ExternalWorkInput> = {}, state = 'review'): WorkItem => ({ ...command(extra), id: 'w1', userId: 'u', sourceMessageId: 's', state, originalRequest: 'x', proposalVersion: 1, createdAt: new Date(0), updatedAt: new Date(0) }) as unknown as WorkItem;

const handoff = (over: { attemptId?: string; commit?: string; base?: string } = {}) => {
  const built = buildWorktreeHandoff({ workItemId: 'w1', attemptId: over.attemptId ?? 'att-1', approvedProposalVersion: 1, executorId: 'worktree-v1', backendId: 'codex-cli:default', model: null,
    baseSha: over.base ?? BASE, branch: `anima-work/${over.attemptId ?? 'att-1'}`, commitSha: over.commit ?? COMMIT, status: 'succeeded', changedFiles: ['src/clamp.js'],
    diffFiles: [{ path: 'src/clamp.js', insertions: 2, deletions: 1 }], gates: [{ label: 'npm test', command: 'npm test', exitCode: 0, outcome: 'passed' }] });
  if (!built.ok) throw new Error(built.explanation);
  return built.value;
};
const ev = (id: string, type: WorkEvent['type'], data: Record<string, unknown>): WorkEvent => ({ id, workItemId: 'w1', type, author: 'system', proposalVersion: 1, payload: { schema_version: 1, data } as never, occurredAt: new Date(0) });
const events = (over: { attemptId?: string; commit?: string; observedCommit?: string; observedBase?: string; handoffBase?: string; resultId?: string } = {}): WorkEvent[] => {
  const attemptId = over.attemptId ?? 'att-1';
  return [
    ev(over.resultId ?? 'res-1', 'result_submitted', { work_item_id: 'w1', attempt_id: attemptId, approved_proposal_version: 1, summary: 'feito', result_references: ['x'],
      executor_signal: { worktreeHandoff: handoff({ attemptId, commit: over.commit, base: over.handoffBase }) } }),
    ev('git-1', 'host_observed_evidence_recorded', { attempt_id: attemptId, evidence: { observedCommitSha: over.observedCommit ?? over.commit ?? COMMIT, baseSha: over.observedBase ?? BASE } }),
  ];
};
const review = (over: Partial<ExternalCriterionReviewV1> = {}): ExternalCriterionReviewV1 => ({
  schemaVersion: 1, kind: EXTERNAL_CRITERION_REVIEW_KIND, workItemId: 'w1', approvedProposalVersion: 1, attemptId: 'att-1', resultEventId: 'res-1', candidateCommitSha: COMMIT, baseSha: BASE,
  reference: 'ext:shop', criterion: 'Os testes existentes não foram enfraquecidos', decision: 'accept', diffSha256: DIGEST, reviewerUserId: 'u', reviewedAt: '2026-10-25T12:00:00.000Z', ...over,
});

describe('registro de revisão', () => {
  test('leitura estrita', () => {
    expect(parseExternalCriterionReview(review())).toEqual(review());
    expect(parseExternalCriterionReview({ ...review(), reason: 'ok' })).toMatchObject({ reason: 'ok' });
  });
  test.each([
    ['campo extra', { extra: 1 }], ['kind', { kind: 'outro' }], ['decisão', { decision: 'maybe' }], ['sha curto', { candidateCommitSha: 'abc' }], ['digest curto', { diffSha256: 'abc' }],
    ['versão', { approvedProposalVersion: 0 }], ['data', { reviewedAt: 'ontem' }], ['critério vazio', { criterion: ' ' }], ['reason longa', { reason: 'x'.repeat(1001) }],
  ])('recusa: %s', (_n, patch) => expect(parseExternalCriterionReview({ ...review(), ...patch })).toBeNull());
  test('não-objeto', () => { expect(parseExternalCriterionReview(null)).toBeNull(); expect(parseExternalCriterionReview('x')).toBeNull(); });
});

describe('critérios human_review e candidato', () => {
  test('posições 1-based dos critérios cobertos por human_review', () => {
    expect(humanReviewCriteria(itemOf())).toEqual([{ position: 3, text: 'Os testes existentes não foram enfraquecidos' }]);
  });
  test('candidato a partir dos eventos persistidos', () => {
    expect(readExternalCandidate(itemOf(), events())).toEqual({ ok: true, facts: {
      workItemId: 'w1', approvedProposalVersion: 1, attemptId: 'att-1', resultEventId: 'res-1', candidateCommitSha: COMMIT, baseSha: BASE, branch: 'anima-work/att-1', reference: 'ext:shop', changedFiles: ['src/clamp.js'] } });
  });
  test.each([
    ['sem resultado', [], 'no_reviewable_result'],
    ['commit do handoff ≠ observado pelo host', events({ observedCommit: OTHER_COMMIT }), 'host_observed_commit_mismatch'],
    ['sem evidência do host', events().slice(0, 1), 'host_observed_commit_mismatch'],
    ['base do handoff ≠ identidade autorizada', events({ handoffBase: 'f'.repeat(40), observedBase: 'f'.repeat(40) }), 'base_sha_diverges_from_authorized_identity'],
  ])('recusa: %s', (_n, evs, reason) => expect(readExternalCandidate(itemOf(), evs)).toEqual({ ok: false, reason }));
  test('item que não é trabalho externo', () => {
    const internal = { ...itemOf(), intent: { execution_spec: { target: { kind: 'project', reference: 'anima' } } } } as unknown as WorkItem;
    expect(readExternalCandidate(internal, events())).toEqual({ ok: false, reason: 'not_external_work' });
  });
});

describe('gate do aceite', () => {
  test('sem revisão: bloqueia e nomeia o critério (human_review_pending não é revisão concluída)', () => {
    expect(evaluateExternalReviewGate(itemOf(), events(), [])).toEqual({ ok: false, reason: 'external_human_review_missing', criteria: ['Os testes existentes não foram enfraquecidos'] });
  });
  test('revisão accept do MESMO candidato libera', () => {
    expect(evaluateExternalReviewGate(itemOf(), events(), [review()])).toEqual({ ok: true, reviewed: ['Os testes existentes não foram enfraquecidos'] });
  });
  test('revisão reject bloqueia; a última decisão vence', () => {
    expect(evaluateExternalReviewGate(itemOf(), events(), [review({ decision: 'reject' })])).toMatchObject({ ok: false, reason: 'external_human_review_rejected' });
    expect(evaluateExternalReviewGate(itemOf(), events(), [review({ decision: 'reject' }), review({ decision: 'accept' })])).toMatchObject({ ok: true });
    expect(evaluateExternalReviewGate(itemOf(), events(), [review({ decision: 'accept' }), review({ decision: 'reject' })])).toMatchObject({ ok: false, reason: 'external_human_review_rejected' });
  });
  test.each([
    ['outro commit candidato', { candidateCommitSha: OTHER_COMMIT }], ['outra attempt', { attemptId: 'att-2' }], ['outro resultado', { resultEventId: 'res-2' }],
    ['outra base', { baseSha: 'f'.repeat(40) }], ['outro item', { workItemId: 'w2' }], ['outra versão', { approvedProposalVersion: 2 }], ['outra referência', { reference: 'ext:other' }],
    ['outro critério', { criterion: 'Outro critério' }],
  ])('revisão de %s NÃO é reaproveitada', (_n, patch) => {
    expect(evaluateExternalReviewGate(itemOf(), events(), [review(patch)])).toMatchObject({ ok: false, reason: 'external_human_review_missing' });
  });
  test('candidato novo (nova attempt) invalida a revisão do anterior', () => {
    const second = events({ attemptId: 'att-2', commit: OTHER_COMMIT, resultId: 'res-2' });
    expect(evaluateExternalReviewGate(itemOf(), second, [review()])).toMatchObject({ ok: false, reason: 'external_human_review_missing' });
    expect(evaluateExternalReviewGate(itemOf(), second, [review({ attemptId: 'att-2', candidateCommitSha: OTHER_COMMIT, resultEventId: 'res-2' })])).toMatchObject({ ok: true });
  });
  test('candidato ilegível bloqueia (fail-closed)', () => {
    expect(evaluateExternalReviewGate(itemOf(), [], [review()])).toMatchObject({ ok: false, reason: 'external_candidate_unreadable', detail: 'no_reviewable_result' });
  });
  test('não afeta: item interno do Anima, nem externo sem critério human_review', () => {
    const internal = { ...itemOf(), intent: { execution_spec: { target: { kind: 'project', reference: 'anima' }, validation_criteria: [{ label: 'x', proof: 'human_review', covers: ['y'] }] } } } as unknown as WorkItem;
    expect(evaluateExternalReviewGate(internal, [], [])).toEqual({ ok: true, reviewed: [] });
    const noReview = itemOf({ acceptance: [{ id: 'A1', text: 'um' }, { id: 'A2', text: 'npm test passa' }], bindings: [{ covers: ['A1'], file: FILE, minNewTests: 0, boundTests: ['clamp retorna max quando excede'] }], reviews: [] });
    expect(evaluateExternalReviewGate(noReview, [], [])).toEqual({ ok: true, reviewed: [] });
  });
});

describe('exclusividade física', () => {
  const intentFor = (reference: string, root: string, gitDir = `${root}\\.git`) => ({ execution_spec: { target: externalTargetToSpecTarget({ reference,
    identity: { repoRootCanonical: root, gitCommonDirCanonical: gitDir, rootCommitSha: ROOT, baseSha: BASE } }) } });
  const self = { itemId: 'w1', identity: { repoRootCanonical: 'G:\\lab', gitCommonDirCanonical: 'G:\\lab\\.git' } };
  const now = new Date('2026-10-25T12:00:00.000Z');

  test('outra referência no MESMO repositório é detectada (retida e em execução)', () => {
    const items = [{ id: 'w0', state: 'in_progress', intent: intentFor('ext:old', 'G:\\lab') }, { id: 'w2', state: 'approved', intent: intentFor('ext:new', 'g:/LAB/') }];
    expect(findExternalPhysicalConflicts(self, items, [], now)).toEqual([{ workItemId: 'w0', reference: 'ext:old', kind: 'retained' }]);
    expect(findExternalPhysicalConflicts(self, items, [{ workItemId: 'w2', expiresAt: '2026-10-25T13:00:00.000Z' }], now))
      .toEqual([{ workItemId: 'w0', reference: 'ext:old', kind: 'retained' }, { workItemId: 'w2', reference: 'ext:new', kind: 'running' }]);
  });
  test('mesmo git-common-dir por outro caminho de raiz também conta', () => {
    expect(findExternalPhysicalConflicts(self, [{ id: 'w3', state: 'in_progress', intent: intentFor('ext:x', 'G:\\outro-alias', 'G:\\lab\\.git') }], [], now)).toHaveLength(1);
  });
  test('claim expirado não é execução; outro repositório, o próprio item e itens não externos são ignorados', () => {
    const items = [{ id: 'w2', state: 'approved', intent: intentFor('ext:new', 'G:\\lab') }, { id: 'w4', state: 'in_progress', intent: intentFor('ext:far', 'G:\\outro') },
      { id: 'w1', state: 'in_progress', intent: intentFor('ext:self', 'G:\\lab') }, { id: 'w5', state: 'in_progress', intent: { execution_spec: { target: { kind: 'project', reference: 'anima' } } } }];
    expect(findExternalPhysicalConflicts(self, items, [{ workItemId: 'w2', expiresAt: '2026-10-25T11:00:00.000Z' }], now)).toEqual([]);
  });
});
