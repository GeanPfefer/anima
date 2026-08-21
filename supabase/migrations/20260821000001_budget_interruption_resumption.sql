-- INTEL-04 (coerência V0) — retomada de tentativa interrompida NO MEIO por
-- orçamento TEMPORAL, a partir do checkpoint persistido, quando a janela recupera.
--
-- Distinção deliberada de `readmit_budget_blocked_work` (recorte anterior):
--   * bloqueio PRÉ-tentativa   -> `work_blocked` de orçamento SEM attempt_id;
--     a recuperação é uma readmissão simples blocked->approved e um começo do zero
--     (não há checkpoint a resumir). Tratada por `readmit_budget_blocked_work`.
--   * interrupção EM tentativa -> `interrupt_work_on_budget` deixou `work_blocked`
--     COM attempt_id + checkpoint_event_seq, tentativa já iniciada, claim liberada.
--     Recomeçar do zero descartaria trabalho e checkpoint válidos. A recuperação
--     tem de RESUMIR do checkpoint pela arquitetura de retomada (AUTO-05), como o
--     `human_decision_checkpoint` — mas sem entrada humana, porque o limite é
--     temporal (janela móvel) e não uma decisão.
--
-- Espelha exatamente o par ratificado `human_decision_resumption_source` +
-- `begin_human_decision_resumed_attempt`. Nada afrouxa o orçamento: a guarda
-- atômica `enforce_autonomous_work_budget_before_start` revalida no execution_started
-- da retomada; a readmissão e a fonte só agem quando `admitted=true`.

-- Razões de orçamento (janela móvel). A interrupção em tentativa só produz as
-- duas temporais, mas a discriminação real entre pré/em-tentativa é o attempt_id.
CREATE FUNCTION private.is_budget_block_reason(p_reason text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT p_reason IN ('item_attempt_budget_exhausted','user_attempt_budget_exhausted',
    'user_runtime_budget_exhausted','interactive_reserve_protected');
$$;

-- 1) Readmissão (blocked->approved) de UMA interrupção de orçamento EM tentativa.
--    Guarda estreita e ALINHADA à fonte de retomada: só re-admite quando o último
--    `work_blocked` é de orçamento, COM attempt_id, com checkpoint_event_seq
--    apontando um `checkpoint_recorded` válido dessa tentativa — assim uma
--    readmissão nunca leva a um restart cego. Assume o lock consultivo por usuário.
CREATE FUNCTION private.readmit_budget_interrupted_item(
  p_user_id uuid, p_work_item_id uuid, p_observed_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE
  v_item public.work_items; v_block public.work_events; v_reason text;
  v_attempt text; v_cp_seq bigint; v_decision jsonb;
BEGIN
  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=p_work_item_id AND i.user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('readmitted',false,'reason','not_found'); END IF;
  IF v_item.state<>'blocked' THEN RETURN jsonb_build_object('readmitted',false,'reason','not_blocked'); END IF;

  SELECT * INTO v_block FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.event_type='work_blocked'
   ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('readmitted',false,'reason','not_budget_interrupted'); END IF;
  v_reason:=v_block.payload->'data'->>'reason';
  v_attempt:=v_block.payload->'data'->>'attempt_id';
  v_cp_seq:=(v_block.payload->'data'->>'checkpoint_event_seq')::bigint;
  -- Precisa ser interrupção EM tentativa (attempt_id presente), de orçamento, com
  -- um checkpoint válido correlacionado. Pré-tentativa e decisão humana caem fora.
  IF v_attempt IS NULL OR NOT private.is_budget_block_reason(v_reason) OR v_cp_seq IS NULL
     OR NOT EXISTS(SELECT 1 FROM public.work_events cp WHERE cp.seq=v_cp_seq
       AND cp.work_item_id=v_item.id AND cp.event_type='checkpoint_recorded'
       AND cp.proposal_version=v_item.proposal_version
       AND cp.payload->'data'->>'attempt_id'=v_attempt) THEN
    RETURN jsonb_build_object('readmitted',false,'reason','not_budget_interrupted');
  END IF;

  v_decision:=private.autonomous_work_budget_decision(p_user_id,v_item.id,p_observed_at);
  IF NOT coalesce((v_decision->>'admitted')::boolean,false) THEN
    RETURN jsonb_build_object('readmitted',false,'reason','still_exhausted','budget',v_decision);
  END IF;

  UPDATE public.work_items SET state='approved',updated_at=p_observed_at
   WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'work_approved','system',v_item.proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'reason','budget_window_recovered','budget_interruption',true,
      'budget_reason',v_reason,'source_attempt_id',v_attempt,
      'blocked_event_seq',v_block.seq,'checkpoint_event_seq',v_cp_seq,
      'readmitted_at',p_observed_at)));
  RETURN jsonb_build_object('readmitted',true,'budgetReason',v_reason,'budget',v_decision);
END; $$;

REVOKE ALL ON FUNCTION private.readmit_budget_interrupted_item(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.readmit_budget_interrupted_item(uuid,uuid,timestamptz) TO service_role;

CREATE FUNCTION public.readmit_budget_interrupted_work()
RETURNS TABLE (work_item_id uuid, budget_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_uid uuid:=auth.uid(); v_now timestamptz:=now(); v_candidate uuid; v_outcome jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||v_uid::text,0));
  FOR v_candidate IN
    SELECT i.id FROM public.work_items i
     WHERE i.user_id=v_uid AND i.state='blocked' ORDER BY i.updated_at
  LOOP
    v_outcome:=private.readmit_budget_interrupted_item(v_uid,v_candidate,v_now);
    IF coalesce((v_outcome->>'readmitted')::boolean,false) THEN
      work_item_id:=v_candidate; budget_reason:=v_outcome->>'budgetReason'; RETURN NEXT;
    END IF;
  END LOOP;
END; $$;

REVOKE ALL ON FUNCTION public.readmit_budget_interrupted_work() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.readmit_budget_interrupted_work() TO authenticated,service_role;

COMMENT ON FUNCTION public.readmit_budget_interrupted_work() IS
  'INTEL-04: re-admite (blocked->approved) as interrupções de orçamento EM tentativa (com checkpoint) cuja janela recuperou, emitindo work_approved system/budget_window_recovered. A retomada em si (do checkpoint) é feita por begin_budget_interruption_resumed_attempt. Idempotente, sem override do teto, sem entrada humana falsa.';

-- 2) Fonte de retomada, derivada só de estado persistido. Espelha
--    human_decision_resumption_source: constrói um WorkHandoffV1 a partir do
--    checkpoint da interrupção, com stopReason temporal `time_limit_reached`.
CREATE FUNCTION public.budget_interruption_resumption_source(p_work_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog STABLE AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_item public.work_items; v_block public.work_events;
  v_cp public.work_events; v_attempt text; v_cp_seq bigint; v_cp_data jsonb; v_claim_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=p_work_item_id AND i.user_id=v_uid;
  IF NOT FOUND OR v_item.state<>'approved' THEN RETURN NULL; END IF;

  -- Interrupção de orçamento EM tentativa mais recente (com attempt_id +
  -- checkpoint). Robusto a um bloqueio PRÉ-tentativa posterior (sem attempt_id):
  -- este não é uma tentativa e não pode mascarar a interrupção pendente.
  SELECT * INTO v_block FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.event_type='work_blocked'
     AND e.proposal_version=v_item.proposal_version
     AND e.payload->'data'->>'attempt_id' IS NOT NULL
     AND private.is_budget_block_reason(e.payload->'data'->>'reason')
     AND (e.payload->'data'->>'checkpoint_event_seq') IS NOT NULL
   ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_attempt:=v_block.payload->'data'->>'attempt_id';
  v_cp_seq:=(v_block.payload->'data'->>'checkpoint_event_seq')::bigint;
  -- Nenhuma tentativa (fresh OU retomada) pode ter começado depois: um
  -- execution_started posterior supersede esta interrupção e encerra a fonte.
  IF EXISTS(SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id
    AND e.event_type='execution_started' AND e.seq>v_block.seq) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_cp FROM public.work_events e WHERE e.seq=v_cp_seq
    AND e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
    AND e.proposal_version=v_item.proposal_version
    AND e.payload->'data'->>'attempt_id'=v_attempt;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_cp_data:=v_cp.payload->'data'->'checkpoint';
  -- Claim (liberada) da tentativa de origem, para o plano recusar reaproveitamento.
  SELECT c.id INTO v_claim_id FROM public.work_claims c
   WHERE c.work_item_id=v_item.id AND c.attempt_id=v_attempt::uuid ORDER BY c.acquired_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'kind','budget_interruption_checkpoint',
    'interruption_event_seq',v_block.seq,
    'checkpoint_event_seq',v_cp.seq,
    'budget_reason',v_block.payload->'data'->>'reason',
    'handoff',jsonb_build_object(
      'schemaVersion',1,'workItemId',v_item.id,'attemptId',v_attempt,
      'approvedProposalVersion',v_item.proposal_version,'claimId',v_claim_id,
      'status','paused','stopReason','time_limit_reached',
      'handoffReference',v_cp_data->>'handoffReference',
      'completedSteps',v_cp_data->'completedSteps','remainingSteps',v_cp_data->'remainingSteps',
      'decisions',v_cp_data->'decisions','risks',v_cp_data->'risks','nextStep',v_cp_data->>'nextStep',
      'touchedResources',v_cp_data->'touchedResources','validations',v_cp_data->'validations',
      'failures',v_cp_data->'failures','evidenceReferences',v_cp_data->'evidenceReferences'),
    'previous_attempt_ids',(SELECT coalesce(jsonb_agg(DISTINCT e.payload->'data'->>'attempt_id'),'[]'::jsonb)
      FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'));
END; $$;

REVOKE ALL ON FUNCTION public.budget_interruption_resumption_source(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.budget_interruption_resumption_source(uuid) TO authenticated,service_role;

-- 3) Início atômico da tentativa retomada. Espelha begin_human_decision_resumed_attempt,
--    validando a interrupção de orçamento e o checkpoint em vez do par input_provided.
CREATE FUNCTION public.begin_budget_interruption_resumed_attempt(
  work_item_id uuid, expected_proposal_version integer, interruption_event_seq bigint,
  checkpoint_event_seq bigint, claim_id uuid, attempt_id uuid, owner_instance_id text,
  lease_seconds integer, executor_id text)
RETURNS public.work_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_now timestamptz:=now(); v_item public.work_items;
  v_block public.work_events; v_existing public.work_events; v_cp public.work_events;
  v_claim public.work_claims; v_target text; v_source_attempt uuid; v_cp_seq integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF interruption_event_seq IS NULL OR checkpoint_event_seq IS NULL OR claim_id IS NULL OR attempt_id IS NULL
    OR length(btrim(owner_instance_id))=0 OR length(btrim(executor_id))=0 OR lease_seconds<=0
    THEN RAISE EXCEPTION 'invalid budget resumption request' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_existing FROM public.work_events e WHERE e.work_item_id=v_item.id
    AND e.event_type='execution_started' AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF FOUND THEN
    IF (v_existing.payload->'data'->>'resumed_from_interruption_event_seq')::bigint=interruption_event_seq
      THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'attempt correlation conflict' USING ERRCODE='55000';
  END IF;
  IF v_item.state<>'approved' OR v_item.proposal_version<>expected_proposal_version
    THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;

  SELECT * INTO v_block FROM public.work_events e WHERE e.seq=interruption_event_seq
    AND e.work_item_id=v_item.id AND e.event_type='work_blocked'
    AND e.proposal_version=expected_proposal_version;
  IF NOT FOUND OR NOT private.is_budget_block_reason(v_block.payload->'data'->>'reason')
    OR v_block.payload->'data'->>'attempt_id' IS NULL
    OR (v_block.payload->'data'->>'checkpoint_event_seq')::bigint IS DISTINCT FROM checkpoint_event_seq
    THEN RAISE EXCEPTION 'budget interruption not found' USING ERRCODE='55000'; END IF;
  v_source_attempt:=(v_block.payload->'data'->>'attempt_id')::uuid;
  -- A interrupção não pode já ter sido retomada nem superada por tentativa posterior.
  IF EXISTS(SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id
    AND e.event_type='execution_started' AND e.seq>interruption_event_seq)
    THEN RAISE EXCEPTION 'budget interruption already resumed' USING ERRCODE='55000'; END IF;

  SELECT * INTO v_cp FROM public.work_events e WHERE e.seq=checkpoint_event_seq
    AND e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
    AND e.proposal_version=expected_proposal_version
    AND e.payload->'data'->>'attempt_id'=v_source_attempt::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'valid checkpoint not found' USING ERRCODE='55000'; END IF;
  v_cp_seq:=(v_cp.payload->'data'->>'signal_sequence')::integer;
  IF EXISTS(SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
    AND e.payload->'data'->>'attempt_id'=v_source_attempt::text
    AND (e.payload->'data'->>'signal_sequence')::integer>v_cp_seq)
    THEN RAISE EXCEPTION 'checkpoint is obsolete' USING ERRCODE='55000'; END IF;

  IF EXISTS(SELECT 1 FROM public.work_claims c WHERE c.id=claim_id)
    OR EXISTS(SELECT 1 FROM public.work_events e WHERE e.payload->'data'->>'attempt_id'=attempt_id::text
      AND e.event_type NOT IN ('work_routing_adjusted','work_routing_decided'))
    THEN RAISE EXCEPTION 'resumption identity reused' USING ERRCODE='55000'; END IF;

  v_target:=btrim(v_item.intent#>>'{execution_spec,target,reference}');
  IF v_target IS NULL OR length(v_target)=0 THEN RAISE EXCEPTION 'execution target missing' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_target:'||v_uid::text||':'||v_target,0));
  IF EXISTS(SELECT 1 FROM public.work_claims c WHERE c.user_id=v_uid AND c.released_at IS NULL
    AND c.expires_at>v_now AND (c.work_item_id=v_item.id OR c.target_reference=v_target))
    THEN RAISE EXCEPTION 'work target is held by an active claim' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM public.work_items i WHERE i.user_id=v_uid AND i.id<>v_item.id
    AND i.state='in_progress' AND btrim(i.intent#>>'{execution_spec,target,reference}')=v_target)
    THEN RAISE EXCEPTION 'work target is busy with a running attempt' USING ERRCODE='55000'; END IF;

  -- A guarda enforce_autonomous_work_budget_before_start revalida o orçamento no
  -- INSERT de execution_started abaixo: se a janela esgotou de novo, falha fechado.
  INSERT INTO public.work_claims(id,work_item_id,user_id,approved_proposal_version,owner_instance_id,
    acquired_at,expires_at,attempt_id,target_reference)
  VALUES(claim_id,v_item.id,v_uid,expected_proposal_version,btrim(owner_instance_id),v_now,
    v_now+make_interval(secs=>lease_seconds),attempt_id,v_target) RETURNING * INTO v_claim;
  UPDATE public.work_items SET state='in_progress',updated_at=v_now WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
    (v_item.id,'work_claimed','system',expected_proposal_version,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('claim_id',claim_id,'work_item_id',v_item.id,'approved_proposal_version',expected_proposal_version,
        'owner_instance_id',btrim(owner_instance_id),'acquired_at',v_now,'expires_at',v_claim.expires_at,'target_reference',v_target))),
    (v_item.id,'work_started','anima',expected_proposal_version,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('reason','budget_resumed','attempt_id',attempt_id,'claim_id',claim_id,
        'resumed_from_attempt_id',v_source_attempt,'resumed_from_checkpoint_sequence',v_cp_seq,
        'resumed_from_checkpoint_event_seq',checkpoint_event_seq,'resumed_from_interruption_event_seq',interruption_event_seq))),
    (v_item.id,'execution_started','anima',expected_proposal_version,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('work_item_id',v_item.id,'attempt_id',attempt_id,'approved_proposal_version',expected_proposal_version,
        'origin','anima','executor_id',btrim(executor_id),'claim_id',claim_id,'reason','budget_resumed',
        'resumed_from_attempt_id',v_source_attempt,'resumed_from_checkpoint_sequence',v_cp_seq,
        'resumed_from_checkpoint_event_seq',checkpoint_event_seq,'resumed_from_interruption_event_seq',interruption_event_seq)));
  RETURN v_item;
END; $$;

REVOKE ALL ON FUNCTION public.begin_budget_interruption_resumed_attempt(uuid,integer,bigint,bigint,uuid,uuid,text,integer,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_budget_interruption_resumed_attempt(uuid,integer,bigint,bigint,uuid,uuid,text,integer,text)
  TO authenticated,service_role;

COMMENT ON FUNCTION public.begin_budget_interruption_resumed_attempt(uuid,integer,bigint,bigint,uuid,uuid,text,integer,text) IS
  'INTEL-04: inicia atomicamente a tentativa retomada de uma interrupção de orçamento EM tentativa, a partir do checkpoint correlacionado, com novo claim/attempt (reason=budget_resumed). A retomada conta como nova tentativa e revalida o orçamento na guarda de execution_started (política de tentativas preservada).';
