import { interpretWorkRequest, isWorkContinuation, isWorkHistoryQuery, RESUMABLE_WORK_STATES } from '.';

describe('interpretWorkRequest — classificação de capability', () => {
  const cap = (message: string) => {
    const r = interpretWorkRequest(message, 'src');
    return r.kind === 'work_candidate' ? r.command.capability : `nao-candidato:${r.kind}`;
  };

  // Alteração de código vence termos de pesquisa: um pedido para implementar/
  // refatorar/criar código é `programming` ainda que descreva diagnóstico/análise
  // do que será mexido. Cada mensagem passa pelo gate de trabalho (verbo + objeto).
  test.each([
    ['Implemente uma função que analisa a prontidão do projeto e checa o banco.', 'programming'],
    ['Implemente um endpoint na api que faz o diagnóstico do sistema.', 'programming'],
    ['Refatore o código do sistema que tem um bug.', 'programming'],
    ['Crie um teste para a api do chat.', 'programming'],
    // Imperativa "Corrija"/"Corrige" (grafia g→j) agora vira trabalho, não conversa.
    ['Corrija o bug no código do parser.', 'programming'],
    ['Corrige o código da api.', 'programming'],
    // Investigação/análise/documentação SEM alteração de código permanecem research,
    // mesmo mencionando código/api (a pesquisa vence o nome de código no fallback).
    ['Analise a arquitetura do banco de dados.', 'research'],
    ['Documente a api existente do sistema.', 'research'],
    ['Documente o código da api.', 'research'],
    ['Investigue o bug no sistema.', 'research'],
    // Trabalho sem sinal de código nem de pesquisa fica em planning — NÃO vira
    // programming só por ser técnico (guarda anti-falso-positivo).
    ['Prepare uma proposta para o projeto.', 'planning'],
    ['Crie um plano de migração de dados.', 'planning'],
  ] as const)('“%s” → %s', (message, expected) => expect(cap(message)).toBe(expected));

  test('regressão do dogfooding: mandato técnico para preservar estado vira work_candidate', () => {
    const message = [
      'ServedRead Provenance V1',
      'Objetivo: Preservar no resultado de serveReadRequests a proveniência normalizada da leitura.',
      'Escopo funcional: preservar search, lineRange e parâmetros efetivos em ServedRead.',
      'Invariantes: não alterar parseReadRequests, extractSlice, prompts, anchors ou comportamento do R2.',
      'Provas mínimas: adicionar testes do protocolo e manter o typecheck verde.',
    ].join(' ');

    const result = interpretWorkRequest(message, 'served-read-message');

    expect(result.kind).toBe('work_candidate');
    if (result.kind !== 'work_candidate') return;
    expect(result.command.sourceMessageId).toBe('served-read-message');
  });
  test('regressão do operador: implementar/refatorar que menciona diagnóstico/banco é programming, não research', () => {
    // Cenário exato observado na prova manual (endpoint de readiness que checa o banco).
    expect(cap('Implemente uma função que analisa a prontidão do projeto e checa o banco.')).toBe('programming');
    expect(cap('Refatore o código do sistema que tem um bug.')).toBe('programming');
  });

  test('pergunta explicativa não vira trabalho de programação', () => {
    // Termina em "?" → conversa; nunca uma proposta de programming.
    expect(cap('Como implementar um endpoint na api?')).toBe('nao-candidato:conversation');
  });
});

describe('UX-04 — consulta conversacional de histórico de trabalho', () => {
  const positivos = [
    'quais trabalhos tenho em aberto?',
    'meus trabalhos',
    'liste meus trabalhos',
    'me mostra os trabalhos pendentes',
    'tem algum trabalho pausado?',
    'o que ficou pendente?',
    'o que está aguardando decisão',
    'onde paramos?',
    'retomar um trabalho',
    'quero continuar algum trabalho',
    'trabalhos aguardando decisão',
    'tenho decisões pendentes?',
    'tenho algo em andamento?',
  ];
  test.each(positivos)('reconhece a intenção de reencontrar trabalho: %s', message =>
    expect(isWorkHistoryQuery(message)).toBe(true));

  const negativos = [
    'trabalhei muito hoje',
    'meu trabalho é cansativo ultimamente',
    'corri 5km ontem',
    'como estão meus pilares?',
    'estudei espanhol por 30 minutos',
    'prepare a prova determinística do UX-02 para eu revisar antes de executar.',
  ];
  test.each(negativos)('não confunde conversa/registro de vida com consulta de trabalho: %s', message =>
    expect(isWorkHistoryQuery(message)).toBe(false));

  test('consulta de lista é distinta da continuação de um referente específico', () => {
    // "retomar um trabalho" (genérico) → lista; a rota consulta histórico antes.
    expect(isWorkHistoryQuery('retomar um trabalho')).toBe(true);
    // "retome nesse ponto" (referente específico já em foco) → continuação, não lista.
    expect(isWorkHistoryQuery('retome nesse ponto')).toBe(false);
    expect(isWorkContinuation('retome nesse ponto')).toBe(true);
  });

  test('os estados retomáveis são exatamente os não terminais', () => {
    expect([...RESUMABLE_WORK_STATES]).toEqual(['proposed','approved','in_progress','blocked','review','changes_requested']);
    for (const terminal of ['completed','failed','rejected','cancelled']) {
      expect(RESUMABLE_WORK_STATES).not.toContain(terminal);
    }
  });
});
