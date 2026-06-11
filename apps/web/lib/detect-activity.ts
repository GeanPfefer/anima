export type DetectedActivity = {
  pillarName: string;
  durationMinutes: number;
  note: string;
  activityDate?: string; // ISO yyyy-mm-dd, inferida do texto
};

// Detecta atividades intencionais realizadas em mensagens do usuário.
// Suporta mensagens que cobrem múltiplos dias (infere a data de cada atividade).
// Conservador por design — falso negativo é melhor que registrar lixo.
export async function detectActivities(
  message: string,
  pillarNames: string[],
  today: string = new Date().toISOString().slice(0, 10),
): Promise<DetectedActivity[]> {
  if (!pillarNames.length) return [];

  const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

  // Build a reference calendar so the model can resolve weekday names to ISO dates
  const todayDate = new Date(today + 'T12:00:00');
  const weekdays  = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  const calLines  = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() - i);
    const label = i === 0 ? 'hoje' : i === 1 ? 'ontem' : weekdays[d.getDay()]!;
    return `  ${label} = ${d.toISOString().slice(0, 10)}`;
  }).join('\n');

  const pillarList = pillarNames.map(n => `  - "${n}"`).join('\n');

  const prompt = [
    'Detecte atividades intencionais realizadas na mensagem abaixo.',
    'A mensagem pode cobrir VÁRIOS dias — extraia uma entrada por atividade.',
    '',
    `HOJE = ${today}`,
    'CALENDÁRIO DE REFERÊNCIA (para inferir activityDate):',
    calLines,
    'Se a data não puder ser inferida com segurança, omita "activityDate".',
    '',
    'PILARES DISPONÍVEIS (use EXATAMENTE estes nomes):',
    pillarList,
    '',
    'REGISTRE — atividades com esforço intencional:',
    '+ exercício, esporte, treino (corrida, academia, natação, yoga...)',
    '+ estudo, leitura, curso, aprendizado',
    '+ trabalho, projeto, tarefa concluída, reunião produtiva',
    '+ meditação, terapia, prática espiritual',
    '+ criação (música, arte, escrita, código)',
    '+ cuidado ativo com saúde (consulta, tratamento)',
    '+ atividade social intencional (encontro planejado, ligação importante)',
    '',
    'NÃO REGISTRE — rotina básica:',
    '- comer, beber, almoçar, jantar',
    '- dormir, descansar, assistir TV',
    '- deslocamento comum, compras rotineiras',
    '- perguntas, planos futuros, sentimentos sem ação',
    '',
    'REGRA DE PILAR: mapeie para o pilar da lista que melhor se encaixa.',
    'exercício/saúde/corpo → pilar de saúde; estudo/livro → pilar de mente;',
    'trabalho/projeto/código → pilar profissional; amigos/família → pilar social.',
    'Use SOMENTE nomes da lista. Se nenhum encaixa → não registre.',
    '',
    'Cada item do array deve ter:',
    '  "pillarName": string — nome EXATO de um pilar da lista',
    '  "durationMinutes": number — minutos (0 se não mencionado)',
    '  "note": string — descrição curta, máx 80 chars',
    '  "activityDate": string? — ISO yyyy-mm-dd (omitir se incerta)',
    '',
    'Conversões: 1h=60, meia hora=30, 2h30=150, 45min=45, uma hora=60',
    '',
    'Mensagem:',
    '"""',
    message.replace(/"""/g, "'''").slice(0, 2500),
    '"""',
    '',
    'Retorne APENAS um array JSON válido. Se nada se encaixa, retorne [].',
  ].join('\n');

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:   OLLAMA_MODEL,
        prompt,
        stream:  false,
        format:  'json',
        options: { temperature: 0.1 },
      }),
    });

    if (!res.ok) return [];

    const body = await res.json() as { response: string };

    let result: unknown;
    try {
      result = JSON.parse(body.response);
    } catch {
      const m = body.response.match(/\[[\s\S]*\]/);
      result = m ? JSON.parse(m[0]) : [];
    }

    const arr = Array.isArray(result)
      ? result
      : ((result as Record<string, unknown>)?.activities ??
         (result as Record<string, unknown>)?.data ??
         []);

    return (Array.isArray(arr) ? arr : []).filter(
      (a): a is DetectedActivity =>
        typeof (a as DetectedActivity)?.pillarName === 'string' &&
        (a as DetectedActivity).pillarName.trim().length > 0,
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
