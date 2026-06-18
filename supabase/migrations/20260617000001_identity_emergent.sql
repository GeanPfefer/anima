-- Identidade Emergente: hipóteses vivas sobre o usuário (valores, objetivos,
-- crenças, medos, motivações, interesses, padrões) com evidências rastreáveis.
-- A identidade não é cadastrada — emerge da memória (notas, entidades, conversas).
-- Toda hipótese deve poder mostrar POR QUE existe (identity_evidence).

CREATE TABLE public.identity_hypotheses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type = ANY (ARRAY['value','goal','belief','motivation','fear','interest','pattern'])),
  label            text NOT NULL,
  description      text,
  confidence       integer NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  status           text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','confirmed','rejected'])),
  evidence_count   integer NOT NULL DEFAULT 0,
  last_evidence_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Uma hipótese por (usuário, tipo, rótulo) — o gerador atualiza em vez de duplicar.
CREATE UNIQUE INDEX identity_hypotheses_user_type_label_uniq
  ON public.identity_hypotheses (user_id, type, lower(label));
CREATE INDEX identity_hypotheses_user_idx ON public.identity_hypotheses (user_id);

CREATE TABLE public.identity_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hypothesis_id uuid NOT NULL REFERENCES public.identity_hypotheses(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_type   text NOT NULL CHECK (source_type = ANY (ARRAY['note','entity','activity','conversation'])),
  source_id     uuid,              -- id da origem (polimórfico, sem FK rígida)
  snippet       text,              -- trecho da evidência, exibido sem joins
  weight        integer NOT NULL DEFAULT 1 CHECK (weight > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX identity_evidence_hypothesis_idx ON public.identity_evidence (hypothesis_id);

-- ─── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.identity_hypotheses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_evidence   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "identity_hypotheses: leitura própria"
  ON public.identity_hypotheses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "identity_hypotheses: inserção própria"
  ON public.identity_hypotheses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "identity_hypotheses: atualização própria"
  ON public.identity_hypotheses FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "identity_hypotheses: remoção própria"
  ON public.identity_hypotheses FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "identity_evidence: leitura própria"
  ON public.identity_evidence FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "identity_evidence: inserção própria"
  ON public.identity_evidence FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "identity_evidence: remoção própria"
  ON public.identity_evidence FOR DELETE USING (auth.uid() = user_id);
