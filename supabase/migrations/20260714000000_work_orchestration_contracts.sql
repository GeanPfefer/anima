-- ============================================================
-- Anima — contratos persistentes da Orquestração de Trabalho
--
-- Esta migration define somente o vocabulário e o schema da F2.
-- Segurança de escrita, RPCs e RLS serão adicionados em migrations
-- posteriores, antes de a feature ser integrada à main.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE TYPE public.work_state AS ENUM (
  'proposed',
  'approved',
  'in_progress',
  'blocked',
  'review',
  'changes_requested',
  'completed',
  'failed',
  'rejected',
  'cancelled'
);

CREATE TYPE public.work_event_type AS ENUM (
  'work_proposed',
  'proposal_revised',
  'proposal_changes_requested',
  'work_deferred',
  'work_approved',
  'work_rejected',
  'work_started',
  'context_attached',
  'input_requested',
  'input_provided',
  'work_blocked',
  'execution_started',
  'execution_failed',
  'result_submitted',
  'changes_requested',
  'result_accepted',
  'work_cancelled'
);

CREATE TYPE public.work_approval_decision AS ENUM (
  'approve',
  'reject',
  'request_changes',
  'defer'
);

CREATE TYPE public.work_event_author AS ENUM (
  'user',
  'anima',
  'executor',
  'system'
);

CREATE TYPE public.work_impact_level AS ENUM (
  'low',
  'significant',
  'structural',
  'strategic',
  'financial',
  'irreversible',
  'external'
);

CREATE TYPE public.work_capability AS ENUM (
  'programming',
  'research',
  'architecture',
  'planning',
  'learning',
  'organization',
  'home_automation',
  'critical_reflection'
);

CREATE TABLE public.work_items (
  id                uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid                     NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_message_id uuid                     NOT NULL REFERENCES public.ai_conversations(id) ON DELETE RESTRICT,
  state             public.work_state        NOT NULL DEFAULT 'proposed',
  impact_level      public.work_impact_level NOT NULL,
  capability        public.work_capability   NOT NULL,
  original_request  text                     NOT NULL CHECK (length(btrim(original_request)) > 0),
  intent            jsonb                    NOT NULL CHECK (jsonb_typeof(intent) = 'object'),
  proposal          jsonb                    NOT NULL,
  proposal_version  integer                  NOT NULL DEFAULT 1 CHECK (proposal_version > 0),
  created_at        timestamptz              NOT NULL DEFAULT now(),
  updated_at        timestamptz              NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(proposal) = 'object'),
  CHECK (proposal @> '{"schema_version": 1}'::jsonb),
  CHECK (jsonb_typeof(proposal -> 'data') = 'object'),
  CHECK (updated_at >= created_at)
);

CREATE INDEX work_items_user_state_updated_idx
  ON public.work_items (user_id, state, updated_at DESC);

CREATE INDEX work_items_source_message_idx
  ON public.work_items (source_message_id);

CREATE TABLE public.work_events (
  id               uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id     uuid                     NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  event_type       public.work_event_type   NOT NULL,
  author           public.work_event_author NOT NULL,
  proposal_version integer                  CHECK (proposal_version > 0),
  payload          jsonb                    NOT NULL,
  created_at       timestamptz              NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (payload @> '{"schema_version": 1}'::jsonb),
  CHECK (jsonb_typeof(payload -> 'data') = 'object'),
  CHECK (
    event_type NOT IN (
      'work_proposed',
      'proposal_revised',
      'proposal_changes_requested',
      'work_deferred',
      'work_approved',
      'work_rejected',
      'result_submitted',
      'changes_requested',
      'result_accepted'
    )
    OR proposal_version IS NOT NULL
  )
);

CREATE INDEX work_events_item_time_idx
  ON public.work_events (work_item_id, created_at, id);

CREATE INDEX work_events_type_time_idx
  ON public.work_events (event_type, created_at DESC);

-- Allowlist operacional privada. UUIDs reais serão incluídos somente por
-- operação administrativa ou service role, nunca por migration versionada.
CREATE TABLE private.work_orchestration_allowlist (
  user_id    uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  enabled_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reason     text        CHECK (reason IS NULL OR length(btrim(reason)) > 0)
);

-- Matriz fechada consumida pelas futuras RPCs. Eventos que não mudam estado
-- (context_attached, input_requested e input_provided) não aparecem aqui.
CREATE TABLE private.work_state_transitions (
  from_state public.work_state      NOT NULL,
  event_type public.work_event_type NOT NULL,
  to_state   public.work_state      NOT NULL,
  PRIMARY KEY (from_state, event_type),
  UNIQUE (from_state, to_state, event_type)
);

INSERT INTO private.work_state_transitions (from_state, event_type, to_state) VALUES
  ('proposed',          'proposal_revised',  'proposed'),
  ('proposed',          'proposal_changes_requested', 'proposed'),
  ('proposed',          'work_deferred',     'proposed'),
  ('proposed',          'work_approved',     'approved'),
  ('proposed',          'work_rejected',     'rejected'),
  ('proposed',          'work_cancelled',    'cancelled'),
  ('approved',          'work_started',      'in_progress'),
  ('approved',          'work_cancelled',    'cancelled'),
  ('in_progress',       'work_blocked',      'blocked'),
  ('in_progress',       'execution_failed',  'failed'),
  ('in_progress',       'result_submitted',  'review'),
  ('in_progress',       'work_cancelled',    'cancelled'),
  ('blocked',           'work_started',      'in_progress'),
  ('blocked',           'work_cancelled',    'cancelled'),
  ('review',            'changes_requested', 'changes_requested'),
  ('review',            'result_accepted',   'completed'),
  ('review',            'work_cancelled',    'cancelled'),
  ('changes_requested', 'work_started',      'in_progress'),
  ('changes_requested', 'work_cancelled',    'cancelled');

COMMENT ON TABLE public.work_items IS
  'Projeção atual de uma unidade de trabalho. Toda mutação será feita pelas RPCs transacionais da F2.';

COMMENT ON COLUMN public.work_items.proposal IS
  'Envelope versionado {"schema_version":1,"data":{"summary":string,"objective":string,"included_scope":string[],"excluded_scope":string[],"expected_effects":string[],"risks":string[]}}.';

COMMENT ON COLUMN public.work_events.payload IS
  'Envelope versionado {"schema_version":1,"data":object}. data é derivado no servidor; campos iniciais: work_proposed/proposal_revised={proposal}; proposal_changes_requested={requested_changes,reviewed_proposal_version}; work_deferred={reason,reviewed_proposal_version}; work_approved/work_rejected={decision,decided_proposal_version}; result_submitted={summary,result_references}; changes_requested={requested_changes,reviewed_proposal_version}; result_accepted={accepted_result_event_id}; eventos operacionais={reason|context_references|input|failure} conforme o tipo.';

COMMENT ON COLUMN public.work_events.proposal_version IS
  'Versão exata da proposta à qual o evento se refere; obrigatória para eventos de proposta, aprovação, rejeição, revisão e aceite.';

COMMENT ON TABLE private.work_orchestration_allowlist IS
  'Habilitação privada da Orquestração de Trabalho. Sem acesso direto de clientes.';

COMMENT ON TABLE private.work_state_transitions IS
  'Matriz normativa de mudanças de estado. Ausência de linha significa transição proibida.';

-- Assinaturas normativas das RPCs a implementar no próximo commit:
--
-- public.create_work_proposal(
--   source_message_id uuid,
--   impact_level public.work_impact_level,
--   capability public.work_capability,
--   intent jsonb,
--   proposal jsonb
-- ) RETURNS public.work_items
--
-- public.revise_work_proposal(
--   work_item_id uuid,
--   expected_proposal_version integer,
--   intent jsonb,
--   proposal jsonb
-- ) RETURNS public.work_items
--
-- public.resolve_approval(
--   work_item_id uuid,
--   expected_proposal_version integer,
--   decision public.work_approval_decision,
--   decision_context jsonb DEFAULT '{}'::jsonb
-- ) RETURNS public.work_items
--
-- public.start_work(
--   work_item_id uuid,
--   expected_proposal_version integer
-- ) RETURNS public.work_items
--
-- public.submit_work_result(
--   work_item_id uuid,
--   expected_proposal_version integer,
--   result jsonb
-- ) RETURNS public.work_items
--
-- O cliente fornece intenção, proposta candidata, decisão semântica ou
-- resultado. user_id, estados, autores e eventos são sempre derivados pela RPC.
