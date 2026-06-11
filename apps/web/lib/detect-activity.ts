export type DetectedActivity = {
  pillarName: string;      // pilar existente ou nome novo (criado como pendente)
  durationMinutes: number;
  note: string;
  activityDate?: string;   // ISO yyyy-mm-dd, inferida do texto
};

// Detecta atividades intencionais em mensagens do usuário.
// Suporta múltiplos dias numa mesma mensagem.
export async function detectActivities(
  message: string,
  pillarNames: string[],
  today: string = new Date().toISOString().slice(0, 10),
): Promise<DetectedActivity[]> {
  const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

  // Compact calendar reference: "seg=2026-06-09, ter=2026-06-10, ..."
  const todayDate = new Date(today + 'T12:00:00');
  const abbr = ['dom','seg','ter','qua','qui','sex','sáb'];
  const calRef = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() - i);
    const label = i === 0 ? 'hoje' : i === 1 ? 'ontem' : abbr[d.getDay()]!;
    return `${label}=${d.toISOString().slice(0, 10)}`;
  }).join(', ');

  const pillarCtx = pillarNames.length > 0 ? pillarNames.join(', ') : 'Saúde, Mente, Relações';

  // Keep this prompt short — same structure as parseActivities (which works reliably).
  const prompt = `Você extrai atividades de vida de textos escritos naturalmente. A mensagem pode cobrir vários dias.
Hoje=${today}. Datas: ${calRef}

Pilares já existentes: ${pillarCtx}
Mapeie cada atividade ao pilar existente cujo TEMA realmente descreve a atividade:
- exercício físico (corrida, academia, yoga, pedal, treino) → pilar de saúde/corpo
- estudo, leitura, programação, foco, idiomas → pilar de mente/estudo
- conversa, família, amigos, encontro → pilar de relações
- dinheiro, investir, gastos → pilar de finanças
Só crie nome novo se NENHUM pilar existente for do mesmo tema. Nunca force em pilar de tema diferente (ex: idioma não vai em finanças, yoga não vai em corrida).

Para cada atividade identificada:
- "pillarName": pilar existente ou nome novo em português, máx 20 chars
- "durationMinutes": minutos como inteiro (0 se não mencionado)
- "note": resumo curto, máx 80 chars
- "activityDate": data ISO inferida do contexto (opcional — omitir se incerto)

Conversões: 1h=60, meia hora=30, 2h30=150, 45min=45.
Se uma atividade cobre dois pilares, crie dois objetos.
Não registre: comer, dormir, descansar, assistir TV, deslocamento, compras, sentimentos sem ação.

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
