export type DetectedQuest = {
  title: string;
  pillarName: string;   // pilar existente ou nome novo
  type: 'main' | 'habit' | 'learning' | 'challenge';
  description?: string;
  xpReward: number;
};

// Detecta intenções de quest em mensagens do usuário.
// Conservative: só captura declarações explícitas de meta/objetivo/hábito.
export async function detectQuests(
  message: string,
  pillarNames: string[],
): Promise<DetectedQuest[]> {
  const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

  const pillarCtx = pillarNames.length > 0 ? pillarNames.join(', ') : 'Saúde, Mente, Relações';

  const prompt = `Detecte intenções de META, OBJETIVO ou HÁBITO no texto, MESMO que apareçam no meio de uma mensagem sobre outros assuntos.

REGISTRE toda declaração de intenção futura:
+ "quero aprender japonês (esse ano)" → learning
+ "meu objetivo é W" → main
+ "vou tentar Y toda manhã/semana" → habit
+ "quero começar a fazer Z regularmente" → habit
+ "desafio de N dias de W" → challenge

NÃO registre: atividades já feitas no passado (com duração), desejos vagos sem ação.

Pilares: ${pillarCtx}
Regra: use pilar existente quando encaixar, senão crie nome novo (ex: "Idiomas", "Finanças", "Arte").

Cada item:
- "title": título curto e acionável, máx 60 chars (ex: "Aprender japonês")
- "pillarName": pilar existente ou nome novo
- "type": "habit" | "learning" | "challenge" | "main"
- "description": uma frase descrevendo o objetivo (opcional)
- "xpReward": XP estimado (habit=200, learning=500, challenge=300, main=1000)

Texto: "${message.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 1500)}"

Retorne APENAS um array JSON válido. Exemplo: [{"title":"Aprender japonês","pillarName":"Idiomas","type":"learning","xpReward":500}]
Se não há meta, retorne [].`;

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
      : ((result as Record<string, unknown>)?.quests ?? []);

    const VALID_TYPES = new Set(['main', 'habit', 'learning', 'challenge']);

    return (Array.isArray(arr) ? arr : []).filter(
      (q): q is DetectedQuest =>
        typeof (q as DetectedQuest)?.title      === 'string' &&
        typeof (q as DetectedQuest)?.pillarName === 'string' &&
        (q as DetectedQuest).title.trim().length > 0,
    ).map(q => ({
      title:       String(q.title).slice(0, 60),
      pillarName:  String(q.pillarName),
      type:        (VALID_TYPES.has(q.type) ? q.type : 'habit') as DetectedQuest['type'],
      description: typeof q.description === 'string' ? q.description : undefined,
      xpReward:    typeof q.xpReward === 'number' && q.xpReward > 0 ? q.xpReward : 200,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
