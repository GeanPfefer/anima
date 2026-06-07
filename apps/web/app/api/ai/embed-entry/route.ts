// Retrieval contextual — geração de embeddings por entrada
// Chamada fire-and-forget após cada atividade registrada.
// O embedding da nota permite busca semântica no histórico durante o chat.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const OLLAMA_URL         = process.env.OLLAMA_URL         ?? 'http://localhost:11434';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autorizado', { status: 401 });

  const body = await req.json() as { note?: string; recordId?: string };
  const { note, recordId } = body;

  if (!note?.trim() || !recordId) return new Response('OK', { status: 200 });

  const embedding = await generateEmbedding(note);
  if (!embedding) return new Response('OK', { status: 200 }); // modelo não disponível — ignora

  // Upsert: se já existe embedding para este record (resubmit improvável), atualiza
  const vectorStr = `[${embedding.join(',')}]`;
  await supabase.from('entry_embeddings').upsert(
    {
      user_id:      user.id,
      xp_record_id: recordId,
      embedding:    vectorStr,
      model_used:   OLLAMA_EMBED_MODEL,
    },
    { onConflict: 'xp_record_id' },
  );

  return new Response('OK', { status: 200 });
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:  OLLAMA_EMBED_MODEL,
        prompt: text.slice(0, 512), // limita tokens
      }),
    });

    if (!res.ok) return null;

    const data = await res.json() as { embedding?: number[] };
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) return null;

    return data.embedding;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
