export type DetectedActivity = {
  pillarName: string;
  durationMinutes: number;
  note: string;
};

// Detecta atividades intencionais realizadas em mensagens do usuário.
// Conservador por design — falso negativo é melhor que registrar lixo.
export async function detectActivities(
  message: string,
  pillarNames: string[],
): Promise<DetectedActivity[]> {
  if (!pillarNames.length) return [];

  const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

  const prompt = `Detecte atividades intencionais realizadas na mensagem abaixo.

PILARES DISPONÍVEIS (use EXATAMENTE estes nomes, sem variações):
${pillarNames.map(n => `- "${n}"`).join('\n')}

REGISTRE — atividades com esforço intencional:
✅ exercício, esporte, treino (corrida, academia, skate, kung fu, natação...)
✅ estudo, leitura, curso, aprendizado
✅ trabalho, projeto, tarefa concluída
✅ meditação, terapia, prática espiritual
✅ criação (música, arte, escrita, código)
✅ cuidado ativo com saúde (consulta, tratamento)
✅ atividade social intencional (encontro planejado, ligação importante)

NÃO REGISTRE — rotina básica ou ações passivas:
❌ comer, beber, almoçar, jantar, tomar café
❌ dormir, descansar, assistir TV, rolar o feed
❌ deslocamento comum (ir ao trabalho, pegar ônibus)
❌ compras rotineiras
❌ perguntas, planos futuros, sentimentos sem ação concreta

REGRA DE PILAR: mapeie cada atividade para o pilar da lista que melhor se encaixa.
Use contexto: exercício/saúde/corpo → "Saúde" (ou similar); estudo/livro/curso → "Mente" (ou similar);
trabalho/projeto/código → pilar profissional; amigos/família → pilar social.
IMPORTANTE: use SOMENTE nomes da lista acima. Se nenhum se encaixa → não registre essa atividade.

Para cada atividade válida:
- "pillarName": nome EXATO de um dos pilares listados acima
- "durationMinutes": duração em minutos como inteiro (0 se não mencionada)
- "note": descrição curta da atividade, máx 80 chars

Conversões: "1h"=60, "meia hora"=30, "2h30"=150, "45min"=45, "uma hora"=60

Mensagem: "${message.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 600)}"

Retorne APENAS um array JSON válido. Se nada se encaixa, retorne [].`;

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
