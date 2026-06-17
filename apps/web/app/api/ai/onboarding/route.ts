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

  const { name: clientName, messages } = await req.json() as { name: string; messages: Message[] };

  // Fonte da verdade do nome = profile (o valor do cliente pode estar defasado)
  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', user.id)
    .single();

  const PLACEHOLDER = new Set(['Jogador', 'usuário', '']);
  const fromProfile = profile?.name && !PLACEHOLDER.has(profile.name) ? profile.name : null;
  const fromClient  = clientName?.trim() && !PLACEHOLDER.has(clientName.trim()) ? clientName.trim() : null;
  const displayName = fromProfile ?? fromClient;

  const plain = (body: string) =>
    new Response(body, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });

  // Primeira mensagem: cumprimenta e pede o nome se ainda não souber
  if (messages.length === 0) {
    return plain(displayName
      ? `O que tá rolando na sua vida ultimamente, ${displayName}?`
      : `Oi! Antes da gente começar — como você quer que eu te chame?`);
  }

  // Nome ainda desconhecido: a resposta do usuário é o nome
  if (!displayName) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const extracted = extractName(lastUser);
    if (extracted) {
      await supabase.from('profiles').update({ name: extracted }).eq('id', user.id);
      await supabase.from('ai_conversations').insert({ user_id: user.id, role: 'user', content: lastUser });
      const reply = `Prazer, ${extracted}! Então me conta — o que tá rolando na sua vida ultimamente?`;
      await supabase.from('ai_conversations').insert({ user_id: user.id, role: 'assistant', content: reply });
      return plain(reply);
    }
    // Não deu pra extrair um nome: segue o onboarding normal sem nome
  }

  const ollamaMessages: Message[] = messages;

  const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: buildSystemPrompt(displayName) },
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

  // Salva mensagem do usuário no histórico (não salva o "." placeholder inicial)
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (lastUserMsg && lastUserMsg.content !== '.') {
    await supabase.from('ai_conversations').insert({
      user_id: user.id,
      role:    'user',
      content: lastUserMsg.content,
    });
  }

  let fullResponse = '';
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
              const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
              const token = json.message?.content ?? '';
              if (token) {
                fullResponse += token;
                controller.enqueue(encoder.encode(token));
              }
              if (json.done && fullResponse) {
                await supabase.from('ai_conversations').insert({
                  user_id: user.id,
                  role:    'assistant',
                  content: fullResponse,
                });
              }
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

// Extrai o nome de uma resposta livre ("meu nome é João" → "João").
function extractName(raw: string): string | null {
  const cleaned = raw.trim();
  const pick = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

  // Apelido explícito vence o nome formal, em qualquer posição da frase:
  // "Me chamo Gean, mas pode me chamar de Naeg" → Naeg
  const nick = cleaned.match(/(?:pode me chamar de|me chama de|me chame de|prefiro(?: que me chamem?)? de)\s+([\p{L}]{2,20})/iu)?.[1];
  if (nick) return pick(nick);

  let s = cleaned.replace(/[.!?]+$/, '');
  s = s.replace(/^(oi|olá|ola|opa|e a[ií]|eai)[\s,]+/i, '');
  s = s.replace(/^(meu nome (é|e)|me chamo|chamo-me|sou o|sou a|sou)[\s]+/i, '');
  s = s.trim();
  if (!s) return null;

  const first = s.split(/\s+/)[0]!.replace(/[^\p{L}]/gu, '');
  if (first.length < 2 || first.length > 20) return null;

  return pick(first);
}

function buildSystemPrompt(name: string | null): string {
  const ref = name ?? 'esta pessoa';
  return `Você é o Anima. Esta é sua primeira conversa com ${ref}.

MISSÃO (nunca diga isso): ouvir e entender como é a vida de ${ref} agora.
Não aconselhar. Não planejar. Não ajudar. Só entender.
${!name ? '\nVocê ainda não sabe o nome da pessoa. Se surgir naturalmente, use-o nas próximas mensagens.' : ''}
PROIBIDO — estas respostas destroem a experiência:
❌ "Vamos focar em uma área específica"
❌ "Qual área da sua vida você quer melhorar?"
❌ Listar categorias como opções para o usuário escolher
❌ "Vamos criar um planejamento / plano de ação"
❌ "Qual é o seu maior desafio?"
❌ Dar conselhos ou sugestões não pedidos
❌ Mais de uma pergunta por mensagem
❌ Mencionar "pilares", "XP", "níveis", "dashboard" ou termos do sistema

SE o usuário perguntar "quais áreas existem?" ou "o que você rastreia?":
→ Diga algo como: "O sistema detecta sozinho o que é relevante pra você a partir das conversas — não tem uma lista fixa. Vai aparecendo no seu perfil conforme você conta mais."

PERMITIDO:
✅ Perguntas sobre o dia a dia, o que está acontecendo agora
✅ Curiosidade sobre o presente — não sobre metas futuras
✅ Resposta curta (máx 2 frases) + uma pergunta
✅ Tom de amigo que acabou de te conhecer — leve, sem pressão

Após 3+ trocas com contexto real da vida da pessoa, encerre naturalmente com algo como:
"Já tenho uma boa ideia de como é a sua vida agora. Pode explorar seu perfil quando quiser."

Idioma: português brasileiro informal.`;
}
