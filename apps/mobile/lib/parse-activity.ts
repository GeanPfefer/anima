const OLLAMA_URL   = process.env.EXPO_PUBLIC_OLLAMA_URL   ?? 'http://100.68.239.78:11434';
const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'qwen2.5:14b';

export type ParsedActivity = {
  pillarName: string;
  durationMinutes: number;
  note: string;
};

/**
 * Envia texto natural para o Ollama e recebe atividades estruturadas.
 * O modelo retorna JSON puro — sem markdown, sem texto extra.
 */
export async function parseActivityText(
  text: string,
  availablePillars: string[],
): Promise<ParsedActivity[]> {
  const prompt = `Você extrai atividades de vida de textos escritos naturalmente.

Pilares disponíveis (escolha sempre um deles): ${availablePillars.join(', ')}

Para cada atividade identificada, crie um objeto com:
- "pillarName": nome exato do pilar da lista acima
- "durationMinutes": duração em minutos como número inteiro (0 se não mencionada)
- "note": resumo curto do que foi feito, máx 80 caracteres

Conversões de tempo: "1h"=60, "meia hora"=30, "2h30"=150, "45min"=45, "uma hora"=60
Se uma atividade cobre dois pilares diferentes, crie dois objetos.
Se a duração não for mencionada, use 0.

Texto do usuário: "${text.replace(/"/g, "'").replace(/\n/g, ' ')}"

Retorne APENAS um array JSON válido, sem texto adicional.`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model:   OLLAMA_MODEL,
        prompt,
        stream:  false,
        format:  'json',
        options: { temperature: 0.1 },
      }),
    });

    if (!res.ok) throw new Error(`Ollama retornou HTTP ${res.status}`);

    const body = await res.json() as { response: string };

    let activities: ParsedActivity[];
    try {
      const parsed = JSON.parse(body.response);
      if (Array.isArray(parsed)) {
        activities = parsed;
      } else {
        // modelo pode ter envolto em { activities: [...] } ou { data: [...] }
        const inner = parsed?.activities ?? parsed?.data ?? parsed?.entries;
        activities = Array.isArray(inner) ? inner : [];
      }
    } catch {
      // fallback: tenta extrair array do texto bruto
      const match = body.response.match(/\[[\s\S]*?\]/);
      if (!match) throw new Error('IA não retornou JSON válido');
      activities = JSON.parse(match[0]);
    }

    return activities.filter(
      (a): a is ParsedActivity =>
        typeof a.pillarName === 'string' &&
        a.pillarName.trim().length > 0,
    );
  } finally {
    clearTimeout(timeout);
  }
}
