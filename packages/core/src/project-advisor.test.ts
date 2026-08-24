import {
  isProjectAdvisorQuestion, validateProjectAdvisoryAnswer, validateProjectAdvisorContext,
  type ProjectAdvisorContext, type ProjectAdvisoryAnswer, type ProjectAdvisoryClaim,
  type ProjectAuthorityLevel,
} from './project-advisor';

const context: ProjectAdvisorContext = {
  question: 'Como está o desenvolvimento do Anima e qual deveria ser nosso próximo passo?',
  sources: [
    { id: 'canon', authority: 'canonical', temporalRole: 'canonical', provenance: 'manifesto', content: 'direção' },
    { id: 'state', authority: 'observed_state', temporalRole: 'current_projection', observedAt: '2026-08-24T16:00:00Z', provenance: 'prd', content: 'estado' },
    { id: 'proof', authority: 'evidence', temporalRole: 'event_sequence', provenance: 'git', content: 'prova' },
    { id: 'history', authority: 'historical_record', temporalRole: 'historical_snapshot', provenance: 'registro', content: 'histórico' },
  ],
};
const authorityById = new Map(context.sources.map(source => [source.id, source.authority]));
const claim = (statement: string, sourceIds: string[], authorityClasses?: ProjectAuthorityLevel[]): ProjectAdvisoryClaim => ({
  statement, sourceIds,
  authorityClasses: authorityClasses ?? [...new Set(sourceIds.flatMap(id => authorityById.get(id) ?? []))],
});
const valid: ProjectAdvisoryAnswer = {
  facts: [claim('O estado foi observado.', ['state'])],
  provenCapabilities: [claim('A capacidade foi provada.', ['proof'])],
  unprovenFrontiers: [claim('A fronteira segue aberta.', ['state', 'history'])],
  canonicalDirections: [claim('A direção é canônica.', ['canon'])],
  recommendation: claim('Recomenda-se fechar a próxima fronteira.', ['canon', 'proof']),
  rationale: [claim('A evidência e a direção sustentam a prioridade.', ['canon', 'proof'])],
  insufficiencies: [],
};
const problems = (patch: Partial<ProjectAdvisoryAnswer>) => validateProjectAdvisoryAnswer({ ...valid, ...patch }, context);

test('reconhece a pergunta canônica sem transformar conversa comum em advisory', () => {
  expect(isProjectAdvisorQuestion(context.question)).toBe(true);
  expect(isProjectAdvisorQuestion('Hoje eu corri por quarenta minutos.')).toBe(false);
});

test('falha fechado quando faltam classes mínimas de contexto', () => {
  expect(validateProjectAdvisorContext({ question: 'estado', sources: context.sources.slice(0, 1) }))
    .toEqual(expect.arrayContaining(['observed_state_missing', 'evidence_source_missing']));
});

test.each([
  ['fato citando canonical', { facts: [claim('Inválido.', ['canon'])] }, 'invalid_fact_authority'],
  ['fato citando histórico', { facts: [claim('Inválido.', ['history'])] }, 'invalid_fact_authority'],
  ['capacidade provada sem evidence', { provenCapabilities: [claim('Inválido.', ['state'])] }, 'missing_evidence_for_proven_capability'],
  ['fronteira apoiada só por canonical', { unprovenFrontiers: [claim('Inválido.', ['canon'])] }, 'invalid_open_frontier_authority'],
  ['direção canônica sem canonical', { canonicalDirections: [claim('Inválido.', ['state'])] }, 'invalid_canonical_direction_source'],
  ['recomendação sem racional', { rationale: [] }, 'missing_recommendation_rationale'],
  ['sourceId inexistente', { facts: [claim('Inválido.', ['missing'], ['observed_state'])] }, 'unknown_source_reference'],
  ['sourceId duplicado', { facts: [claim('Inválido.', ['state', 'state'])] }, 'duplicate_source_reference'],
  ['authorityClass incorreta', { facts: [claim('Inválido.', ['state'], ['evidence'])] }, 'authority_class_mismatch'],
  ['claim sem fonte', { facts: [claim('Inválido.', [])] }, 'claim_without_source'],
  ['conflito canonical e histórico', { recommendation: claim('Inválido.', ['canon', 'history']) }, 'canonical_historical_conflict'],
] as const)('%s produz código seguro', (_name, patch, code) => {
  expect(problems(patch as Partial<ProjectAdvisoryAnswer>)).toContain(code);
});

test('claim válido aceita múltiplas fontes compatíveis', () => {
  expect(problems({ facts: [claim('Observado e provado.', ['state', 'proof'])] })).toEqual([]);
});

test('registro histórico não pode sozinho afirmar o presente, mas continua válido como trajetória', () => {
  expect(problems({ unprovenFrontiers: [claim('A fronteira está aberta agora.', ['history'])] }))
    .toContain('current_claim_without_live_source');
  expect(problems({ unprovenFrontiers: [claim('A fronteira estava aberta no registro anterior.', ['history'])] }))
    .not.toContain('current_claim_without_live_source');
  expect(problems({ unprovenFrontiers: [claim('A fronteira está aberta agora.', ['state', 'history'])] }))
    .not.toContain('current_claim_without_live_source');
});

test('projeção atual exige timestamp auditável', () => {
  expect(validateProjectAdvisorContext({
    question: context.question,
    sources: context.sources.map(source => source.id === 'state' ? { ...source, observedAt: undefined } : source),
  })).toContain('current_projection_timestamp_missing:state');
});

test('recomendação baseada em evidência e canônico é válida', () => {
  expect(problems({
    recommendation: claim('Recomendação advisory.', ['canon', 'proof']),
    rationale: [claim('Fundamentada.', ['canon', 'proof'])],
  })).toEqual([]);
});

test('resposta mínima válida atravessa o validador integralmente', () => {
  const minimal: ProjectAdvisoryAnswer = {
    facts: [], provenCapabilities: [], unprovenFrontiers: [], canonicalDirections: [],
    recommendation: claim('Recomendação mínima.', ['proof']),
    rationale: [claim('Racional mínimo.', ['proof'])],
    insufficiencies: ['As categorias vazias não foram inventadas.'],
  };
  expect(validateProjectAdvisoryAnswer(minimal, context)).toEqual([]);
});
