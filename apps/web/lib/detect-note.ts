export type DetectedNote = {
  noteType: 'food' | 'expense' | 'mood' | 'idea' | 'interest' | 'other';
  content: string;
  context: Record<string, unknown>;
  pillarHint: string | null;
  noteDate?: string; // ISO yyyy-mm-dd
};

const VALID_TYPES = new Set(['food', 'expense', 'mood', 'idea', 'interest', 'other']);

// Captura o CONTEXTO de qualquer coisa que a pessoa compartilha e que não é
// uma atividade cronometrada: interesses, descobertas, fatos, preferências,
// planos, reflexões — além de comida/gasto/humor. Suporta múltiplos dias.
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

  // Sem format:json (enviesa o qwen a um objeto só). Força array por exemplo.
  const prompt = `Capture o CONTEXTO relevante desta mensagem como notas — qualquer coisa que valha a pena lembrar sobre a pessoa.
Inclua: interesses e gostos, descobertas, fatos sobre ela, preferências, opiniões, planos, reflexões, e também comida, gastos, humor.
NÃO capture: saudações vazias, perguntas ao assistente, ou atividades já feitas com duração (essas são registradas à parte).

Hoje=${today}. Datas: ${calRef}

Cada nota:
- "content": o contexto em 1 frase clara (até 140 chars)
- "noteType": food|expense|mood|idea|interest|other (use "interest" para gostos/descobertas; "other" para fatos gerais)
- "context": objeto JSON com detalhes úteis ({} se não houver)
- "pillarHint": área de vida relacionada ("Música","Saúde","Finanças"...) ou null
- "noteDate": data ISO se houver (opcional)

Texto: "${message.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 1800)}"

Responda SOMENTE com um array JSON, sem texto extra. Exemplo:
[{"content":"Ama hip hop e cultura samurai","noteType":"interest","context":{"temas":["hip hop","samurai"]},"pillarHint":"Música"}]
Se não houver nada relevante, retorne [].`;

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
        options: { temperature: 0.2 },
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

    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { notes?: unknown[] })?.notes) ? (parsed as { notes: unknown[] }).notes
      : (parsed && typeof parsed === 'object' && typeof (parsed as DetectedNote).content === 'string') ? [parsed]
      : [];

    return (arr as unknown[])
      .filter((n): n is Record<string, unknown> =>
        typeof n === 'object' && n !== null &&
        typeof (n as Record<string, unknown>).content === 'string' &&
        ((n as Record<string, unknown>).content as string).trim().length > 0,
      )
      .map(n => ({
        noteType:  (VALID_TYPES.has(n.noteType as string) ? n.noteType : 'other') as DetectedNote['noteType'],
        content:   String(n.content).slice(0, 140),
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
