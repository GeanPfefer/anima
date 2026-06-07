-- Retrieval contextual temporal (PRD §1e: "Retrieval eficiente")
-- Embeddings semânticos para cada entrada, permitindo busca por similaridade
-- no chat e nos insights. A inteligência vem de arquitetura, não de modelo maior.

-- ─── pgvector ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── entry_embeddings ────────────────────────────────────────────────────────
-- Embedding do texto de cada xp_record.
-- Dimensão 768: padrão do nomic-embed-text (Ollama).

CREATE TABLE public.entry_embeddings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  xp_record_id uuid        NOT NULL UNIQUE REFERENCES public.xp_records(id) ON DELETE CASCADE,
  embedding    vector(768),
  model_used   text        NOT NULL DEFAULT 'nomic-embed-text',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- HNSW index para busca cosine rápida
CREATE INDEX entry_embeddings_hnsw_idx
  ON public.entry_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX entry_embeddings_user_idx
  ON public.entry_embeddings (user_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.entry_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entry_embeddings: leitura própria"
  ON public.entry_embeddings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "entry_embeddings: inserção própria"
  ON public.entry_embeddings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Upsert (on conflict update) precisa de UPDATE policy
CREATE POLICY "entry_embeddings: atualização própria"
  ON public.entry_embeddings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Função de busca semântica ────────────────────────────────────────────────
-- Usada pelo chat para encontrar entradas passadas relevantes.
-- Roda com SECURITY INVOKER: RLS das tabelas base é aplicada (user só vê seus dados).

CREATE OR REPLACE FUNCTION match_entries(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.5,
  match_count     int   DEFAULT 5
)
RETURNS TABLE (
  xp_record_id  uuid,
  note          text,
  activity_date date,
  pillar_name   text,
  similarity    float
)
LANGUAGE plpgsql SECURITY INVOKER STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id                                   AS xp_record_id,
    r.note,
    r.activity_date,
    up.name                                AS pillar_name,
    1 - (e.embedding <=> query_embedding)  AS similarity
  FROM public.entry_embeddings e
  JOIN public.xp_records  r  ON r.id  = e.xp_record_id
  JOIN public.user_pillars up ON up.id = r.pillar_id
  WHERE e.user_id = auth.uid()
    AND r.note IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
