const OLLAMA_URL   = process.env.EXPO_PUBLIC_OLLAMA_URL   ?? 'http://100.68.239.78:11434';
const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'qwen2.5:14b';

export type NoteType = 'food' | 'expense' | 'mood' | 'idea' | 'other';

export type DetectedNote = {
  content:    string;
  note_type:  NoteType;
  context?:   Record<string, unknown>;
  pillarHint: string | null;
};

export async function detectNotes(text: string): Promise<DetectedNote[]> {
  const prompt = `Você identifica notas pessoais em textos naturais.

NUNCA detecte como nota: exercício, esporte, estudo, trabalho, meditação, criação (código, arte, escrita), leitura — esses são ATIVIDADES, não notas.

Tipos válidos de nota:
- food: o que comeu ou bebeu
- expense: gasto, compra, valor pago
- mood: estado emocional, como se sentiu
- idea: ideia, insight, pensamento criativo
- other: nota pessoal que não se enquadra acima

Para cada nota:
- "note_type": um dos tipos acima
- "content": descrição curta (máx 100 chars)
- "context": objeto com dados estruturados
  food → {"item": "pizza", "meal": "almoço"}
  expense → {"amount": 50, "currency": "BRL", "item": "tênis"}
  mood → {"mood": "ansioso", "intensity": "médio"}
  idea → {"topic": "tema da ideia"}
  other → {}
- "pillarHint": "Saúde", "Finanças", "Mente" ou null

Texto: "${text.replace(/"/g, "'").replace(/\n/g, ' ')}"

Retorne APENAS um array JSON. Se não há notas, retorne [].
Exemplo: [{"note_type": "food", "content": "tomei café da manhã", "context": {"item": "café", "meal": "café da manhã"}, "pillarHint": "Saúde"}]`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 20_000);

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
    const body   = await res.json() as { response: string };
    const parsed = JSON.parse(body.response);
    const notes  = Array.isArray(parsed) ? parsed : (parsed?.notes ?? []);
    const VALID_TYPES = new Set(['food', 'expense', 'mood', 'idea', 'other']);
    return (notes as Array<Record<string, unknown>>)
      .filter((n) => typeof n.content === 'string' && n.content.length > 0 && VALID_TYPES.has(n.note_type as string))
      .map((n) => ({
        content:    String(n.content).slice(0, 100),
        note_type:  n.note_type as NoteType,
        context:    (typeof n.context === 'object' && n.context !== null) ? n.context as Record<string, unknown> : {},
        pillarHint: typeof n.pillarHint === 'string' ? n.pillarHint : null,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
