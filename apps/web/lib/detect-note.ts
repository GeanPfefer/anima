export type DetectedNote = {
  noteType: 'food' | 'expense' | 'mood' | 'idea' | 'other';
  content: string;
  context: Record<string, unknown>;
  pillarHint: string | null;
  noteDate?: string; // ISO yyyy-mm-dd, inferida do texto
};

// Detecta notas silenciosas (alimentação, gastos, humor, ideias) em mensagens.
// Suporta mensagens que cobrem múltiplos dias.
// Nunca captura atividades intencionais — essas vão para detectActivities.
export async function detectNotes(
  message: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<DetectedNote[]> {
  const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

  const todayDate = new Date(today + 'T12:00:00');
  const weekdays  = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  const calLines  = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() - i);
    const label = i === 0 ? 'hoje' : i === 1 ? 'ontem' : weekdays[d.getDay()]!;
    return `  ${label} = ${d.toISOString().slice(0, 10)}`;
  }).join('\n');

  const prompt = [
    'Detecte notas de captura na mensagem abaixo.',
    'A mensagem pode cobrir VÁRIOS dias — extraia uma nota por ocorrência.',
    '',
    `HOJE = ${today}`,
    'CALENDÁRIO DE REFERÊNCIA (para inferir noteDate):',
    calLines,
    'Se a data não puder ser inferida com segurança, omita "noteDate".',
    '',
    'REGISTRE como nota:',
    '+ Alimentação: o que comeu ou bebeu ("pizza", "açaí", "sorvete")',
    '+ Gasto/compra: valor ou item comprado ("R$50", "tênis", "supermercado")',
    '+ Humor/estado emocional: como se sentiu ("ansioso", "bem", "esgotado")',
    '+ Ideia/reflexão: insight ou observação ("percebi que...", "ideia de...")',
    '',
    'NÃO REGISTRE:',
    '- Exercício, esporte, treino, estudo, trabalho, meditação — essas são atividades',
    '- Perguntas ao assistente',
    '- Planos futuros sem reflexão presente',
    '',
    'Cada item do array deve ter:',
    '  "noteType": "food" | "expense" | "mood" | "idea" | "other"',
    '  "content": string — descrição curta, máx 100 chars',
    '  "context": object — dados estruturados:',
    '    food    → { "item": "pizza", "meal": "almoço" }',
    '    expense → { "amount": 50, "currency": "BRL", "item": "tênis" }',
    '    mood    → { "mood": "ansioso", "intensity": "médio" }',
    '    idea    → { "topic": "tema da ideia" }',
    '    other   → {}',
    '  "pillarHint": string | null — "Saúde", "Finanças", "Mente" ou null',
    '  "noteDate": string? — ISO yyyy-mm-dd (omitir se incerta)',
    '',
    'Mensagem:',
    '"""',
    message.replace(/"""/g, "'''").slice(0, 2500),
    '"""',
    '',
    'Retorne APENAS um array JSON válido. Se não há nota, retorne [].',
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.response);
    } catch {
      const match = body.response.match(/\[[\s\S]*\]/);
      parsed = match ? JSON.parse(match[0]) : [];
    }

    if (!Array.isArray(parsed)) return [];

    const VALID_TYPES = new Set(['food', 'expense', 'mood', 'idea', 'other']);

    return parsed
      .filter((n): n is Record<string, unknown> =>
        typeof n === 'object' && n !== null &&
        typeof n.noteType === 'string' &&
        typeof n.content  === 'string' && (n.content as string).length > 0,
      )
      .map(n => ({
        noteType:  (VALID_TYPES.has(n.noteType as string) ? n.noteType : 'other') as DetectedNote['noteType'],
        content:   String(n.content).slice(0, 100),
        context:   (typeof n.context === 'object' && n.context !== null)
          ? n.context as Record<string, unknown>
          : {},
        pillarHint: typeof n.pillarHint === 'string' ? n.pillarHint : null,
        noteDate:  typeof n.noteDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.noteDate as string)
          ? n.noteDate as string
          : undefined,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
