export type DetectedActivity = {
  pillarName: string;      // nome exato existente ou nome novo (será criado como pendente)
  durationMinutes: number;
  note: string;
  activityDate?: string;   // ISO yyyy-mm-dd, inferida do texto
};

// Detecta atividades intencionais em mensagens do usuário.
// Suporta múltiplos dias numa mesma mensagem.
// Permite sugerir novos nomes de pilares — o chat route os cria como pendentes.
export async function detectActivities(
  message: string,
  pillarNames: string[],
  today: string = new Date().toISOString().slice(0, 10),
): Promise<DetectedActivity[]> {
  const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

  // Calendar reference so the model can map "segunda-feira", "ontem" → ISO date
  const todayDate = new Date(today + 'T12:00:00');
  const weekdays  = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  const calLines  = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() - i);
    const label = i === 0 ? 'hoje' : i === 1 ? 'ontem' : weekdays[d.getDay()]!;
    return `  ${label} = ${d.toISOString().slice(0, 10)}`;
  }).join('\n');

  const existingList = pillarNames.length > 0
    ? pillarNames.join(', ')
    : 'Saúde, Mente, Relações';

  const prompt = `Você extrai atividades de vida de textos escritos naturalmente. A mensagem pode cobrir vários dias.

HOJE = ${today}
CALENDÁRIO (para inferir activityDate):
${calLines}

PILARES EXISTENTES DO USUÁRIO: ${existingList}
Regra: use um pilar existente se a atividade se encaixar bem.
Crie um nome NOVO apenas se necessário — português, máx 20 chars (ex: "Arte", "Finanças", "Lazer", "Espiritualidade").

REGISTRE — atividades com esforço intencional:
+ exercício, esporte, treino (corrida, academia, yoga, natação...)
+ estudo, leitura, curso, aprendizado
+ trabalho, projeto, reunião produtiva, tarefa concluída
+ meditação, terapia, prática espiritual
+ criação (música, arte, escrita, código, pintura)
+ consulta médica, tratamento de saúde
+ atividade social intencional (encontro planejado, ligação importante)

NÃO REGISTRE:
- comer, beber, almoçar, jantar, dormir, descansar
- assistir TV, rolar o feed, compras rotineiras
- deslocamento comum, perguntas, planos futuros, sentimentos sem ação

Cada item:
  "pillarName": string — pilar existente ou nome novo
  "durationMinutes": number — minutos (0 se não mencionado)
  "note": string — resumo curto, máx 80 chars
  "activityDate": string? — ISO yyyy-mm-dd inferida do texto (omitir se incerta)

Conversões: 1h=60, meia hora=30, 2h30=150, 45min=45.
Se uma atividade cobre dois pilares diferentes, crie dois objetos.

Texto:
"""
${message.replace(/"""/g, "'''").slice(0, 2500)}
"""

Retorne APENAS array JSON válido. Se nada se encaixa, retorne [].`;

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
