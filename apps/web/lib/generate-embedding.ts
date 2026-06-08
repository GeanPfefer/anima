const OLLAMA_URL         = process.env.OLLAMA_URL         ?? 'http://localhost:11434';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';

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
