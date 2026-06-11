export type DetectedNote = {
  noteType: 'food' | 'expense' | 'mood' | 'idea' | 'other';
  content: string;
  context: Record<string, unknown>;
  pillarHint: string | null;
  noteDate?: string; // ISO yyyy-mm-dd
};

// Detecta notas silenciosas (alimentação, gastos, humor, ideias).
// Suporta múltiplos dias. Nunca captura atividades intencionais.
export async function detectNotes(
  message: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<DetectedNote[]> {
  const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

  const todayDate = new Date(today + 'T12:00:00');
  const abbr = ['dom','seg','ter','qua','qui','sex','sáb'];
  const calRef = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() - i);
    const label = i === 0 ? 'hoje' : i === 1 ? 'ontem' : abbr[d.getDay()]!;
    return `${label}=${d.toISOString().slice(0, 10)}`;
  }).join(', ');

  const prompt = `Detecte notas de captura no texto abaixo. A mensagem pode cobrir vários dias.
Hoje=${today}. Datas: ${calRef}

REGISTRE apenas:
- Alimentação: o que comeu/bebeu ("pizza", "açaí", "café")
- Gasto/compra: valor ou item ("R$50", "tênis", "supermercado")
- Humor/estado: como se sentiu ("ansioso", "bem", "esgotado", "confiante")
- Ideia/reflexão: insight ("percebi que...", "ideia de...")

NÃO registre: exercício, estudo, trabalho, meditação, atividades intencionais.

Cada item:
- "noteType": "food" | "expense" | "mood" | "idea" | "other"
- "content": descrição curta, máx 100 chars
- "context": objeto JSON (food→{item,meal}, expense→{amount,currency,item}, mood→{mood,intensity}, idea→{topic}, other→{})
- "pillarHint": "Saúde" | "Finanças" | "Mente" | null
- "noteDate": data ISO inferida (opcional — omitir se incerto)

Texto: "${message.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 1800)}"

Retorne APENAS array JSON válido. Se não há notas, retorne [].`;

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

    // qwen com format:json às vezes embrulha em {"notes":[...]} em vez de array puro
    const arr = Array.isArray(parsed)
      ? parsed
      : ((parsed as Record<string, unknown>)?.notes ??
         (parsed as Record<string, unknown>)?.data ?? []);
    if (!Array.isArray(arr)) return [];

    const VALID_TYPES = new Set(['food', 'expense', 'mood', 'idea', 'other']);

    return arr
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
        noteDate:   typeof n.noteDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.noteDate as string)
          ? n.noteDate as string
          : undefined,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
