const OLLAMA_URL   = process.env.EXPO_PUBLIC_OLLAMA_URL   ?? 'http://100.68.239.78:11434';
const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'qwen2.5:14b';

export type DetectedActivity = {
  pillarName: string;
  durationMinutes: number;
  note: string;
  activityDate?: string; // ISO yyyy-mm-dd, inferida do texto
};

export async function detectActivities(
  message: string,
  pillarNames: string[],
  today: string = new Date().toISOString().slice(0, 10),
): Promise<DetectedActivity[]> {
  const todayDate = new Date(today + 'T12:00:00');
  const abbr = ['dom','seg','ter','qua','qui','sex','sáb'];
  const calRef = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() - i);
    const label = i === 0 ? 'hoje' : i === 1 ? 'ontem' : abbr[d.getDay()]!;
    return `${label}=${d.toISOString().slice(0, 10)}`;
  }).join(', ');

  const pillarCtx = pillarNames.length > 0 ? pillarNames.join(', ') : 'Saúde, Mente, Relações';

  const prompt = `Você extrai atividades de vida de textos escritos naturalmente. A mensagem pode cobrir vários dias.
Hoje=${today}. Datas: ${calRef}

Pilares já existentes: ${pillarCtx}
Mapeie cada atividade ao pilar existente cujo TEMA realmente descreve a atividade:
- exercício físico (corrida, academia, yoga, pedal, treino) → pilar de saúde/corpo
- estudo, leitura, programação, foco, idiomas → pilar de mente/estudo
- conversa, família, amigos, encontro → pilar de relações
- dinheiro, investir, gastos → pilar de finanças
Só crie nome novo se NENHUM pilar existente for do mesmo tema. Nunca force em pilar de tema diferente.

Para cada atividade identificada:
- "pillarName": pilar existente ou nome novo em português, máx 20 chars
- "durationMinutes": minutos como inteiro (0 se não mencionado)
- "note": resumo curto, máx 80 chars
- "activityDate": data ISO inferida do contexto (opcional — omitir se incerto)

Conversões: 1h=60, meia hora=30, 2h30=150, 45min=45.
Se uma atividade cobre dois pilares, crie dois objetos.
Registre SOMENTE algo que a pessoa FEZ de fato (ação concreta no passado).
NÃO registre:
- comer, dormir, descansar, assistir TV, deslocamento, compras, sentimentos sem ação
- metas/intenções/decisões futuras ("vou correr uma maratona", "decidi treinar") — são quests
- afirmações de organização ("corrida faz parte de Saúde", "considera o violão como Música") — são links de pilar
- gostos/descobertas sem ação cronometrada ("descobri J Dilla", "virei fã de X") — são interesses

Texto: "${message.replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 1800)}"

Retorne APENAS um array JSON válido, sem texto adicional.`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30_000);

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
      const m = body.response.match(/\[[\s\S]*\]/);
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
