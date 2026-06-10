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

Pilares disponíveis: ${pillarNames.join(', ')}

REGISTRE — atividades com esforço intencional:
✅ exercício, esporte, treino (corrida, academia, skate, kung fu, natação...)
✅ estudo, leitura, curso, aprendizado
✅ trabalho, projeto, tarefa concluída
✅ meditação, terapia, prática espiritual
✅ criação (música, arte, escrita, código)
✅ cuidado ativo com saúde (consulta, tratamento)
✅ atividade social intencional (encontro planejado, ligação importante)

NÃO REGISTRE — rotina básica ou ações passivas:
❌ comer, beber, tomar sorvete, almoçar, jantar, tomar café
❌ dormir, descansar, assistir TV, rolar o feed
❌ deslocamento comum (ir ao trabalho, pegar ônibus)
❌ compras rotineiras
❌ perguntas, planos futuros, sentimentos sem ação concreta

PILAR — escolha apenas se houver correspondência clara com a lista:
- Saúde: exercício, corpo, consulta médica
- Mente: estudo, leitura, aprendizado, foco
- Trabalho: profissional, projetos, carreira
- Relações: conexões sociais intencionais
- Lazer: hobby ativo, diversão com esforço
- Finanças: gestão financeira ativa
- Propósito: reflexão profunda sobre valores
IMPORTANTE: se nenhum pilar da lista se encaixa claramente → não registre (retorne [])

Para cada atividade válida:
- "pillarName": nome EXATO de um pilar da lista acima
- "durationMinutes": duração em minutos como inteiro (0 se não mencionada)
- "note": descrição curta, máx 80 chars

Conversões: "1h"=60, "meia hora"=30, "2h30"=150, "45min"=45, "uma hora"=60

Mensagem: "${message.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 500)}"

Retorne APENAS um array JSON. Se nada se encaixa, retorne [].`;

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
