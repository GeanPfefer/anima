import {
  validateProjectIdea,
  summarizeProjectIdeaIntake,
  draftProjectIdea,
  projectIdeaStructuringFields,
  type ProjectIdeaV0,
} from './project-intake';

// Fixture conceitual do intake (domínio GENÉRICO — o contrato não sabe de pilates). O
// exemplo do estúdio serve só para tornar o teste legível.
const baseIdea: ProjectIdeaV0 = {
  schemaVersion: 1,
  title: 'Sistema para o estúdio',
  summary: 'Avaliar se vale construir um sistema próprio para o novo estúdio.',
  context: '',
  goal: 'Decidir build/buy/investigate antes de investir tempo de desenvolvimento.',
  stakeholders: [],
  constraints: [],
  openQuestions: [],
  risks: [],
  candidateIntegrations: [],
  mvpHypothesis: null,
  status: 'captured',
};

describe('validateProjectIdea (Project Intake V0)', () => {
  test('uma ideia crua mínima (title/summary/goal) é válida', () => {
    expect(validateProjectIdea(baseIdea)).toBeNull();
  });

  test('uma ideia estruturada é válida', () => {
    const idea: ProjectIdeaV0 = {
      ...baseIdea,
      context: 'Estúdio novo, sem sistema hoje.',
      stakeholders: [{ role: 'dona do estúdio', description: 'quem vai operar o dia a dia' }],
      constraints: ['orçamento baixo', 'sem equipe técnica interna'],
      openQuestions: ['comprar pronto resolve?'],
      risks: ['manutenção contínua sem dev'],
      candidateIntegrations: ['gateway de pagamento'],
      mvpHypothesis: 'agenda + cadastro de alunos, o resto depois',
      status: 'shaping',
    };
    expect(validateProjectIdea(idea)).toBeNull();
  });

  test.each([
    ['não-registro', 42],
    ['nulo', null],
    ['campo faltando', { ...baseIdea, status: undefined }],
    ['campo extra', { ...baseIdea, extra: 1 }],
    ['schemaVersion errado', { ...baseIdea, schemaVersion: 2 }],
    ['title vazio', { ...baseIdea, title: '   ' }],
    ['goal ausente de fato', { ...baseIdea, goal: '' }],
    ['status fora do vocabulário', { ...baseIdea, status: 'done' }],
    ['stakeholder incompleto', { ...baseIdea, stakeholders: [{ role: 'x' }] }],
    ['stakeholder role vazio', { ...baseIdea, stakeholders: [{ role: '', description: 'y' }] }],
    ['constraints com item vazio', { ...baseIdea, constraints: [''] }],
    ['openQuestions duplicadas', { ...baseIdea, openQuestions: ['a', 'a'] }],
    ['mvpHypothesis vazio (deve ser null ou texto)', { ...baseIdea, mvpHypothesis: '  ' }],
  ])('falha fechado: %s', (_label, value) => {
    expect(validateProjectIdea(value)).not.toBeNull();
  });

  test('context vazio é permitido; mvpHypothesis null é permitido', () => {
    expect(validateProjectIdea({ ...baseIdea, context: '', mvpHypothesis: null })).toBeNull();
  });
});

describe('draftProjectIdea (criação pura da estrutura mínima)', () => {
  test('cria uma ideia crua VÁLIDA em `captured`, normalizando o núcleo e zerando o resto', () => {
    const idea = draftProjectIdea({
      title: '  Sistema para o estúdio  ', summary: ' avaliar build/buy ', goal: ' decidir com dados ',
    });
    expect(validateProjectIdea(idea)).toBeNull();
    expect(idea).toMatchObject({
      title: 'Sistema para o estúdio', summary: 'avaliar build/buy', goal: 'decidir com dados',
      context: '', stakeholders: [], constraints: [], openQuestions: [], risks: [],
      candidateIntegrations: [], mvpHypothesis: null, status: 'captured',
    });
  });

  test.each(['title', 'summary', 'goal'])('núcleo vazio (%s) falha na origem — não produz lixo', field => {
    const base = { title: 'a', summary: 'b', goal: 'c' };
    expect(() => draftProjectIdea({ ...base, [field]: '   ' })).toThrow(RangeError);
  });
});

describe('summarizeProjectIdeaIntake (projeção read-only)', () => {
  test('ideia crua: todos os campos estruturantes ficam abertos', () => {
    const summary = summarizeProjectIdeaIntake(baseIdea);
    expect(summary).toMatchObject({
      title: 'Sistema para o estúdio', status: 'captured',
      stakeholderCount: 0, constraintCount: 0, openQuestionCount: 0, riskCount: 0,
      candidateIntegrationCount: 0, hasMvpHypothesis: false,
    });
    expect(summary.openStructuringFields).toEqual([...projectIdeaStructuringFields]);
  });

  test('ideia estruturada: conta e remove os campos preenchidos, mantendo os vazios em ordem', () => {
    const idea: ProjectIdeaV0 = {
      ...baseIdea,
      context: 'tem contexto',
      stakeholders: [{ role: 'dona', description: '' }, { role: 'aluno', description: '' }],
      risks: ['risco 1'],
      mvpHypothesis: 'mvp',
    };
    const summary = summarizeProjectIdeaIntake(idea);
    expect(summary.stakeholderCount).toBe(2);
    expect(summary.riskCount).toBe(1);
    expect(summary.hasMvpHypothesis).toBe(true);
    // context/stakeholders/risks/mvpHypothesis preenchidos → só constraints/openQuestions/candidateIntegrations restam.
    expect(summary.openStructuringFields).toEqual(['constraints', 'openQuestions', 'candidateIntegrations']);
  });
});
