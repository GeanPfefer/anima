import type { Json } from '@anima/types';
import {
  buildHostObservedCoderEvidence,
  buildHostObservedGateEvidence,
  buildHostObservedGitEvidence,
  type WorkEvent,
  type WorkItem,
} from './work-orchestration';
import {
  buildProjectItemDrilldownProjection,
  isProjectItemDrilldownQuestion,
  projectItemDrilldownEvidenceForContext,
  projectResolvedItemQuestion,
  projectItemDrilldownStateForContext,
  resolveProjectItemReference,
} from './project-item-drilldown';
import { buildOperationalProjectSnapshot } from './project-operational-snapshot';
import { validateProjectAdvisoryAnswer, type ProjectAdvisorContext, type ProjectAdvisoryAnswer } from './project-advisor';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: ID, userId: 'user', sourceMessageId: 'message', state: 'failed', impactLevel: 'low', capability: 'programming',
  originalRequest: 'conteúdo pessoal que não pode sair', intent: {},
  proposal: { schemaVersion: 1, data: { summary: 'privado', objective: 'privado', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
  proposalVersion: 2, createdAt: new Date('2026-08-20T10:00:00Z'), updatedAt: new Date('2026-08-24T10:00:00Z'), ...over,
});
const event = (type: WorkEvent['type'], at: string, payload: Record<string, Json> = {}, id = `${type}-${at}`): WorkEvent => ({
  id, workItemId: ID, type, author: type === 'execution_failed' ? 'executor' : 'system', proposalVersion: 2,
  payload: { schema_version: 1, data: payload } as Json, occurredAt: new Date(at),
});
const project = (events: WorkEvent[], over: Partial<WorkItem> = {}) => buildProjectItemDrilldownProjection({
  item: item(over), events, observedAt: '2026-08-24T12:00:00.000Z',
});
const candidates = [
  { id: ID, state: 'failed' as const, capability: 'programming' as const, updatedAt: '2026-08-24T10:00:00Z' },
  { id: OTHER, state: 'failed' as const, capability: 'programming' as const, updatedAt: '2026-08-23T10:00:00Z' },
];

describe('resolução conservadora do drill-down', () => {
  test('detecta perguntas do recorte sem capturar conversa normal', () => {
    expect(isProjectItemDrilldownQuestion(`O que aconteceu no item ${ID}?`)).toBe(true);
    expect(isProjectItemDrilldownQuestion('Hoje corri quarenta minutos.')).toBe(false);
  });
  test('resolve ID estável e prefixo somente quando inequívocos', () => {
    expect(resolveProjectItemReference({ message: `item ${ID}`, candidates })).toMatchObject({ kind: 'resolved', itemId: ID, basis: 'stable_id' });
    expect(resolveProjectItemReference({ message: 'item 11111111', candidates })).toMatchObject({ kind: 'resolved', itemId: ID, basis: 'unique_prefix' });
  });
  test('referência humana ambígua falha fechado', () => {
    expect(resolveProjectItemReference({ message: 'Me mostra uma dessas falhas', candidates })).toMatchObject({ kind: 'clarification_required' });
  });
  test('ordinal é determinístico e foco só vale para referência dêitica', () => {
    expect(resolveProjectItemReference({ message: 'a segunda falha', candidates })).toMatchObject({ kind: 'resolved', itemId: OTHER, basis: 'ordinal' });
    expect(resolveProjectItemReference({ message: 'o que aconteceu nesse item?', candidates, currentFocusId: OTHER })).toMatchObject({ kind: 'resolved', itemId: OTHER, basis: 'current_focus' });
  });
  test('ID inexistente não cai em fuzzy match', () => {
    expect(resolveProjectItemReference({ message: 'item aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', candidates })).toEqual({ kind: 'not_found' });
  });
});

describe('projeção operacional por item', () => {
  test.each(['o primeiro', 'o segundo'])('pergunta ao provider recebe identidade definitiva sem a anáfora %s', original => {
    const question = projectResolvedItemQuestion(ID);
    expect(question).toContain(ID);
    expect(question).toContain('resolvida deterministicamente pelo host');
    expect(question).toContain('definitiva');
    expect(question).not.toContain(original);
    expect(question).not.toContain(OTHER);
    expect(question).not.toContain('lista de candidatos');
  });
  test('recusa referência inválida na pergunta governada', () => {
    expect(() => projectResolvedItemQuestion('primeiro')).toThrow('project_item_ref_invalid');
  });
  test('ordena timeline, limita a 20 e preserva temporalidade', () => {
    const events = Array.from({ length: 22 }, (_, index) => event('checkpoint_recorded', `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00Z`, {}, `e-${index}`)).reverse();
    const value = project(events);
    expect(value.timeline).toHaveLength(20);
    expect(value.timeline[0]!.occurredAt).toBe('2026-08-03T10:00:00.000Z');
    expect(value.timeline.at(-1)!.occurredAt).toBe('2026-08-22T10:00:00.000Z');
    expect(value.timelineCoverage).toEqual({ included: 20, total: 22, olderEventsOmitted: 2 });
    expect(value.observedAt).toBe('2026-08-24T12:00:00.000Z');
  });
  test('falha atual com código seguro é conhecida', () => {
    const value = project([event('execution_failed', '2026-08-24T11:00:00Z', { reason: 'ollama_timeout', message: 'O coder excedeu o limite.' })]);
    expect(value.latestFailure).toMatchObject({ unresolved: true, cause: { status: 'known', code: 'ollama_timeout', safeMessage: 'O coder excedeu o limite.' } });
  });
  test('falha sem evidência causal permanece unknown', () => {
    const value = project([event('execution_failed', '2026-08-24T11:00:00Z', { executor_signal: { output: 'bruto' } })]);
    expect(value.latestFailure?.cause).toEqual({ status: 'unknown', code: null, safeMessage: null });
    expect(value.knownUnknowns).toContain('A causa detalhada da falha não está disponível na projeção governada.');
  });
  test('segredo em mensagem de erro não atravessa', () => {
    const value = project([event('execution_failed', '2026-08-24T11:00:00Z', { message: 'token=super-secreto-123456' })]);
    expect(value.latestFailure?.cause.safeMessage).toBeNull();
  });
  test('falha superada por tentativa posterior não aparece como atual', () => {
    const value = project([
      event('execution_failed', '2026-08-24T10:00:00Z'),
      event('execution_started', '2026-08-24T11:00:00Z', { attempt_id: 'attempt-2', claim_id: 'claim-2', executor_id: 'worktree-v1' }),
    ], { state: 'in_progress' });
    expect(value.latestFailure?.unresolved).toBe(false);
    expect(value.latestAttempt).toMatchObject({ attemptRef: 'attempt-2', status: 'running' });
  });
  test('resultado é presença temporal, sem resumo ou referências brutas', () => {
    const value = project([event('result_submitted', '2026-08-24T11:00:00Z', { summary: 'conteúdo privado', result_references: ['C:/segredo'] })], { state: 'review' });
    expect(value.result).toEqual({ observedAt: '2026-08-24T11:00:00.000Z', accepted: false });
    expect(JSON.stringify(value)).not.toContain('conteúdo privado');
    expect(JSON.stringify(value)).not.toContain('C:/segredo');
  });
  test('ausência de Verifier é descrita como ausência, não como veredito inventado', () => {
    const value = project([]);
    expect(value.verifier).toBeNull();
    expect(value.knownUnknowns).toContain('Nenhum parecer tipado do Verifier foi encontrado para este item.');
  });
  test('parecer tipado verified é resumido sem findings', () => {
    const opinion = {
      schemaVersion: 1, workItemId: ID, attemptId: 'attempt-1', approvedProposalVersion: 2,
      verifierVersion: 'work-verifier-v1', verdict: 'verified', restsOnAttestedEvidence: false,
      summary: { violations: 0, gaps: 0, checks: 7, attested: 2, independent: 5 }, findings: [],
      evidenceBasis: { resultEventId: 'result-1', observedEventId: 'git-1', observedGateEventId: 'gates-1', coverage: { git: true, gates: true } },
    };
    const value = project([event('verifier_opinion_recorded', '2026-08-24T11:00:00Z', {
      work_item_id: ID, attempt_id: 'attempt-1', approved_proposal_version: 2, opinion: opinion as unknown as Json,
    })], { state: 'review' });
    expect(value.verifier).toEqual({ verdict: 'verified', checks: 7, violations: 0, gaps: 0 });
  });
  test('evidências coder, gates e git usam somente resumos seguros', () => {
    const coder = buildHostObservedCoderEvidence({ workItemId: ID, attemptId: 'attempt-1', approvedProposalVersion: 2, backendId: 'ollama-coder', durationMs: 900, outcome: 'succeeded', observedAt: '2026-08-24T11:01:00Z' });
    const gates = buildHostObservedGateEvidence({ workItemId: ID, attemptId: 'attempt-1', approvedProposalVersion: 2, gates: [{ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 100, timedOut: false, cancelled: false }], observedAt: '2026-08-24T11:02:00Z' });
    const git = buildHostObservedGitEvidence({ workItemId: ID, attemptId: 'attempt-1', approvedProposalVersion: 2, baseSha: 'a'.repeat(40), observedCommitSha: 'b'.repeat(40), observedChangedFiles: ['src/secret.ts'], observedDiffFiles: [{ path: 'src/secret.ts', insertions: 3, deletions: 1 }], observedAt: '2026-08-24T11:03:00Z' });
    if (!coder.ok || !gates.ok || !git.ok) throw new Error('fixture inválida');
    const envelope = (type: WorkEvent['type'], evidence: Json, at: string) => event(type, at, { work_item_id: ID, attempt_id: 'attempt-1', approved_proposal_version: 2, origin: 'host', evidence });
    const value = project([
      envelope('host_observed_coder_evidence_recorded', coder.value as unknown as Json, '2026-08-24T11:01:00Z'),
      envelope('host_observed_gate_evidence_recorded', gates.value as unknown as Json, '2026-08-24T11:02:00Z'),
      envelope('host_observed_evidence_recorded', git.value as unknown as Json, '2026-08-24T11:03:00Z'),
    ], { state: 'review' });
    expect(value.evidence.coder).toMatchObject({ backendRef: 'ollama-coder', durationMs: 900 });
    expect(value.evidence.gates).toMatchObject({ total: 1, passed: 1, failed: 0, durationMs: 100 });
    expect(value.evidence.git).toMatchObject({ commitRef: 'b'.repeat(40), filesChanged: 1, insertions: 3, deletions: 1 });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain('npm test');
    expect(serialized).not.toContain('src/secret.ts');
  });
  test('fontes de estado e evidência não contêm payload, pedido ou proposta brutos', () => {
    const value = project([event('execution_failed', '2026-08-24T11:00:00Z', { prompt: 'não enviar', output: 'não enviar' })]);
    const context = projectItemDrilldownStateForContext(value) + projectItemDrilldownEvidenceForContext(value);
    expect(context).not.toContain('conteúdo pessoal');
    expect(context).not.toContain('privado');
    expect(context).not.toContain('não enviar');
    expect(context.length).toBeLessThan(10_000);
  });
  test('a projeção é pura e não muta item ou eventos', () => {
    const sourceItem = item();
    const events = [event('execution_failed', '2026-08-24T11:00:00Z')];
    const before = JSON.stringify({ sourceItem, events });
    buildProjectItemDrilldownProjection({ item: sourceItem, events, observedAt: '2026-08-24T12:00:00Z' });
    expect(JSON.stringify({ sourceItem, events })).toBe(before);
  });
  test('overview global continua bounded e sem payloads do drill-down', () => {
    const snapshot = buildOperationalProjectSnapshot({
      generatedAt: '2026-08-24T12:00:00Z',
      items: candidates.map(candidate => ({ id: candidate.id, state: candidate.state, capability: candidate.capability, updatedAt: candidate.updatedAt })),
      events: [{ workItemId: ID, eventType: 'execution_failed', author: 'executor', occurredAt: '2026-08-24T11:00:00Z' }],
      focus: null,
    });
    expect(JSON.stringify(snapshot)).not.toContain('payload');
    expect(snapshot.recentlyFailed).toHaveLength(2);
  });
  test('matriz de autoridade do Advisor permanece fail-closed', () => {
    const context: ProjectAdvisorContext = { question: 'detalhe', sources: [
      { id: 'canonical', authority: 'canonical', provenance: 'doc', content: 'regra' },
      { id: 'state', authority: 'observed_state', provenance: 'item', content: 'estado', observedAt: '2026-08-24T12:00:00Z', temporalRole: 'current_projection' },
      { id: 'evidence', authority: 'evidence', provenance: 'eventos', content: 'prova', observedAt: '2026-08-24T12:00:00Z', temporalRole: 'event_sequence' },
    ] };
    const claim = { statement: 'x', sourceIds: ['state'], authorityClasses: ['observed_state'] as const };
    const answer: ProjectAdvisoryAnswer = {
      facts: [claim], provenCapabilities: [{ statement: 'prova', sourceIds: ['evidence'], authorityClasses: ['evidence'] }],
      unprovenFrontiers: [claim], canonicalDirections: [{ statement: 'regra', sourceIds: ['canonical'], authorityClasses: ['canonical'] }],
      recommendation: claim, rationale: [claim], insufficiencies: [],
    };
    expect(validateProjectAdvisoryAnswer(answer, context)).toEqual([]);
    expect(validateProjectAdvisoryAnswer({ ...answer, facts: [{ ...claim, sourceIds: ['canonical'], authorityClasses: ['canonical'] }] }, context)).toContain('invalid_fact_authority');
  });
});
