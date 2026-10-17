-- A2-0 / Recorte 1 — fato de CONTEXTO DE EXECUÇÃO observado pelo host.
-- CANDIDATA: NÃO aplicar no residente sem checkpoint humano. Depende de 20261016000000 (vocabulário).
--
-- Modelo de confiança (quatro papéis distintos):
--   1. AUTORIDADE que concede  — DERIVADA PELO BANCO do ledger (work_approved + work_intelligence_classified
--      da versão aprovada, anteriores à attempt). O cliente nunca a declara.
--   2. RUNNER autenticado      — declarado pelo host (`evidence.runner`), CONFERIDO contra o dono do item
--      (a sessão do runner só enxerga o item se for o dono). Identidade divergente ⇒ 42501.
--   3. TRUSTED SYSTEM WRITER   — única identidade que executa a RPC (`private.trusted_system_writer_owner()`).
--      Sessão humana, anon, service_role e runner comum são recusados.
--   4. MODO de execução        — declarado pelo host e VALIDADO contra o ledger. `unattended` só é aceito com:
--      claim na attempt, nenhuma supervision lease do item e nenhum ato humano depois do mandato.
--      `supervised`/`manual` são rebaixamentos seguros e não exigem prova negativa.
--
-- Idempotência: um fato por attempt (índice único). Reobservação idêntica (ignorando observedAt) replaya SEM
-- reavaliar o ledger (o ledger pode ter mudado legitimamente depois); conteúdo divergente é conflito 55000.
-- Append-only: não altera estado do item, não aceita, não integra, não toca orçamento, Verifier ou routing.

CREATE FUNCTION private.is_valid_host_execution_context(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN false
    -- Conjunto de chaves FECHADO: campos extras (ex.: role, authority, actor forjado) são recusados.
    WHEN (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) AS k)
         IS DISTINCT FROM ARRAY['actorKind','approvedProposalVersion','attemptId','executionMode','observedAt','runner','schemaVersion','workItemId']::text[] THEN false
    WHEN p -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'workItemId') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'attemptId') THEN false
    WHEN NOT private.jsonb_is_positive_integer(p -> 'approvedProposalVersion') THEN false
    WHEN NOT private.jsonb_is_nonblank_string(p -> 'observedAt') THEN false
    WHEN jsonb_typeof(p -> 'executionMode') IS DISTINCT FROM 'string'
      OR (p ->> 'executionMode') NOT IN ('unattended','supervised','manual') THEN false
    WHEN jsonb_typeof(p -> 'actorKind') IS DISTINCT FROM 'string'
      OR (p ->> 'actorKind') NOT IN ('automated_runner','human_operator') THEN false
    WHEN (p ->> 'executionMode') = 'unattended' AND (p ->> 'actorKind') <> 'automated_runner' THEN false
    WHEN (p ->> 'executionMode') = 'manual' AND (p ->> 'actorKind') <> 'human_operator' THEN false
    WHEN jsonb_typeof(p -> 'runner') IS DISTINCT FROM 'object' THEN false
    WHEN (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p -> 'runner') AS k)
         IS DISTINCT FROM ARRAY['authenticatedUserId','instanceId','kind']::text[] THEN false
    WHEN jsonb_typeof(p #> '{runner,kind}') IS DISTINCT FROM 'string'
      OR (p #>> '{runner,kind}') NOT IN ('resident_host','single_item_cli','scheduled_launcher','interactive_ui') THEN false
    WHEN jsonb_typeof(p #> '{runner,authenticatedUserId}') IS DISTINCT FROM 'string'
      OR (p #>> '{runner,authenticatedUserId}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
    WHEN jsonb_typeof(p #> '{runner,instanceId}') IS DISTINCT FROM 'string'
      OR (p #>> '{runner,instanceId}') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' THEN false
    ELSE true
  END;
$$;
REVOKE ALL ON FUNCTION private.is_valid_host_execution_context(jsonb) FROM PUBLIC, anon, authenticated;

-- Garantia final: no máximo UM fato de contexto por attempt (defesa contra corrida entre duas escritas).
CREATE UNIQUE INDEX work_events_host_execution_context_attempt_idx
  ON public.work_events ((payload -> 'data' ->> 'attempt_id'))
  WHERE event_type = 'host_observed_execution_context_recorded';

CREATE FUNCTION public.record_host_observed_execution_context(
  work_item_id uuid,
  expected_proposal_version integer,
  attempt_id uuid,
  evidence jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id    uuid := private.trusted_system_writer_owner();
  v_item       public.work_items;
  v_started    public.work_events;
  v_existing   public.work_events;
  v_approved   public.work_events;
  v_classified public.work_events;
  v_mandate_seq bigint;
  v_approval_author text;
  v_approval_authority text;
  v_leases     integer;
  v_human_acts integer;
  v_mode       text;
  v_actor      text;
  v_authority  jsonb;
  v_event_seq  bigint;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'trusted system writer required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version < 1 OR attempt_id IS NULL
     OR jsonb_typeof(evidence) IS DISTINCT FROM 'object' OR NOT private.is_valid_host_execution_context(evidence) THEN
    RAISE EXCEPTION 'invalid host execution context' USING ERRCODE='22023';
  END IF;
  IF evidence->>'workItemId' IS DISTINCT FROM work_item_id::text
     OR evidence->>'attemptId' IS DISTINCT FROM attempt_id::text
     OR (evidence->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version THEN
    RAISE EXCEPTION 'host execution context correlation mismatch' USING ERRCODE='22023';
  END IF;
  -- Identidade do runner: a declaração precisa coincidir com o dono do item (sessão do runner = dono sob RLS).
  IF (evidence #>> '{runner,authenticatedUserId}') IS DISTINCT FROM v_user_id::text THEN
    RAISE EXCEPTION 'runner identity does not match item owner' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  -- Attempt real, da versão aprovada declarada.
  SELECT * INTO v_started FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
    AND e.proposal_version=expected_proposal_version
    AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002'; END IF;

  -- Idempotência por attempt, ignorando observedAt; replay NÃO reavalia o ledger.
  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='host_observed_execution_context_recorded'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF FOUND THEN
    IF (v_existing.payload->'data'->'evidence') - 'observedAt' = evidence - 'observedAt' THEN
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq);
    END IF;
    RAISE EXCEPTION 'host execution context conflict' USING ERRCODE='55000';
  END IF;

  v_mode  := evidence->>'executionMode';
  v_actor := evidence->>'actorKind';

  -- Autoridade DERIVADA do ledger: último work_approved e última classificação da versão, anteriores à attempt.
  SELECT * INTO v_approved FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='work_approved'
    AND e.proposal_version=expected_proposal_version AND e.seq < v_started.seq
  ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'mandate approval not found' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_classified FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='work_intelligence_classified'
    AND e.proposal_version=expected_proposal_version AND e.seq < v_started.seq
  ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'mandate classification not found' USING ERRCODE='55000'; END IF;

  IF v_approved.author='user' THEN
    v_approval_author:='user'; v_approval_authority:='human';
  ELSIF v_approved.author='system' AND v_approved.payload->'data'->>'authority'='autonomous_policy' THEN
    v_approval_author:='system'; v_approval_authority:='autonomous_policy';
  ELSE
    RAISE EXCEPTION 'mandate approval authority not recognized' USING ERRCODE='55000';
  END IF;
  v_mandate_seq := GREATEST(v_approved.seq, v_classified.seq);

  SELECT count(*) INTO v_leases FROM public.work_supervision_leases l WHERE l.work_item_id=v_item.id;
  SELECT count(*) INTO v_human_acts FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.author='user' AND e.seq > v_mandate_seq
    AND e.event_type::text IN ('work_approved','work_intelligence_classified','result_accepted','integration_effect_authorized',
      'changes_requested','proposal_changes_requested','work_cancelled','work_rejected','input_provided',
      'manual_work_released','work_deferred','work_paused','work_control_requested');

  IF v_mode = 'unattended' THEN
    IF v_leases > 0 THEN RAISE EXCEPTION 'unattended not supported: supervision lease exists' USING ERRCODE='55000'; END IF;
    IF v_human_acts > 0 THEN RAISE EXCEPTION 'unattended not supported: human act after mandate' USING ERRCODE='55000'; END IF;
    IF nullif(v_started.payload->'data'->>'claim_id','') IS NULL THEN
      RAISE EXCEPTION 'unattended not supported: attempt without claim' USING ERRCODE='55000';
    END IF;
  END IF;

  v_authority := jsonb_build_object(
    'approval_author', v_approval_author, 'approval_authority', v_approval_authority,
    'approved_seq', v_approved.seq, 'classified_seq', v_classified.seq,
    'leases_observed', v_leases, 'human_acts_after_mandate', v_human_acts);

  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, 'host_observed_execution_context_recorded', 'system', expected_proposal_version,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
      'work_item_id', v_item.id,
      'attempt_id', attempt_id,
      'approved_proposal_version', expected_proposal_version,
      'origin', 'host',
      'recorded_by', 'trusted_system_writer',
      'execution_mode', v_mode,
      'actor_kind', v_actor,
      'authority', v_authority,
      'evidence', evidence)))
  RETURNING seq INTO v_event_seq;

  RETURN jsonb_build_object('action','recorded','event_seq',v_event_seq);
END;
$$;

REVOKE ALL ON FUNCTION public.record_host_observed_execution_context(uuid,integer,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_host_observed_execution_context(uuid,integer,uuid,jsonb) TO anima_system_writer;

COMMENT ON FUNCTION public.record_host_observed_execution_context(uuid,integer,uuid,jsonb) IS
  'A2-0 R1. Registra execution_mode/actor_kind de UMA attempt. Só o Trusted System Writer. A autoridade é derivada do ledger; o runner é conferido contra o dono do item; unattended exige claim, zero leases e zero atos humanos após o mandato. Idempotente por attempt; append-only; sem efeito em estado, orçamento, Verifier ou integração.';
