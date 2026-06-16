-- entity_pillars: associação many-to-many entidade↔pilar de primeira classe.
-- Antes, entidade↔pilar só existia derivada de atividades (entity_mentions →
-- xp_records → pillar). Mas interesses/identidade ("amo Nujabes", "Samurai
-- Champloo") não geram atividade — esta tabela permite ligar entidade a pilar
-- diretamente, tanto por atividade quanto por inferência em conversa.

CREATE TABLE public.entity_pillars (
  user_id    uuid    NOT NULL REFERENCES public.profiles(id)       ON DELETE CASCADE,
  entity_id  uuid    NOT NULL REFERENCES public.semantic_entities(id) ON DELETE CASCADE,
  pillar_id  uuid    NOT NULL REFERENCES public.user_pillars(id)    ON DELETE CASCADE,
  weight     integer NOT NULL DEFAULT 1 CHECK (weight > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, pillar_id)
);

CREATE INDEX entity_pillars_user_idx   ON public.entity_pillars (user_id);
CREATE INDEX entity_pillars_pillar_idx ON public.entity_pillars (pillar_id);

ALTER TABLE public.entity_pillars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entity_pillars: leitura própria"
  ON public.entity_pillars FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "entity_pillars: inserção própria"
  ON public.entity_pillars FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "entity_pillars: atualização própria"
  ON public.entity_pillars FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "entity_pillars: remoção própria"
  ON public.entity_pillars FOR DELETE
  USING (auth.uid() = user_id);

-- Notas capturam o contexto de QUALQUER coisa, não só comida/gasto/humor/ideia.
-- Adiciona 'interest' para registrar interesses/identidade.
ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_note_type_check;
ALTER TABLE public.notes ADD CONSTRAINT notes_note_type_check
  CHECK (note_type = ANY (ARRAY['food', 'expense', 'mood', 'idea', 'interest', 'other']));
