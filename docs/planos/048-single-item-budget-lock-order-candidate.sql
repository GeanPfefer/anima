-- PROPOSTA OFFLINE. Não aplicada; não é migration aprovada.
-- Baseline: 272 etapas congeladas + candidata item/claim de 20261009.

CREATE OR REPLACE FUNCTION public.start_claimed_work_attempt(
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
  v_discovered_item uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF claim_id IS NULL OR attempt_id IS NULL OR executor_id IS NULL OR length(btrim(executor_id))=0 THEN
    RAISE EXCEPTION 'invalid claimed attempt input' USING ERRCODE='22023';
  END IF;

  -- Descoberta sem lock: serve somente para localizar o item próprio.
  SELECT c.work_item_id INTO v_discovered_item FROM public.work_claims c
  WHERE c.id=claim_id AND c.user_id=v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim not found' USING ERRCODE='P0002'; END IF;

  -- Orçamento existente antes de item/claim/alvo; não decide nem consome aqui.
  PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||v_user_id::text,0));

  -- Ordem localizada: item próprio antes do claim, inclusive no replay.
  PERFORM 1 FROM public.work_items i
  WHERE i.id=v_discovered_item AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim item not found' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_claim FROM public.work_claims c
  WHERE c.id=claim_id AND c.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim not found' USING ERRCODE='P0002'; END IF;

  -- Não seguir um claim redirecionado enquanto esperávamos o item.
  IF v_claim.id IS DISTINCT FROM claim_id
     OR v_claim.user_id IS DISTINCT FROM v_user_id
     OR v_claim.work_item_id IS DISTINCT FROM v_discovered_item THEN
    RAISE EXCEPTION 'claim identity changed while acquiring locks' USING ERRCODE='55000';
  END IF;
  -- Revalidar autoridade após a espera, sem acrescentar locks de allowlist.
  IF auth.uid() IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'authentication changed while acquiring locks' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;

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

CREATE OR REPLACE FUNCTION public.begin_resumed_work_attempt(
  work_item_id uuid, expected_proposal_version integer,
  source_attempt_id uuid, checkpoint_event_seq bigint, abandonment_event_seq bigint,
  claim_id uuid, attempt_id uuid, owner_instance_id text, lease_seconds integer, executor_id text)
RETURNS public.work_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_item public.work_items; v_cp public.work_events; v_ab public.work_events;
  v_existing public.work_events; v_target text; v_now timestamptz:=now(); v_claim public.work_claims;
  v_signal_sequence integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  IF claim_id IS NULL OR attempt_id IS NULL OR source_attempt_id IS NULL
     OR checkpoint_event_seq IS NULL OR abandonment_event_seq IS NULL
     OR length(btrim(owner_instance_id))=0 OR length(btrim(executor_id))=0 OR lease_seconds<=0
    THEN RAISE EXCEPTION 'invalid resumption request' USING ERRCODE='22023'; END IF;

  -- Orçamento existente antes de item/claim/alvo; não decide nem consome aqui.
  PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||v_uid::text,0));

  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  SELECT * INTO v_existing FROM public.work_events e WHERE e.work_item_id=v_item.id
    AND e.event_type='execution_started' AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF FOUND THEN
    IF v_existing.payload->'data'->>'reason'='resumed_execution'
       AND v_existing.payload->'data'->>'resumed_from_attempt_id'=source_attempt_id::text
       AND (v_existing.payload->'data'->>'resumed_from_checkpoint_event_seq')::bigint=checkpoint_event_seq
      THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'attempt correlation conflict' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_claims c WHERE c.id=claim_id)
    THEN RAISE EXCEPTION 'claim identity conflict' USING ERRCODE='55000'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.work_events e
     WHERE e.payload->'data'->>'attempt_id'=attempt_id::text
       AND e.event_type NOT IN ('work_routing_adjusted','work_routing_decided')
  ) THEN RAISE EXCEPTION 'attempt identifier reused' USING ERRCODE='55000'; END IF;
  IF v_item.state<>'approved' OR v_item.proposal_version<>expected_proposal_version
    THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;

  SELECT * INTO v_ab FROM public.work_events e WHERE e.seq=abandonment_event_seq
    AND e.work_item_id=v_item.id AND e.event_type='attempt_abandoned'
    AND e.proposal_version=expected_proposal_version
    AND e.payload->'data'->>'attempt_id'=source_attempt_id::text;
  IF NOT FOUND OR v_ab.payload->'data'->>'reason' NOT IN ('lease_expired','duration_limit_exceeded','declared_bounds_exceeded')
    THEN RAISE EXCEPTION 'abandoned attempt not found' USING ERRCODE='55000'; END IF;

  SELECT * INTO v_cp FROM public.work_events e WHERE e.seq=checkpoint_event_seq
    AND e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
    AND e.seq<v_ab.seq AND e.proposal_version=expected_proposal_version
    AND e.payload->'data'->>'attempt_id'=source_attempt_id::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'valid checkpoint not found' USING ERRCODE='55000'; END IF;
  v_signal_sequence:=(v_cp.payload->'data'->>'signal_sequence')::integer;
  IF EXISTS (SELECT 1 FROM public.work_events newer WHERE newer.work_item_id=v_item.id
    AND newer.event_type='checkpoint_recorded' AND newer.seq<v_ab.seq
    AND newer.proposal_version=expected_proposal_version
    AND newer.payload->'data'->>'attempt_id'=source_attempt_id::text
    AND (newer.payload->'data'->>'signal_sequence')::integer>v_signal_sequence)
    THEN RAISE EXCEPTION 'checkpoint is obsolete' USING ERRCODE='55000'; END IF;

  v_target:=btrim(v_item.intent#>>'{execution_spec,target,reference}');
  IF v_target IS NULL OR length(v_target)=0 THEN RAISE EXCEPTION 'execution target missing' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_target:'||v_uid::text||':'||v_target,0));
  IF EXISTS (SELECT 1 FROM public.work_claims c WHERE c.user_id=v_uid AND c.released_at IS NULL
    AND c.expires_at>v_now AND (c.work_item_id=v_item.id OR c.target_reference=v_target))
    THEN RAISE EXCEPTION 'work target is held by an active claim' USING ERRCODE='55000'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_items i WHERE i.user_id=v_uid AND i.id<>v_item.id
    AND i.state='in_progress' AND btrim(i.intent#>>'{execution_spec,target,reference}')=v_target)
    THEN RAISE EXCEPTION 'work target is busy with a running attempt' USING ERRCODE='55000'; END IF;

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
      jsonb_build_object('reason','resumed_execution','attempt_id',attempt_id,'claim_id',claim_id,
        'resumed_from_attempt_id',source_attempt_id,'resumed_from_checkpoint_sequence',v_signal_sequence,
        'resumed_from_checkpoint_event_seq',checkpoint_event_seq,'abandonment_event_seq',abandonment_event_seq))),
    (v_item.id,'execution_started','anima',expected_proposal_version,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('work_item_id',v_item.id,'attempt_id',attempt_id,'approved_proposal_version',expected_proposal_version,
        'origin','anima','executor_id',btrim(executor_id),'claim_id',claim_id,'reason','resumed_execution',
        'resumed_from_attempt_id',source_attempt_id,'resumed_from_checkpoint_sequence',v_signal_sequence,
        'resumed_from_checkpoint_event_seq',checkpoint_event_seq,'abandonment_event_seq',abandonment_event_seq)));
  RETURN v_item;
END $$;

CREATE OR REPLACE FUNCTION public.begin_human_decision_resumed_attempt(
  work_item_id uuid,expected_proposal_version integer,input_requested_event_id uuid,input_provided_event_id uuid,
  claim_id uuid,attempt_id uuid,owner_instance_id text,lease_seconds integer,executor_id text)
RETURNS public.work_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_now timestamptz:=now(); v_item public.work_items;
  v_request public.work_events; v_answer public.work_events; v_existing public.work_events;
  v_cp public.work_events; v_claim public.work_claims; v_target text; v_source_attempt uuid; v_cp_seq integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  IF input_requested_event_id IS NULL OR input_provided_event_id IS NULL OR claim_id IS NULL OR attempt_id IS NULL
    OR length(btrim(owner_instance_id))=0 OR length(btrim(executor_id))=0 OR lease_seconds<=0
    THEN RAISE EXCEPTION 'invalid decision resumption request' USING ERRCODE='22023'; END IF;
  -- Orçamento existente antes de item/claim/alvo; não decide nem consome aqui.
  PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||v_uid::text,0));

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_existing FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF FOUND THEN
    IF v_existing.payload->'data'->>'resumed_from_input_provided_event_id'=input_provided_event_id::text THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'attempt correlation conflict' USING ERRCODE='55000';
  END IF;
  IF v_item.state<>'approved' OR v_item.proposal_version<>expected_proposal_version
    THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_answer FROM public.work_events e WHERE e.id=input_provided_event_id AND e.work_item_id=v_item.id
    AND e.event_type='input_provided' AND e.proposal_version=expected_proposal_version
    AND e.payload->'data'->>'input_requested_event_id'=input_requested_event_id::text
    AND e.payload->'data'->>'effect'='resume';
  IF NOT FOUND THEN RAISE EXCEPTION 'resume decision not found' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_request FROM public.work_events e WHERE e.id=input_requested_event_id AND e.work_item_id=v_item.id
    AND e.event_type='input_requested' AND e.proposal_version=expected_proposal_version
    AND e.payload->'data'->'handoff' IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'decision checkpoint handoff not found' USING ERRCODE='55000'; END IF;
  v_source_attempt:=(v_request.payload->'data'->>'attempt_id')::uuid;
  SELECT * INTO v_cp FROM public.work_events e WHERE e.seq=(v_request.payload->'data'->>'checkpoint_event_seq')::bigint
    AND e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
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
  PERFORM pg_advisory_xact_lock(hashtextextended('work_target:'||v_uid::text||':'||v_target,0));
  IF EXISTS(SELECT 1 FROM public.work_claims c WHERE c.user_id=v_uid AND c.released_at IS NULL
    AND c.expires_at>v_now AND (c.work_item_id=v_item.id OR c.target_reference=v_target))
    THEN RAISE EXCEPTION 'work target is held by an active claim' USING ERRCODE='55000'; END IF;
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
      jsonb_build_object('reason','human_decision_resumed','attempt_id',attempt_id,'claim_id',claim_id,
        'resumed_from_attempt_id',v_source_attempt,'resumed_from_checkpoint_sequence',v_cp_seq,
        'resumed_from_checkpoint_event_seq',v_cp.seq,'resumed_from_input_requested_event_id',v_request.id,
        'resumed_from_input_provided_event_id',v_answer.id))),
    (v_item.id,'execution_started','anima',expected_proposal_version,jsonb_build_object('schema_version',1,'data',
      jsonb_build_object('work_item_id',v_item.id,'attempt_id',attempt_id,'approved_proposal_version',expected_proposal_version,
        'origin','anima','executor_id',btrim(executor_id),'claim_id',claim_id,'reason','human_decision_resumed',
        'resumed_from_attempt_id',v_source_attempt,'resumed_from_checkpoint_sequence',v_cp_seq,
        'resumed_from_checkpoint_event_seq',v_cp.seq,'resumed_from_input_requested_event_id',v_request.id,
        'resumed_from_input_provided_event_id',v_answer.id)));
  RETURN v_item;
END $$;

CREATE OR REPLACE FUNCTION public.begin_budget_interruption_resumed_attempt(
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

  -- Orçamento existente antes de item/claim/alvo; não decide nem consome aqui.
  PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||v_uid::text,0));

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
