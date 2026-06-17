const OLLAMA_URL   = process.env.EXPO_PUBLIC_OLLAMA_URL   ?? 'http://100.68.239.78:11434';
const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'qwen2.5:14b';

export type DetectedEntity = {
  name: string;
  type: string;            // pessoa|lugar|projeto|ferramenta|habito|conceito
  pillarHint: string | null; // área de vida relacionada (existente ou nova)
};

const VALID_TYPES = new Set(['pessoa', 'lugar', 'projeto', 'ferramenta', 'habito', 'conceito']);

// Extrai entidades nomeadas de QUALQUER mensagem (não só de atividades), com
// a área de vida de cada uma — base da teia entidade↔pilar.
export async function detectEntities(
  message: string,
  pillarNames: string[],
): Promise<DetectedEntity[]> {
  const pillarCtx = pillarNames.length > 0 ? pillarNames.join(', ') : '(nenhuma ainda)';

  // Sem format:json — ele faz o qwen devolver um objeto só, perdendo entidades.
  const prompt = `Extraia as entidades nomeadas do texto (pessoas, projetos, lugares, ferramentas/apps, obras/mídias, hábitos) e a área de vida de cada uma.
Ignore palavras genéricas (trabalho, exercício, manhã, dia).

Áreas existentes: ${pillarCtx}
Use uma área existente quando encaixar; senão proponha um nome curto (ex: "Música", "Cultura", "Lazer").

Texto: "${message.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 1800)}"

Responda SOMENTE com um array JSON, um objeto por entidade, sem texto extra:
[{"name":"Nujabes","type":"pessoa","pillarHint":"Música"},{"name":"Samurai Champloo","type":"projeto","pillarHint":"Cultura"}]

Tipos válidos: pessoa, lugar, projeto, ferramenta, habito, conceito. pillarHint pode ser null. Se não houver entidade, retorne [].`;

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

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.response);
    } catch {
      const m = body.response.match(/\[[\s\S]*\]/);
      parsed = m ? JSON.parse(m[0]) : [];
    }

    const arr = Array.isArray(parsed) ? parsed
      : Array.isArray((parsed as { entities?: unknown[] })?.entities) ? (parsed as { entities: unknown[] }).entities
      : (parsed && typeof parsed === 'object' && typeof (parsed as DetectedEntity).name === 'string') ? [parsed]
      : [];

    return (arr as unknown[])
      .filter((e): e is DetectedEntity =>
        typeof e === 'object' && e !== null &&
        typeof (e as DetectedEntity).name === 'string' &&
        (e as DetectedEntity).name.trim().length > 1,
      )
      .map(e => ({
        name:       String(e.name).trim().slice(0, 100),
        type:       VALID_TYPES.has(e.type) ? e.type : 'conceito',
        pillarHint: typeof e.pillarHint === 'string' && e.pillarHint.trim() ? e.pillarHint.trim().slice(0, 20) : null,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
