const OLLAMA_URL   = process.env.EXPO_PUBLIC_OLLAMA_URL   ?? 'http://100.68.239.78:11434';
const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'qwen2.5:14b';

export type DetectedLink = {
  childName:  string;
  parentName: string;
};

export async function detectPillarLinks(
  message: string,
  pillarNames: string[],
): Promise<DetectedLink[]> {
  const pillarCtx = pillarNames.length > 0 ? pillarNames.join(', ') : '(nenhum ainda)';

  const prompt = `Detecte agrupamentos de áreas declarados no texto.

REGISTRE apenas relações EXPLÍCITAS de "faz parte de":
+ "teclado, beats e violão são música" → cada um é filho de "Música"
+ "música é lazer" / "considero X como Y" → X é filho de Y
+ "agrupa X em Y", "X faz parte de Y", "X entra em Y"

NÃO registre: atividades soltas, metas, sentimentos, gastos.

Áreas existentes: ${pillarCtx}

Cada item:
- "childName": área específica (o filho), máx 20 chars
- "parentName": área que contém (o pai), máx 20 chars

Texto: "${message.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 1500)}"

Retorne APENAS array JSON válido. Se não há agrupamento explícito, retorne [].`;

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

    const body = await res.json() as { response: string };

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.response);
    } catch {
      const m = body.response.match(/\[[\s\S]*\]/);
      parsed = m ? JSON.parse(m[0]) : [];
    }

    const arr = Array.isArray(parsed)
      ? parsed
      : ((parsed as Record<string, unknown>)?.links ??
         (parsed as Record<string, unknown>)?.groups ?? []);
    if (!Array.isArray(arr)) return [];

    return arr
      .filter((l): l is DetectedLink =>
        typeof (l as DetectedLink)?.childName  === 'string' &&
        typeof (l as DetectedLink)?.parentName === 'string' &&
        (l as DetectedLink).childName.trim().length > 0 &&
        (l as DetectedLink).parentName.trim().length > 0,
      )
      .map(l => ({
        childName:  String(l.childName).trim().slice(0, 20),
        parentName: String(l.parentName).trim().slice(0, 20),
      }))
      .filter(l => l.childName.toLowerCase() !== l.parentName.toLowerCase());
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
