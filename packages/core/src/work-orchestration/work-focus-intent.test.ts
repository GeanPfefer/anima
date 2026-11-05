import { classifyWorkFocusIntent, isWorkContinuation, isWorkHistoryQuery } from '.';

const kind = (m: string) => classifyWorkFocusIntent(m).kind;

describe('classifyWorkFocusIntent (ACC-01-FIX-02)', () => {
  test.each([
    'Qual trabalho está em foco?',
    'qual trabalho esta em foco',
    'Há algum trabalho em foco?',
    'qual é o foco atual do trabalho?',
    'mostre o trabalho em foco',
    'Qual tarefa está em foco agora?',
    'pode limpar o foco do trabalho?',
  ])('consulta de foco (somente leitura): %s', message => {
    expect(kind(message)).toBe('focus_query');
    expect(isWorkContinuation(message)).toBe(false);
  });

  test.each([
    ['Use fad07a1f como foco do trabalho', 'fad07a1f'],
    ['defina o trabalho fad07a1f-c03b-4211-a42c-c353a1572694 como foco', 'fad07a1f-c03b-4211-a42c-c353a1572694'],
    ['coloque a tarefa 56a74a19 em foco', '56a74a19'],
  ])('definição explícita: %s', (message, reference) => {
    expect(classifyWorkFocusIntent(message)).toEqual({ kind: 'focus_set', reference });
  });

  test('definição sem referência é reconhecida, mas sem alvo', () => {
    expect(classifyWorkFocusIntent('troque o foco do trabalho')).toEqual({ kind: 'focus_set', reference: null });
  });

  test.each(['Limpe o foco do trabalho', 'remova o foco de trabalho', 'tire o trabalho do foco'])('limpeza explícita: %s', message => {
    expect(kind(message)).toBe('focus_clear');
  });

  test.each([
    'perdi o foco nos estudos hoje',
    'preciso de mais foco',
    'qual meu foco hoje?',
    'estou sem foco no trabalho de casa ontem',
    'quais trabalhos estão abertos?',
    'continue o trabalho fad07a1f',
  ])('não é intenção de foco: %s', message => {
    expect(kind(message)).toBe('none');
  });
});

describe('isWorkContinuation — palavras isoladas não bastam', () => {
  test.each([
    'Qual trabalho está em foco?',
    'quais trabalhos estão abertos?',
    'o trabalho terminou?',
    'qual o resultado da proposta?',
    'isso é um problema',
    'nesse caso eu prefiro esperar',
    'a tarefa de casa foi difícil',
    'Use fad07a1f como foco do trabalho',
  ])('não é continuação: %s', message => {
    expect(isWorkContinuation(message)).toBe(false);
  });

  test.each([
    'Continue o trabalho fad07a1f',
    'continuar com a tarefa',
    'retome nesse ponto',
    'ajuste a proposta para reduzir o escopo',
    'corrija o resultado',
    'prossiga com o trabalho',
  ])('continuação legítima preservada: %s', message => {
    expect(isWorkContinuation(message)).toBe(true);
  });

  test('consulta geral de trabalhos continua separada', () => {
    expect(isWorkHistoryQuery('quais trabalhos estão abertos?')).toBe(true);
    expect(isWorkHistoryQuery('onde paramos?')).toBe(true);
    expect(isWorkContinuation('onde paramos?')).toBe(false);
  });
});
