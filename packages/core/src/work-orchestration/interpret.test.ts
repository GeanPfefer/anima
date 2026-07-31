import { isWorkContinuation, isWorkHistoryQuery, RESUMABLE_WORK_STATES } from '.';

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
