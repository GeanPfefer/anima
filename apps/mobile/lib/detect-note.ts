const OLLAMA_URL   = process.env.EXPO_PUBLIC_OLLAMA_URL   ?? 'http://100.68.239.78:11434';
const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'qwen2.5:14b';

export type NoteType = 'food' | 'expense' | 'mood' | 'idea' | 'other';

export type DetectedNote = {
  content:   string;
  note_type: NoteType;
  context?:  Record<string, unknown>;
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

Texto: "${text.replace(/"/g, "'").replace(/\n/g, ' ')}"

Retorne APENAS um array JSON. Se não há notas, retorne [].
Exemplo: [{"content": "tomei café da manhã", "note_type": "food"}]`;

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
    return (notes as DetectedNote[]).filter(
      (n) => n.content && ['food', 'expense', 'mood', 'idea', 'other'].includes(n.note_type),
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
