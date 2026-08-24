import type { ProjectAdvisorContext, ProjectAdvisoryAnswer } from '@anima/core';
import { createProjectAdvisorFromModel, projectAdvisoryAnswerSchema, renderProjectAdvisory } from './project-advisor';

const context: ProjectAdvisorContext = {
  question: 'Como está o desenvolvimento?',
  sources: [
    { id: 'canon', authority: 'canonical', provenance: 'manifesto', content: 'direção' },
    { id: 'state', authority: 'observed_state', provenance: 'prd', content: 'estado' },
    { id: 'proof', authority: 'evidence', provenance: 'registro', content: 'prova' },
  ],
};
const answer: ProjectAdvisoryAnswer = {
  facts: [{ statement: 'Estado observado.', sourceIds: ['state'], authorityClasses: ['observed_state'] }],
  provenCapabilities: [{ statement: 'Capacidade provada.', sourceIds: ['proof'], authorityClasses: ['evidence'] }],
  unprovenFrontiers: [{ statement: 'Fronteira aberta.', sourceIds: ['state'], authorityClasses: ['observed_state'] }],
  canonicalDirections: [{ statement: 'Direção vigente.', sourceIds: ['canon'], authorityClasses: ['canonical'] }],
  recommendation: { statement: 'Próximo passo recomendado.', sourceIds: ['canon', 'proof'], authorityClasses: ['canonical', 'evidence'] },
  rationale: [{ statement: 'Há base para priorizá-lo.', sourceIds: ['proof'], authorityClasses: ['evidence'] }],
  insufficiencies: [],
};

test.each(['openai-adapter', 'ollama-adapter'])('o contrato não depende do provider: %s', async () => {
  const advisor = createProjectAdvisorFromModel(async received => {
    expect(received).toEqual(context);
    return JSON.stringify(answer);
  });
  await expect(advisor.advise(context)).resolves.toEqual(answer);
});

test('apresenta as separações sem converter recomendação em ação', () => {
  const text = renderProjectAdvisory(answer);
  expect(text).toContain('Capacidades comprovadas');
  expect(text).toContain('Fronteiras ainda não comprovadas');
  expect(text).toContain('Direções canônicas');
  expect(text).toContain('Recomendação');
  expect(text).not.toMatch(/execut(?:ei|ado)|criei|alterei/i);
});

test('falha fechado para resposta semanticamente incompatível', async () => {
  const invalid = { ...answer, provenCapabilities: [{ statement: 'Sem evidência.', sourceIds: ['state'], authorityClasses: ['observed_state'] }] };
  const advisor = createProjectAdvisorFromModel(async () => JSON.stringify(invalid));
  await expect(advisor.advise(context)).rejects.toThrow('project_advisor_answer_invalid');
});

test('falha fechado com código estrutural seguro antes da semântica', async () => {
  const advisor = createProjectAdvisorFromModel(async () => JSON.stringify({ ...answer, recommendation: { statement: 'sem contrato' } }));
  await expect(advisor.advise(context)).rejects.toThrow('project_advisor_structure_invalid');
});

test('o schema restringe comprovado a evidência e direção a fonte canônica', () => {
  const schema = projectAdvisoryAnswerSchema(context) as {
    properties: Record<string, {
      items?: { properties: { sourceIds: { uniqueItems: boolean; items: { enum: string[] } }; authorityClasses: { items: { enum: string[] } } } };
      anyOf?: unknown[];
    }>;
  };
  expect(schema.properties.provenCapabilities!.items?.properties.sourceIds.items.enum).toEqual(['proof']);
  expect(schema.properties.canonicalDirections!.items?.properties.sourceIds.items.enum).toEqual(['canon']);
  expect(schema.properties.facts!.items?.properties.sourceIds.items.enum).toEqual(['state', 'proof']);
  expect(schema.properties.facts!.items?.properties.sourceIds.uniqueItems).toBe(true);
  expect(schema.properties.provenCapabilities!.items?.properties.authorityClasses.items.enum).toEqual(['evidence']);
  expect(schema.properties.recommendation!.anyOf).toHaveLength(2);
});

test('fixture temporal mantém presente vivo e histórico apenas como trajetória', async () => {
  const temporalContext: ProjectAdvisorContext = {
    question: 'Como está o desenvolvimento do Anima agora?',
    sources: [
      { id: 'canon', authority: 'canonical', temporalRole: 'canonical', provenance: 'manifesto', content: 'recomendação não é decisão' },
      { id: 'live', authority: 'observed_state', temporalRole: 'current_projection', observedAt: '2026-08-24T16:00:00Z', provenance: 'read-only fixture', content: '{"triage":[{"itemRef":"active","state":"in_progress"},{"itemRef":"review","state":"review"}]}' },
      { id: 'proof', authority: 'evidence', temporalRole: 'event_sequence', observedAt: '2026-08-24T16:00:00Z', provenance: 'typed events fixture', content: '{"recentVerifiedEvidence":[{"itemRef":"review"}]}' },
      { id: 'old', authority: 'historical_record', temporalRole: 'historical_snapshot', provenance: 'old record', content: 'active estava failed' },
    ],
  };
  const temporalAnswer: ProjectAdvisoryAnswer = {
    facts: [{ statement: 'O item active está em andamento agora.', sourceIds: ['live'], authorityClasses: ['observed_state'] }],
    provenCapabilities: [{ statement: 'Há evidência verificada para review.', sourceIds: ['proof'], authorityClasses: ['evidence'] }],
    unprovenFrontiers: [{ statement: 'O registro anterior documentava falha, mas não descreve o presente.', sourceIds: ['old'], authorityClasses: ['historical_record'] }],
    canonicalDirections: [{ statement: 'A triagem não decide.', sourceIds: ['canon'], authorityClasses: ['canonical'] }],
    recommendation: { statement: 'Recomenda-se revisar o item review.', sourceIds: ['live', 'proof'], authorityClasses: ['observed_state', 'evidence'] },
    rationale: [{ statement: 'O estado atual e a evidência sustentam atenção.', sourceIds: ['live', 'proof'], authorityClasses: ['observed_state', 'evidence'] }],
    insufficiencies: [],
  };
  const advisor = createProjectAdvisorFromModel(async received => {
    expect(received).toEqual(temporalContext);
    return JSON.stringify(temporalAnswer);
  });
  await expect(advisor.advise(temporalContext)).resolves.toEqual(temporalAnswer);
  expect(renderProjectAdvisory(temporalAnswer)).toContain('Recomendação');
});
