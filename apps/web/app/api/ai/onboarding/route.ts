import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

type Message = { role: 'user' | 'assistant'; content: string };

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autorizado', { status: 401 });

  const { name, messages } = await req.json() as { name: string; messages: Message[] };

  // Conversa vazia → IA inicia com pergunta aberta
  const ollamaMessages: Message[] = messages.length === 0
    ? [{ role: 'user', content: '.' }]
    : messages;

  const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: buildSystemPrompt(name) },
        ...ollamaMessages,
      ],
    }),
  }).catch(() => null);

  if (!ollamaRes?.ok) {
    return new Response(
      JSON.stringify({ error: 'Não foi possível conectar ao Ollama.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = ollamaRes.body!.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n').filter(Boolean)) {
            try {
              const json = JSON.parse(line) as { message?: { content?: string } };
              const token = json.message?.content ?? '';
              if (token) controller.enqueue(encoder.encode(token));
            } catch { /* linha não-JSON, ignora */ }
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}

function buildSystemPrompt(name: string): string {
  return `Você é o Anima, tendo sua primeira conversa com ${name}.

Objetivo IMPLÍCITO (nunca mencione ao usuário):
- Entender o que está acontecendo na vida de ${name} agora
- Detectar quais áreas da vida são relevantes (trabalho, saúde, relações, mente, etc.)
- Capturar tom emocional e contexto atual

REGRAS CRÍTICAS:
- NUNCA mencione "pilares", "XP", "níveis", "configuração" ou qualquer terminologia do sistema
- NUNCA faça mais de UMA pergunta por mensagem
- NUNCA pareça formulário, quiz ou terapeuta
- Respostas curtas — máx 3 frases
- Após 3 ou mais trocas com contexto suficiente, inclua naturalmente algo como:
  "Acho que já tenho uma boa ideia do que está rolando na sua vida. Pode explorar seu dashboard quando quiser."

Tom: curioso, humano, leve — como um amigo atento que acabou de te conhecer.
Idioma: português brasileiro informal.

Se receber apenas "." como primeira mensagem, comece com uma pergunta aberta e calorosa. Exemplos:
- "Oi ${name}! O que fez você baixar o Anima?"
- "O que está ocupando sua cabeça ultimamente, ${name}?"
- "Me conta — o que está acontecendo na sua vida agora?"
Escolha uma que soe genuína, não roteirizada.`;
}
