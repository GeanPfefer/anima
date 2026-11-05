import { classifyWorkFocusIntent, interpretWorkRequest, isWorkContinuation } from '.';

const kind = (message: string) => interpretWorkRequest(message, 'src').kind;

// ACC-01-FIX-04: consultas, análises e discussões nunca viram proposta persistente;
// pedidos explícitos de trabalho continuam virando.
const REAL_LIVE_PROOF_QUESTION =
  'Quero analisar o desenvolvimento do ANIMA como um todo. Quais trabalhos continuam abertos, quais estão em revisão e quais dependem de alguma decisão minha? Consulte os registros disponíveis, explique as prioridades e diferencie fatos confirmados de recomendações.';
// Variante SEM interrogação: o veto antigo só olhava o "?" final.
const REAL_LIVE_PROOF_NO_QUESTION_MARK =
  'Quero analisar o desenvolvimento do ANIMA como um todo. Consulte os registros disponíveis, explique as prioridades dos trabalhos abertos e diferencie fatos confirmados de recomendações.';

describe('consultas e discussões não criam proposta', () => {
  test.each([
    ['pergunta real da prova viva (com "?" no meio)', REAL_LIVE_PROOF_QUESTION],
    ['a mesma sem nenhuma interrogação', REAL_LIVE_PROOF_NO_QUESTION_MARK],
    ['aprovação', 'Quais trabalhos precisam da minha aprovação?'],
    ['prioridade', 'O que devemos implementar primeiro?'],
    ['como corrigir', 'Como corrigiríamos esse problema?'],
    ['como corrigir sem ?', 'Como corrigiríamos esse problema do chat'],
    ['comparação', 'Compare Codex e Claude Code.'],
    ['comparação com objeto', 'Compare o código do Codex e do Claude Code no sistema.'],
    ['consulta imperativa', 'Me diga o que devemos implementar primeiro no ANIMA.'],
    ['explicação', 'Explique a arquitetura do chat e o fluxo do backlog.'],
    ['desejo de entender', 'Quero entender o projeto e o backlog do ANIMA.'],
    ['discussão', 'Vamos discutir o plano de arquitetura do app.'],
    ['qual trabalho em foco', 'Qual trabalho está em foco?'],
    ['recomendação', 'Que trabalhos do backlog você recomenda priorizar. Explique o porquê.'],
  ])('%s → conversa', (_label, message) => {
    expect(kind(message)).toBe('conversation');
  });

  test('"implementar/corrigir" dentro de pergunta ou análise não autoriza escrita', () => {
    for (const message of [
      'Vale a pena implementar o recurso de foco no app?',
      'Analise se devemos corrigir o bug do chat antes da migração do banco?',
      'Quero saber se devemos refatorar o código do sistema.',
    ]) expect(kind(message)).toBe('conversation');
  });
});

describe('pedidos explícitos continuam criando proposta', () => {
  test.each([
    'Crie uma proposta para corrigir o bug do parser no código da api.',
    'Prepare um mandato para implementar o endpoint de readiness na api.',
    'Monte uma proposta para refatorar o código do chat.',
    'Corrija o bug no código do parser.',
    'Implemente um endpoint na api que faz o diagnóstico do sistema.',
    'Quero corrigir um bug de fronteira no código: abaixo do nível mínimo deve retornar a primeira era. Adicione testes.',
    'Prepare uma proposta para o projeto.',
    'Investigue o bug no sistema.',
  ])('%s → work_candidate', message => {
    expect(kind(message)).toBe('work_candidate');
  });

  test('mandato estruturado com campos rotulados é preservado', () => {
    const message = [
      'ServedRead Provenance V1',
      'Objetivo: Preservar no resultado de serveReadRequests a proveniência normalizada da leitura.',
      'Escopo funcional: preservar search, lineRange e parâmetros efetivos em ServedRead.',
      'Provas mínimas: adicionar testes do protocolo e manter o typecheck verde. Isso é possível agora? Entregue com testes.',
    ].join(' ');
    expect(kind(message)).toBe('work_candidate');
  });

  test('pedido explícito de proposta vence a pergunta embutida na mesma mensagem', () => {
    expect(kind('Prepare uma proposta para organizar o backlog do projeto. Pode ser em etapas pequenas.')).toBe('work_candidate');
  });
});

describe('comandos de foco e continuação seguem separados', () => {
  test('"Continue o trabalho X" é continuação, não novo trabalho nem consulta de foco', () => {
    const message = 'Continue o trabalho fad07a1f';
    expect(isWorkContinuation(message)).toBe(true);
    expect(kind(message)).toBe('conversation');
    expect(classifyWorkFocusIntent(message).kind).toBe('none');
  });

  test('"Qual trabalho está em foco?" é consulta de foco, não continuação nem trabalho', () => {
    const message = 'Qual trabalho está em foco?';
    expect(classifyWorkFocusIntent(message).kind).toBe('focus_query');
    expect(isWorkContinuation(message)).toBe(false);
    expect(kind(message)).toBe('conversation');
  });
});
