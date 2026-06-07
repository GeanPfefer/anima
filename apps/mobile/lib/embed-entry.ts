// Retrieval contextual — geração de embeddings (mobile)
// Espelho da rota /api/ai/embed-entry do web, usando Ollama direto.
// Chamada fire-and-forget após cada atividade registrada.

import { supabase } from './supabase';

const OLLAMA_URL         = process.env.EXPO_PUBLIC_OLLAMA_URL         ?? 'http://100.68.239.78:11434';
const OLLAMA_EMBED_MODEL = process.env.EXPO_PUBLIC_OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';

/**
 * Gera embedding para uma nota e salva em entry_embeddings.
 * Deve ser chamada fire-and-forget (sem await) após logActivity.
 */
export async function embedEntryForRecord(
  note: string,
  recordId: string,
  userId: string,
): Promise<void> {
  if (!note?.trim()) return;

  const embedding = await generateEmbedding(note);
  if (!embedding) return; // modelo não disponível — ignora silenciosamente

  const vectorStr = `[${embedding.join(',')}]`;
  await supabase.from('entry_embeddings').upsert(
    {
      user_id:      userId,
      xp_record_id: recordId,
      embedding:    vectorStr,
      model_used:   OLLAMA_EMBED_MODEL,
    },
    { onConflict: 'xp_record_id' },
  );
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:  OLLAMA_EMBED_MODEL,
        prompt: text.slice(0, 512),
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
