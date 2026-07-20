-- AUTO-02: claim exclusivo e expiração.
--
-- A exclusividade é do banco, não da aplicação: o item é bloqueado com
-- FOR UPDATE e um índice único parcial impede um segundo claim aberto ainda
-- que alguém esqueça o lock. Expiração não apaga nada — o claim vencido é
-- liberado com razão declarada e a linha permanece auditável.
--
-- Claim NÃO é execução: acquire_work_claim jamais muda o estado do item nem
-- inicia tentativa. A sequência é eligible → claimed → attempt_started →
-- execution_started, e apenas start_claimed_work_attempt avança a segunda
-- metade, uma única vez por claim.

CREATE TABLE public.work_claims (
  id                        uuid        PRIMARY KEY,
  work_item_id              uuid        NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  user_id                   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  approved_proposal_version integer     NOT NULL CHECK (approved_proposal_version > 0),
  owner_instance_id         text        NOT NULL CHECK (length(btrim(owner_instance_id)) > 0),
  acquired_at               timestamptz NOT NULL DEFAULT now(),
  expires_at                timestamptz NOT NULL,
  attempt_id                uuid,
  released_at               timestamptz,
  release_reason            text,
  CHECK (expires_at > acquired_at),
  CHECK (release_reason IS NULL OR release_reason IN ('attempt_finished', 'released_without_attempt', 'expired')),
  CHECK ((released_at IS NULL) = (release_reason IS NULL)),
  CHECK (released_at IS NULL OR released_at >= acquired_at),
  -- Razão de liberação coerente com o que de fato aconteceu.
  CHECK (release_reason IS DISTINCT FROM 'attempt_finished' OR attempt_id IS NOT NULL),
  CHECK (release_reason IS DISTINCT FROM 'released_without_attempt' OR attempt_id IS NULL)
);

-- Invariante central: no máximo um claim aberto por item.
CREATE UNIQUE INDEX work_claims_single_open_per_item_idx
  ON public.work_claims (work_item_id) WHERE released_at IS NULL;

-- Uma tentativa pertence a no máximo um claim.
CREATE UNIQUE INDEX work_claims_attempt_idx
  ON public.work_claims (attempt_id) WHERE attempt_id IS NOT NULL;

CREATE INDEX work_claims_user_item_idx ON public.work_claims (user_id, work_item_id, acquired_at DESC);

ALTER TABLE public.work_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuário lê seus claims"
  ON public.work_claims FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.work_claims FROM anon, authenticated;
GRANT SELECT ON TABLE public.work_claims TO authenticated;
GRANT ALL ON TABLE public.work_claims TO service_role;

COMMENT ON TABLE public.work_claims IS
  'Posse exclusiva e temporária de um work item por uma instância de supervisor. Toda escrita passa pelas RPCs transacionais; expiração é derivada de expires_at e a liberação é sempre registrada, nunca apagada.';

-- ============================================================
-- Início de tentativa compartilhado entre execução comandada (INT-04) e
-- execução sob claim (AUTO-02). O corpo é o mesmo da RPC comandada; a razão e
-- a correlação de claim são os únicos parâmetros novos, e o payload comandado
-- permanece byte a byte idêntico quando não há claim.
-- ============================================================

CREATE FUNCTION private.begin_work_attempt(
  p_user_id                   uuid,
  p_work_item_id              uuid,
  p_expected_proposal_version integer,
  p_attempt_id                uuid,
  p_executor_id               text,
  p_reason                    text,
  p_claim_id                  uuid
)
RETURNS public.work_items
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_item public.work_items;
  v_started public.work_events;
  v_claim jsonb := CASE WHEN p_claim_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('claim_id', p_claim_id) END;
BEGIN
  SELECT * INTO v_item FROM public.work_items i
  WHERE i.id = p_work_item_id AND i.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_started FROM public.work_events e
  WHERE e.work_item_id = v_item.id AND e.event_type = 'execution_started'
    AND e.payload->'data'->>'attempt_id' = p_attempt_id::text
  ORDER BY e.seq DESC LIMIT 1;
  IF FOUND THEN
    IF v_started.proposal_version = p_expected_proposal_version
       AND v_started.payload->'data'->>'executor_id' = btrim(p_executor_id)
       AND v_started.payload->'data'->>'work_item_id' = v_item.id::text THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'attempt correlation conflict' USING ERRCODE='55000';
  END IF;

  IF v_item.state <> 'approved' OR v_item.proposal_version <> p_expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;
  IF jsonb_typeof(v_item.intent->'execution_spec') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'execution specification missing' USING ERRCODE='22023';
  END IF;

  UPDATE public.work_items SET state='in_progress', updated_at=now() WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
    (v_item.id,'work_started','user',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',
        jsonb_build_object('reason',p_reason,'attempt_id',p_attempt_id) || v_claim)),
    (v_item.id,'execution_started','anima',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',
        jsonb_build_object(
          'work_item_id',v_item.id,'attempt_id',p_attempt_id,'approved_proposal_version',v_item.proposal_version,
          'origin','anima','executor_id',btrim(p_executor_id)) || v_claim));
  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION private.begin_work_attempt(uuid,uuid,integer,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_commanded_work_attempt(
  work_item_id uuid,
  expected_proposal_version integer,
  attempt_id uuid,
  executor_id text
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version < 1 OR attempt_id IS NULL
     OR executor_id IS NULL OR length(btrim(executor_id))=0 THEN
    RAISE EXCEPTION 'invalid commanded attempt input' USING ERRCODE='22023';
  END IF;

  RETURN private.begin_work_attempt(
    v_user_id, work_item_id, expected_proposal_version, attempt_id, executor_id, 'commanded_execution', NULL);
END;
$$;

-- ============================================================
-- Aquisição atômica do claim.
-- ============================================================

CREATE FUNCTION public.acquire_work_claim(
  work_item_id uuid,
  expected_proposal_version integer,
  claim_id uuid,
  owner_instance_id text,
  lease_seconds integer
)
RETURNS public.work_claims
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_existing public.work_claims;
  v_open public.work_claims;
  v_superseded uuid := NULL;
  v_now timestamptz := now();
  v_owner text := btrim(owner_instance_id);
  v_claim public.work_claims;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF claim_id IS NULL OR expected_proposal_version IS NULL OR expected_proposal_version < 1
     OR owner_instance_id IS NULL OR length(v_owner)=0
     OR lease_seconds IS NULL OR lease_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid claim request' USING ERRCODE='22023';
  END IF;

  -- Lock do item: dois supervisores concorrentes são serializados aqui.
  SELECT * INTO v_item FROM public.work_items i
  WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  -- Identidade e replay antes de elegibilidade: uma reentrega legítima chega
  -- depois de o item já ter saído de `approved`.
  SELECT * INTO v_existing FROM public.work_claims c WHERE c.id=claim_id AND c.user_id=v_user_id;
  IF FOUND THEN
    IF v_existing.work_item_id <> v_item.id OR v_existing.owner_instance_id <> v_owner
       OR v_existing.approved_proposal_version <> expected_proposal_version THEN
      RAISE EXCEPTION 'claim identity conflict' USING ERRCODE='55000';
    END IF;
    IF v_existing.released_at IS NOT NULL THEN
      RAISE EXCEPTION 'claim already released' USING ERRCODE='55000';
    END IF;
    IF v_now >= v_existing.expires_at THEN
      RAISE EXCEPTION 'claim expired' USING ERRCODE='55000';
    END IF;
    RETURN v_existing;
  END IF;

  IF v_item.state <> 'approved' OR v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'work item is not eligible for an autonomous claim' USING ERRCODE='55000';
  END IF;
  IF jsonb_typeof(v_item.intent->'execution_spec') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'execution specification missing' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_open FROM public.work_claims c
  WHERE c.work_item_id=v_item.id AND c.released_at IS NULL FOR UPDATE;
  IF FOUND THEN
    IF v_now < v_open.expires_at THEN
      RAISE EXCEPTION 'work item is held by an active claim' USING ERRCODE='55000';
    END IF;
    -- Claim vencido é recuperável: liberado com razão declarada, linha preservada.
    UPDATE public.work_claims SET released_at=v_now, release_reason='expired'
    WHERE id=v_open.id RETURNING * INTO v_open;
    v_superseded := v_open.id;
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
      (v_item.id,'work_claim_released','system',v_open.approved_proposal_version,
        jsonb_build_object('schema_version',1,'data',jsonb_build_object(
          'claim_id',v_open.id,'work_item_id',v_item.id,
          'approved_proposal_version',v_open.approved_proposal_version,
          'owner_instance_id',v_open.owner_instance_id,'attempt_id',v_open.attempt_id,
          'reason','expired','released_at',v_now)));
  END IF;

  INSERT INTO public.work_claims(id,work_item_id,user_id,approved_proposal_version,owner_instance_id,acquired_at,expires_at)
  VALUES (claim_id,v_item.id,v_user_id,expected_proposal_version,v_owner,v_now,v_now + make_interval(secs => lease_seconds))
  RETURNING * INTO v_claim;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
    (v_item.id,'work_claimed','system',v_claim.approved_proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_build_object(
        'claim_id',v_claim.id,'work_item_id',v_item.id,
        'approved_proposal_version',v_claim.approved_proposal_version,
        'owner_instance_id',v_claim.owner_instance_id,'acquired_at',v_claim.acquired_at,
        'expires_at',v_claim.expires_at,'superseded_claim_id',v_superseded)));

  RETURN v_claim;
END;
$$;

-- ============================================================
-- Início da tentativa sob claim: no máximo uma por claim.
-- ============================================================

CREATE FUNCTION public.start_claimed_work_attempt(
  claim_id uuid,
  attempt_id uuid,
  executor_id text
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_claim public.work_claims;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF claim_id IS NULL OR attempt_id IS NULL OR executor_id IS NULL OR length(btrim(executor_id))=0 THEN
    RAISE EXCEPTION 'invalid claimed attempt input' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_claim FROM public.work_claims c
  WHERE c.id=claim_id AND c.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim not found' USING ERRCODE='P0002'; END IF;

  IF v_claim.attempt_id IS NOT NULL THEN
    IF v_claim.attempt_id <> attempt_id THEN
      RAISE EXCEPTION 'claim already started another attempt' USING ERRCODE='55000';
    END IF;
    -- Replay: begin_work_attempt reconhece a tentativa já iniciada.
  ELSE
    IF v_claim.released_at IS NOT NULL THEN
      RAISE EXCEPTION 'claim already released' USING ERRCODE='55000';
    END IF;
    IF now() >= v_claim.expires_at THEN
      RAISE EXCEPTION 'claim expired' USING ERRCODE='55000';
    END IF;
    -- Qualificado pelo nome da função: `attempt_id` também é coluna.
    UPDATE public.work_claims c SET attempt_id=start_claimed_work_attempt.attempt_id
    WHERE c.id=v_claim.id RETURNING c.* INTO v_claim;
  END IF;

  RETURN private.begin_work_attempt(
    v_user_id, v_claim.work_item_id, v_claim.approved_proposal_version,
    attempt_id, executor_id, 'supervised_execution', v_claim.id);
END;
$$;

-- ============================================================
-- Liberação auditável.
-- ============================================================

CREATE FUNCTION public.release_work_claim(
  claim_id uuid,
  reason text
)
RETURNS public.work_claims
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_claim public.work_claims;
  v_now timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF claim_id IS NULL OR reason IS NULL OR reason NOT IN ('attempt_finished','released_without_attempt','expired') THEN
    RAISE EXCEPTION 'invalid claim release' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_claim FROM public.work_claims c
  WHERE c.id=claim_id AND c.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim not found' USING ERRCODE='P0002'; END IF;

  IF v_claim.released_at IS NOT NULL THEN
    IF v_claim.release_reason = reason THEN RETURN v_claim; END IF;
    RAISE EXCEPTION 'claim already released with a different reason' USING ERRCODE='55000';
  END IF;
  IF reason='attempt_finished' AND v_claim.attempt_id IS NULL THEN
    RAISE EXCEPTION 'no attempt was started under this claim' USING ERRCODE='22023';
  END IF;
  IF reason='released_without_attempt' AND v_claim.attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'an attempt was started under this claim' USING ERRCODE='22023';
  END IF;

  UPDATE public.work_claims SET released_at=v_now, release_reason=reason
  WHERE id=v_claim.id RETURNING * INTO v_claim;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
    (v_claim.work_item_id,'work_claim_released','system',v_claim.approved_proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_build_object(
        'claim_id',v_claim.id,'work_item_id',v_claim.work_item_id,
        'approved_proposal_version',v_claim.approved_proposal_version,
        'owner_instance_id',v_claim.owner_instance_id,'attempt_id',v_claim.attempt_id,
        'reason',reason,'released_at',v_now)));

  RETURN v_claim;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_work_claim(uuid,integer,uuid,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_claimed_work_attempt(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_work_claim(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_work_claim(uuid,integer,uuid,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_claimed_work_attempt(uuid,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_work_claim(uuid,text) TO authenticated, service_role;
