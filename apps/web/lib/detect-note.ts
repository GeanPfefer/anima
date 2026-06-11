export type DetectedNote = {
  noteType: 'food' | 'expense' | 'mood' | 'idea' | 'other';
  content: string;
  context: Record<string, unknown>;
  pillarHint: string | null;
};

// Detecta notas silenciosas (alimentação, gastos, humor, ideias) em mensagens.
// Nunca captura atividades intencionais — essas vão para detectActivities.
export async function detectNotes(message: string): Promise<DetectedNote[]> {
  const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

  const prompt = `Detecte notas de captura na mensagem abaixo.

REGISTRE como nota:
✅ Alimentação: o que comeu ou bebeu ("almoçou pizza", "tomei café", "comi sorvete")
✅ Gasto/compra: valor ou item comprado ("gastei R$50", "comprei tênis", "paguei aluguel")
✅ Humor/estado emocional: como se sentiu ("me senti ansioso", "dia difícil", "estou bem")
✅ Ideia/reflexão: insight ou observação ("tive uma ideia de...", "percebi que...")

NÃO REGISTRE:
❌ Exercício, esporte, treino, estudo, trabalho, meditação, criação — essas são atividades
❌ Perguntas ao assistente
❌ Planos futuros sem reflexão presente
❌ Conversas sem dado relevante a registrar

Para cada nota encontrada:
- "noteType": "food", "expense", "mood", "idea" ou "other"
- "content": descrição curta da nota (máx 100 chars)
- "context": objeto JSON com dados estruturados
  food → { "item": "pizza", "meal": "almoço" }
  expense → { "amount": 50, "currency": "BRL", "item": "tênis" }
  mood → { "mood": "ansioso", "intensity": "médio" }
  idea → { "topic": "tema da ideia" }
  other → {}
- "pillarHint": "Saúde", "Finanças", "Mente" ou null

Mensagem: "${message.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 500)}"

Retorne APENAS um array JSON. Se não há nota, retorne [].`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 25_000);

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
        noteType: (VALID_TYPES.has(n.noteType as string) ? n.noteType : 'other') as DetectedNote['noteType'],
        content:  String(n.content).slice(0, 100),
        context:  (typeof n.context === 'object' && n.context !== null)
          ? n.context as Record<string, unknown>
          : {},
        pillarHint: typeof n.pillarHint === 'string' ? n.pillarHint : null,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
