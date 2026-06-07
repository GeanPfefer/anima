-- Camada 3 — Memória semântica (PRD §1d)
-- O sistema aprende relações persistentes: "skate" → regulação emocional,
-- "portal dos clientes" → trabalho recorrente, "Goma" → máquina de IA.
-- A inteligência vem de arquitetura, não de modelo maior.

-- ─── semantic_entities ───────────────────────────────────────────────────────
-- Entidades recorrentes aprendidas do histórico do usuário.
-- Upsert com incremento de occurrence_count a cada nova menção.

CREATE TABLE public.semantic_entities (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  entity_type      text        NOT NULL DEFAULT 'conceito'
                               CHECK (entity_type IN ('pessoa', 'lugar', 'projeto', 'ferramenta', 'habito', 'conceito')),
  context          text,                          -- descrição do papel da entidade para esta pessoa
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer     NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- ─── entity_mentions ─────────────────────────────────────────────────────────
-- Liga cada entidade aos registros onde ela aparece.

CREATE TABLE public.entity_mentions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid        NOT NULL REFERENCES public.semantic_entities(id) ON DELETE CASCADE,
  xp_record_id     uuid        NOT NULL REFERENCES public.xp_records(id) ON DELETE CASCADE,
  context_snippet  text,                          -- trecho do texto onde a entidade aparece
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX semantic_entities_user_idx
  ON public.semantic_entities (user_id, occurrence_count DESC, last_seen_at DESC);

CREATE INDEX entity_mentions_entity_idx
  ON public.entity_mentions (entity_id);

CREATE INDEX entity_mentions_record_idx
  ON public.entity_mentions (xp_record_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.semantic_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_mentions   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "semantic_entities: leitura própria"
  ON public.semantic_entities FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "semantic_entities: inserção própria"
  ON public.semantic_entities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "semantic_entities: atualização própria"
  ON public.semantic_entities FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "entity_mentions: leitura via record próprio"
  ON public.entity_mentions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.xp_records r
      WHERE r.id = entity_mentions.xp_record_id
        AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "entity_mentions: inserção via record próprio"
  ON public.entity_mentions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.xp_records r
      WHERE r.id = entity_mentions.xp_record_id
        AND r.user_id = auth.uid()
    )
  );
