export type DetectedActivity = {
  pillarName: string;
  durationMinutes: number;
  note: string;
};

// Detecta atividades concretas já realizadas em mensagens do usuário.
// Retorna [] para perguntas, planos futuros ou conversas sem ação concreta.
export async function detectActivities(
  message: string,
  pillarNames: string[],
): Promise<DetectedActivity[]> {
  if (!pillarNames.length) return [];

  const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

  const prompt = `Você detecta registros de atividades em mensagens de conversa.

Pilares disponíveis: ${pillarNames.join(', ')}

Sua tarefa: identificar APENAS atividades concretas já realizadas pelo usuário.

REGISTRE (ação passada concreta):
✅ "fiz 45min de kung fu" → Saúde, 45min
✅ "li por uma hora antes de dormir" → Mente, 60min
✅ "terminei aquele módulo do curso" → Trabalho ou Mente, 0min
✅ "fui na academia hoje" → Saúde, 0min

NÃO REGISTRE (não são atividades concretas):
❌ "quero fazer kung fu" (plano futuro)
❌ "o que acha de eu começar a meditar?" (pergunta)
❌ "hoje foi um dia difícil" (estado emocional, sem atividade)
❌ "como estão meus pilares?" (pergunta sobre o sistema)

Para cada atividade encontrada:
- "pillarName": nome exato de um pilar da lista
- "durationMinutes": duração em minutos como inteiro (0 se não mencionada)
- "note": descrição curta do que foi feito, máx 80 chars

Conversões de tempo: "1h"=60, "meia hora"=30, "2h30"=150, "45min"=45, "uma hora"=60
Se uma atividade cobre dois pilares, crie dois objetos.

Mensagem: "${message.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 500)}"

Retorne APENAS um array JSON. Se não há atividade concreta, retorne [].`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15_000);

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
      const m = body.response.match(/\[[\s\S]*?\]/);
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
