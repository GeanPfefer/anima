import { deriveResumeCorrectionSuccessor, validateCorrectionSuccessor, type WorkEvent, type WorkItem } from '@anima/core';
import { deriveExplicitReworkScope, planCorrectionFromReview, resolveCorrectionRootAuthority, type ReviewCorrectionFacts } from './review-correction-orchestration';

const ATTEMPT = '0aaf828c-fa1d-4c76-8503-64df7a5041c9';
const BASE_SHA = 'a'.repeat(40);
const COMMIT_SHA = 'b'.repeat(40);
const RESULT_ID = 'e7209bf4-1e93-48ae-8967-25442c508e0b';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const IMPL = 'apps/web/lib/ai/chat-surface.ts';
const TEST = 'apps/web/lib/ai/chat-surface.test.ts';

const original: WorkItem = {
  id: '71445254-c514-41c0-a86a-d9878f04e5e8', userId: 'u', sourceMessageId: 'm', state: 'changes_requested',
  impactLevel: 'low', capability: 'programming', originalRequest: 'dedup allowlist', proposalVersion: 1,
  proposal: {
    schemaVersion: 1,
    data: { summary: 'dedup', objective: 'dedup + testes', includedScope: [IMPL, TEST], excludedScope: ['supabase/'], expectedEffects: ['dedup'], risks: ['semântica'] },
  },
  intent: {
    execution_spec: {
      schema_version: 1, target: { kind: 'project', reference: 'anima' },
      permissions: ['workspace_read', 'workspace_write_isolated'],
      validation_criteria: [{ label: 'test', command: 'npm test --workspace=apps/web -- chat-surface.test.ts' }],
      limits: { max_attempts: 3, max_duration_minutes: 30 }, depends_on_work_item_ids: [],
    },
  },
  createdAt: new Date(), updatedAt: new Date(),
};

const gitEvidenceEvent = (o: { attemptId?: string; changedFiles?: string[] } = {}): WorkEvent => {
  const attemptId = o.attemptId ?? ATTEMPT;
  const changedFiles = o.changedFiles ?? [IMPL];
  return {
    id: 'ev-git', workItemId: original.id, type: 'host_observed_evidence_recorded', author: 'system', proposalVersion: 1, occurredAt: new Date(),
    payload: { data: { work_item_id: original.id, attempt_id: attemptId, approved_proposal_version: 1, evidence: {
      schemaVersion: 1, workItemId: original.id, attemptId, approvedProposalVersion: 1,
      baseSha: BASE_SHA, observedCommitSha: COMMIT_SHA, observedChangedFiles: changedFiles,
      observedDiffSummary: { filesChanged: changedFiles.length, insertions: changedFiles.length, deletions: 0, files: changedFiles.map(path => ({ path, insertions: 1, deletions: 0 })) },
      observedAt: '2026-08-29T00:00:00.000Z', coverage: { git: true, gates: false },
    } } },
  };
};

const resultEvent = (o: { id?: string; attemptId?: string } = {}): WorkEvent => ({
  id: o.id ?? RESULT_ID, workItemId: original.id, type: 'result_submitted', author: 'executor', proposalVersion: 1, occurredAt: new Date(),
  payload: { data: { work_item_id: original.id, attempt_id: o.attemptId ?? ATTEMPT, summary: 'resultado' } },
});

const reviewEvent = (o: { requestedChanges?: string; reviewedResultEventId?: string } = {}): WorkEvent => ({
  id: 'ev-review', workItemId: original.id, type: 'changes_requested', author: 'user', proposalVersion: 1, occurredAt: new Date(),
  payload: { data: {
    requested_changes: o.requestedChanges ?? 'Ampliar os testes para provar deduplicação ordenada e preservação da primeira ocorrência.',
    reviewed_result_event_id: o.reviewedResultEventId ?? RESULT_ID, reviewed_proposal_version: 1,
  } },
});

const facts = (overrides: Partial<ReviewCorrectionFacts> = {}): ReviewCorrectionFacts => ({
  original, events: [gitEvidenceEvent(), resultEvent(), reviewEvent()], existingRecoverySequences: [], ...overrides,
});

const okPlan = (result: ReturnType<typeof planCorrectionFromReview>) => {
  if (!result.ok) throw new Error(`esperava plano, veio bloqueio: ${result.reason} ${result.refusals?.join(',') ?? ''}`);
  return result;
};

describe('planCorrectionFromReview — correção governada por retomada', () => {
  test('rework explícito é limitado ao escopo e basename ambíguo não concede autoridade', () => {
    expect(deriveExplicitReworkScope(`Corrigir ${TEST} e fora.ts`, [IMPL, TEST])).toEqual([TEST]);
    expect(deriveExplicitReworkScope('Corrigir shared.ts', ['a/shared.ts', 'b/shared.ts'])).toEqual([]);
  });
  test('menção preservadora não reabre o arquivo do checkpoint; somente o restante fica gravável', () => {
    const requestedChanges = `A implementação em ${IMPL} está correta e deve ser preservada; corrija ${TEST}.`;
    expect(deriveExplicitReworkScope(requestedChanges, [IMPL, TEST])).toEqual([TEST]);
    const plan = okPlan(planCorrectionFromReview(facts({ events: [
      gitEvidenceEvent(), resultEvent(), reviewEvent({ requestedChanges }),
    ] })));
    expect(plan.candidate.proposal.data.includedScope).toEqual([TEST]);
    expect(plan.candidate.proposal.data.excludedScope).toEqual(expect.arrayContaining([IMPL]));
    const spec = plan.candidate.intent['execution_spec'] as Record<string, unknown>;
    expect(spec['correction_scope']).toEqual({
      rework_scope: [TEST], remaining_scope: [TEST], effective_scope: [TEST],
    });
    expect(plan.candidate.proposal.data.expectedEffects).toContainEqual(expect.stringContaining(`A implementação já verificada (${IMPL}) permanece intacta`));
  });
  test('feedback que manda retrabalhar ambos reabre legitimamente ambos', () => {
    expect(deriveExplicitReworkScope(`Corrija ${IMPL} e ${TEST}.`, [IMPL, TEST])).toEqual([IMPL, TEST]);
    const plan = okPlan(planCorrectionFromReview(facts({ events: [
      gitEvidenceEvent(), resultEvent(), reviewEvent({ requestedChanges: `Corrija ${IMPL} e ${TEST}.` }),
    ] })));
    expect(plan.candidate.proposal.data.includedScope).toEqual([IMPL, TEST]);
  });
  test('deriva candidato válido, escopo=restante, retomando do checkpoint revisado', () => {
    const plan = okPlan(planCorrectionFromReview(facts()));
    expect(validateCorrectionSuccessor(original, plan.candidate)).toMatchObject({ valid: true });
    expect(plan.candidate.proposal.data.includedScope).toEqual([TEST]);
    expect(plan.candidate.proposal.data.excludedScope).toEqual(expect.arrayContaining(['supabase/', IMPL]));
    const resume = (plan.candidate.intent['execution_spec'] as Record<string, unknown>)['resume_from_checkpoint'];
    expect(resume).toEqual({ base_sha: BASE_SHA, branch: `anima-work/${ATTEMPT}`, commit_sha: COMMIT_SHA });
    expect(plan.idempotencyKey).toMatch(UUID);
  });

  test('sequência de lineage avança após terminal e replaya a unidade ativa', () => {
    expect(okPlan(planCorrectionFromReview(facts({ existingRecoverySequences: [] }))).recoverySequence).toBe(1);
    expect(okPlan(planCorrectionFromReview(facts({ existingRecoverySequences: [2, 4] }))).recoverySequence).toBe(5);
    expect(okPlan(planCorrectionFromReview(facts({ existingRecoverySequences: [1], activeRecoverySequence: 1 }))).recoverySequence).toBe(1);
    expect(okPlan(planCorrectionFromReview(facts({ existingRecoverySequences: [1], activeRecoverySequence: 1 }))).idempotencyKey)
      .toBe(okPlan(planCorrectionFromReview(facts())).idempotencyKey);
    const second = okPlan(planCorrectionFromReview(facts({ existingRecoverySequences: [1] })));
    expect(second.recoverySequence).toBe(2);
    expect(second.idempotencyKey).not.toBe(okPlan(planCorrectionFromReview(facts())).idempotencyKey);
    expect(second.idempotencyKey).toBe(okPlan(planCorrectionFromReview(facts({ existingRecoverySequences: [1], activeRecoverySequence: 2 }))).idempotencyKey);
  });

  describe('bloqueios fail-closed', () => {
    test('item não está em changes_requested', () => {
      expect(planCorrectionFromReview(facts({ original: { ...original, state: 'review' } }))).toMatchObject({ ok: false, reason: 'item_unavailable' });
    });
    test('sem pedido de revisão persistido', () => {
      expect(planCorrectionFromReview(facts({ events: [gitEvidenceEvent(), resultEvent()] }))).toMatchObject({ ok: false, reason: 'review_request_missing' });
    });
    test('resultado revisado não encontrado (referência solta)', () => {
      expect(planCorrectionFromReview(facts({ events: [gitEvidenceEvent(), reviewEvent({ reviewedResultEventId: 'inexistente' })] }))).toMatchObject({ ok: false, reason: 'reviewed_result_missing' });
    });
    test('checkpoint de OUTRA tentativa não serve (correlação)', () => {
      expect(planCorrectionFromReview(facts({ events: [gitEvidenceEvent({ attemptId: 'outra' }), resultEvent(), reviewEvent()] }))).toMatchObject({ ok: false, reason: 'checkpoint_evidence_missing' });
    });
    test('checkpoint tocou TODO o escopo + review sem path explícito ⇒ recusa fail-closed', () => {
      const result = planCorrectionFromReview(facts({ events: [gitEvidenceEvent({ changedFiles: [IMPL, TEST] }), resultEvent(), reviewEvent()] }));
      expect(result).toMatchObject({ ok: false, reason: 'derivation_refused' });
      if (!result.ok) expect(result.refusals).toContain('remaining_scope_empty');
    });

    test('checkpoint tocou TODO o escopo + paths explicitamente pedidos ⇒ reabre ambos', () => {
      const result = okPlan(planCorrectionFromReview(facts({ events: [
        gitEvidenceEvent({ changedFiles: [IMPL, TEST] }), resultEvent(),
        reviewEvent({ requestedChanges: `Retrabalhar ${TEST} e ${IMPL}.` }),
      ] })));
      expect(result.candidate.proposal.data.includedScope).toEqual([IMPL, TEST]);
    });
  });
});


describe('planCorrectionFromReview — retrabalho estruturado', () => {
  test('undefined mantém exatamente o plano legado e não acrescenta auditoria', () => {
    const legacy = planCorrectionFromReview(facts());
    expect(planCorrectionFromReview(facts({ reworkPaths: undefined }))).toEqual(legacy);
    const spec = okPlan(legacy).candidate.intent['execution_spec'] as Record<string, unknown>;
    expect(spec['correction_scope']).toEqual({ rework_scope: [], remaining_scope: [TEST], effective_scope: [TEST] });
  });
  test('um arquivo: restante ∪ rework; texto não concede autoridade adicional', () => {
    const scope = [IMPL, TEST, 'apps/web/lib/ai/other.ts'];
    const scopedOriginal = { ...original, proposal: { ...original.proposal, data: { ...original.proposal.data, includedScope: scope } } };
    const plan = okPlan(planCorrectionFromReview(facts({ original: scopedOriginal, reworkPaths: [TEST], events: [
      gitEvidenceEvent({ changedFiles: [IMPL, TEST] }), resultEvent(), reviewEvent({ requestedChanges: `Corrija ${IMPL}.` }),
    ] })));
    expect(plan.candidate.proposal.data.includedScope).toEqual(scope.slice(1));
    expect(plan.candidate.proposal.data.excludedScope).toContain(IMPL);
    expect(plan.candidate.proposal.data.objective).toContain(`Corrija ${IMPL}`);
    expect((plan.candidate.intent['execution_spec'] as Record<string, unknown>)['correction_scope']).toEqual({
      rework_scope: [TEST], remaining_scope: [scope[2]], effective_scope: scope.slice(1), rework_source: 'structured',
    });
  });
  test.each([
    { paths: [], refusal: 'rework_paths_empty' },
    { paths: ['../outside.ts'], refusal: 'rework_paths_malformed' },
    { paths: ['outside.ts'], refusal: 'rework_paths_not_in_scope' },
  ])('recusa estruturada sem candidato: $refusal', ({ paths, refusal }) => {
    expect(planCorrectionFromReview(facts({ reworkPaths: paths }))).toEqual({ ok: false, reason: 'derivation_refused', refusals: [refusal] });
  });
  test('recusa path simultaneamente incluído e excluído', () => {
    const conflicting = { ...original, proposal: { ...original.proposal, data: { ...original.proposal.data, excludedScope: [IMPL] } } };
    expect(planCorrectionFromReview(facts({ original: conflicting, reworkPaths: [IMPL] }))).toEqual({
      ok: false, reason: 'derivation_refused', refusals: ['rework_paths_excluded'],
    });
  });
  test('texto humano continua obrigatório no modo estruturado', () => {
    expect(planCorrectionFromReview(facts({ reworkPaths: [IMPL], events: [gitEvidenceEvent(), resultEvent(), reviewEvent({ requestedChanges: ' ' })] })))
      .toEqual({ ok: false, reason: 'review_request_missing' });
  });
  test('regressão SDC-03: 12 arquivos tocados; feedback sem path/verbo; somente 2 reabertos', () => {
    const scope = Array.from({ length: 12 }, (_, index) => `apps/web/lib/sdc/file-${index}.ts`);
    const scopedOriginal = { ...original, proposal: { ...original.proposal, data: { ...original.proposal.data, includedScope: scope } } };
    const feedback = 'A evidência apresentada é insuficiente para o aceite.';
    const reviewFacts = facts({ original: scopedOriginal, events: [
      gitEvidenceEvent({ changedFiles: scope }), resultEvent(), reviewEvent({ requestedChanges: feedback }),
    ], existingRecoverySequences: [1], additionalValidations: [{ label: 'build', command: 'npm run build --workspace=apps/web' }] });
    expect(planCorrectionFromReview(reviewFacts)).toEqual({ ok: false, reason: 'derivation_refused', refusals: ['remaining_scope_empty'] });
    const selected = [scope[2]!, scope[9]!];
    const plan = okPlan(planCorrectionFromReview({ ...reviewFacts, reworkPaths: [selected[1]!, selected[0]!, selected[1]!] }));
    expect(planCorrectionFromReview({ ...reviewFacts, reworkPaths: selected })).toEqual(plan);
    expect(plan.candidate.proposal.data.includedScope).toEqual(selected);
    expect(plan.candidate.proposal.data.excludedScope).toEqual(['supabase/', ...scope.filter(path => !selected.includes(path))]);
    expect(plan.candidate.proposal.data.objective).toContain(feedback);
    const spec = plan.candidate.intent['execution_spec'] as Record<string, unknown>;
    expect(spec['correction_scope']).toEqual({ rework_scope: selected, remaining_scope: [], effective_scope: selected, rework_source: 'structured' });
    expect(spec['resume_from_checkpoint']).toEqual({ base_sha: BASE_SHA, branch: `anima-work/${ATTEMPT}`, commit_sha: COMMIT_SHA });
    expect(spec['validation_criteria']).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'npm test --workspace=apps/web -- chat-surface.test.ts' }),
      expect.objectContaining({ command: 'npm run build --workspace=apps/web' }),
    ]));
    expect(plan.recoverySequence).toBe(2);
    expect(plan.candidate.recoverySequence).toBe(2);
    expect(plan.candidate.idempotencyKey).toBe(plan.idempotencyKey);
    expect(validateCorrectionSuccessor(scopedOriginal, plan.candidate)).toMatchObject({ valid: true });
  });
});


describe('resolveCorrectionRootAuthority — porta sem banco', () => {
  const correction = (id: string): WorkItem => ({ ...original, id, intent: {
    ...original.intent, execution_spec: { ...(original.intent['execution_spec'] as Record<string, never>), correction_scope: {} },
  } });
  const root = { ...original, id: 'root' };
  test.each([1, 2, 16])('resolve %i hops', async hops => {
    const items = [root, ...Array.from({ length: hops }, (_, i) => correction(`c${i}`))];
    const port = {
      readPredecessor: async (id: string) => { const i = items.findIndex(item => item.id === id); return i > 0 ? items[i - 1]!.id : null; },
      readItem: async (id: string) => items.find(item => item.id === id) ?? null,
    };
    await expect(resolveCorrectionRootAuthority(items[hops]!, port)).resolves.toEqual({ includedScope: [IMPL, TEST], excludedScope: ['supabase/'] });
  });
  test('raiz usa o próprio escopo', async () => {
    const readItem = jest.fn();
    await expect(resolveCorrectionRootAuthority(root, { readPredecessor: async () => null, readItem })).resolves.toEqual({ includedScope: [IMPL, TEST], excludedScope: ['supabase/'] });
    expect(readItem).not.toHaveBeenCalled();
  });
  test('ciclo, profundidade, hop não-correction, item ausente e erros fecham', async () => {
    await expect(resolveCorrectionRootAuthority(correction('c'), { readPredecessor: async () => 'c', readItem: async () => correction('c') })).resolves.toBeNull();
    await expect(resolveCorrectionRootAuthority(correction('0'), { readPredecessor: async id => String(Number(id) + 1), readItem: async id => correction(id) })).resolves.toBeNull();
    await expect(resolveCorrectionRootAuthority(original, { readPredecessor: async () => 'root', readItem: async () => root })).resolves.toBeNull();
    await expect(resolveCorrectionRootAuthority(correction('c'), { readPredecessor: async () => 'root', readItem: async () => null })).resolves.toBeNull();
    await expect(resolveCorrectionRootAuthority(correction('c'), { readPredecessor: async () => { throw new Error('read'); }, readItem: async () => root })).resolves.toBeNull();
    await expect(resolveCorrectionRootAuthority(correction('c'), { readPredecessor: async () => 'root', readItem: async () => { throw new Error('read'); } })).resolves.toBeNull();
  });
  test('plano estruturado reabre com raiz; legado ignora raiz', () => {
    const current = { ...original, proposal: { ...original.proposal, data: { ...original.proposal.data, includedScope: [TEST], excludedScope: ['supabase/', IMPL] } } };
    const scopedFacts = facts({ original: current, events: [gitEvidenceEvent({ changedFiles: [TEST] }), resultEvent(), reviewEvent()] });
    const rootAuthority = original.proposal.data;
    const plan = okPlan(planCorrectionFromReview({ ...scopedFacts, rootAuthority, reworkPaths: [IMPL] }));
    expect(plan.candidate.proposal.data.includedScope).toEqual([IMPL]);
    expect(validateCorrectionSuccessor(current, plan.candidate, { rootAuthority }).valid).toBe(true);
    expect(planCorrectionFromReview({ ...scopedFacts, rootAuthority })).toEqual(planCorrectionFromReview(scopedFacts));
    expect(planCorrectionFromReview({ ...scopedFacts, reworkPaths: [IMPL] }).ok).toBe(false);
  });
});


test('autoridade opcional conserva o plano estruturado normal byte a byte', () => {
  expect(planCorrectionFromReview(facts({ reworkPaths: [TEST], rootAuthority: original.proposal.data })))
    .toEqual(planCorrectionFromReview(facts({ reworkPaths: [TEST] })));
});

test('hop intermediario sem correction_scope fecha a raiz', async () => {
  const current: WorkItem = { ...original, id: 'current', intent: { execution_spec: { correction_scope: {} } } };
  await expect(resolveCorrectionRootAuthority(current, {
    readPredecessor: async id => id === 'current' ? original.id : 'root',
    readItem: async () => original,
  })).resolves.toBeNull();
});


describe('SDC-03 - correction multinível com diff cumulativo', () => {
  const database = 'packages/types/src/database.ts';
  const preserved = [database, ...Array.from({ length: 7 }, (_, index) => `apps/web/lib/preserved-${index}.ts`)];
  const editable = ['supabase/migrations/sdc03.sql', 'supabase/tests/sdc03.test.sql', 'apps/web/lib/sdc03.ts', 'apps/web/lib/sdc03.test.ts'];
  const includedScope = [...preserved, ...editable];
  const excludedScope = Array.from({ length: 8 }, (_, index) => `root-excluded-${index}`);
  const root: WorkItem = { ...original, proposal: { ...original.proposal, data: { ...original.proposal.data, includedScope, excludedScope } } };
  const first = deriveResumeCorrectionSuccessor({ original: root, requestedChanges: 'Completar testes e servi?o',
    checkpoint: { baseSha: BASE_SHA, commitSha: COMMIT_SHA, branch: `anima-work/${ATTEMPT}` },
    preservedFiles: preserved, reworkFiles: [], recoverySequence: 1, idempotencyKey: 'c4000000-0000-4000-8000-000000000001',
  });
  if (!first.ok) throw new Error(first.refusals.join(','));
  const hop: WorkItem = { ...root, intent: first.candidate.intent, proposal: first.candidate.proposal };
  const rootAuthority = { includedScope, excludedScope };
  const events = (changedFiles = includedScope) => [gitEvidenceEvent({ changedFiles }), resultEvent(), reviewEvent()];
  test('retoma do commit observado, reabre database e mantém sete herdados exclu?dos', () => {
    expect(hop.proposal.data.includedScope).toEqual(editable);
    const plan = okPlan(planCorrectionFromReview(facts({ original: hop, events: events(), rootAuthority, reworkPaths: [editable[1]!, database] })));
    expect(plan.candidate.proposal.data.includedScope).toEqual([editable[1]!, database]);
    const spec = plan.candidate.intent['execution_spec'] as Record<string, unknown>;
    expect(spec['correction_scope']).toEqual({ rework_scope: [editable[1]!, database], remaining_scope: [],
      effective_scope: [editable[1]!, database], reopened_scope: [database], rework_source: 'structured', inherited_preserved_scope: preserved.slice(1) });
    expect(spec['resume_from_checkpoint']).toEqual({ base_sha: BASE_SHA, branch: `anima-work/${ATTEMPT}`, commit_sha: COMMIT_SHA });
    expect(plan.candidate.proposal.data.excludedScope).toEqual([...excludedScope, ...preserved.slice(1), editable[0], editable[2], editable[3]]);
    expect(validateCorrectionSuccessor(hop, plan.candidate, { rootAuthority, observedChangedFiles: includedScope })).toMatchObject({ valid: true });
    expect(validateCorrectionSuccessor(hop, plan.candidate)).toMatchObject({ valid: false, gaps: expect.arrayContaining(['correction_scope_invalid']) });
  });
  test('modo legado classifica os mesmos herdados sem reabertura', () => {
    const plan = okPlan(planCorrectionFromReview(facts({ original: hop, rootAuthority, events: [gitEvidenceEvent({ changedFiles: includedScope }), resultEvent(), reviewEvent({ requestedChanges: `Corrija ${editable[1]!}` })] })));
    expect(plan.candidate.proposal.data.includedScope).toEqual([editable[1]!]);
    expect(validateCorrectionSuccessor(hop, plan.candidate, { rootAuthority, observedChangedFiles: includedScope })).toMatchObject({ valid: true });
  });
  test.each(['unexpected.ts', excludedScope[0]!])('não esconde arquivo cumulativo sem autoridade: %s', file => {
    expect(planCorrectionFromReview(facts({ original: hop, rootAuthority, events: events([...includedScope, file]), reworkPaths: [editable[1]!] })))
      .toMatchObject({ ok: false, reason: 'derivation_refused', refusals: ['preserved_files_out_of_scope'] });
  });
  test('sem root authority, sem correction_scope ou sem exclusão comprovada recusa', () => {
    for (const overrides of [{ rootAuthority: undefined }, { original: { ...hop, intent: original.intent } },
      { original: { ...hop, proposal: { ...hop.proposal, data: { ...hop.proposal.data, excludedScope } } } }]) {
      expect(planCorrectionFromReview(facts({ original: hop, rootAuthority, events: events(), reworkPaths: [editable[1]!], ...overrides })))
        .toMatchObject({ ok: false, reason: 'derivation_refused', refusals: ['preserved_files_out_of_scope'] });
    }
  });
});
