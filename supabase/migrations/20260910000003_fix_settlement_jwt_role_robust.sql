-- Fix de regressão: a 20260910000001 (settlement) recompilou reserve/void/settle usando a GUC PLANA
-- legada `current_setting('request.jwt.claim.role', true)` — a mesma forma NÃO-ROBUSTA que a
-- 20260903000001 já havia corrigido para as demais funções. Neste deploy do PostgREST as GUCs planas
-- `request.jwt.claim.*` NÃO são populadas (ficam nulas/vazias); só o JSON agregado `request.jwt.claims`
-- é. Assim, a identidade RESIDENTE (GoTrue -> Bearer, role='authenticated' no JSON) via 42501
-- ('human-scoped resident identity required') ao reservar/liquidar — bloqueando a sessão resiliente
-- ANTES de qualquer reserva (nenhum gasto). O pgTAP-como-owner não pega isto porque roda com um papel
-- onde a checagem passa.
--
-- Este deploy RECOMPILA as três funções com corpos IDÊNTICOS aos da 20260910000001, trocando SOMENTE a
-- resolução de `v_role` pela forma ROBUSTA (coalesce da GUC plana com o role lido do JSON
-- `request.jwt.claims`), exatamente como 20260903000001 e 20260910000002. CREATE OR REPLACE preserva os
-- GRANTs existentes. NÃO altera dados, NÃO aplica settlement retroativo, NÃO muda assinatura/semântica.

-- 1) reserve — robust role resolution (resto idêntico à 20260910000001).
CREATE OR REPLACE FUNCTION public.reserve_paid_compute_budget(
  authorization_id uuid, idempotency_key text, provider_id text, node_id text,
  resource_class text, work_item_id uuid, attempt_id text, lease_id text,
  estimate_currency text, estimate_amount numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE v_user uuid:=auth.uid();
  v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  v_auth public.paid_compute_authorizations; v_existing public.paid_compute_budget_events;
  v_reserved numeric; v_voided numeric; v_settled numeric; v_committed numeric; v_reservation uuid;
  v_currency text:=upper(btrim(estimate_currency));
BEGIN
  IF v_user IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'human-scoped resident identity required' USING ERRCODE='42501'; END IF;
  IF idempotency_key IS NULL OR btrim(idempotency_key)='' OR provider_id IS NULL OR btrim(provider_id)=''
    OR node_id IS NULL OR btrim(node_id)='' OR work_item_id IS NULL OR lease_id IS NULL OR btrim(lease_id)=''
    OR estimate_currency IS NULL OR btrim(estimate_currency)='' OR estimate_amount IS NULL OR estimate_amount<=0
    THEN RAISE EXCEPTION 'invalid paid compute reservation' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_auth FROM public.paid_compute_authorizations a WHERE a.id=authorization_id AND a.user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'authorization not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_existing FROM public.paid_compute_budget_events e
    WHERE e.authorization_id=authorization_id AND e.idempotency_key=btrim(idempotency_key) AND e.event_type='reserved';
  IF FOUND THEN
    IF v_existing.provider_id<>btrim(provider_id) OR v_existing.node_id<>btrim(node_id)
      OR v_existing.resource_class IS DISTINCT FROM NULLIF(btrim(resource_class),'') OR v_existing.work_item_id<>work_item_id
      OR v_existing.attempt_id IS DISTINCT FROM NULLIF(btrim(attempt_id),'') OR v_existing.lease_id<>btrim(lease_id)
      OR v_existing.currency<>v_currency OR v_existing.amount<>estimate_amount
      THEN RAISE EXCEPTION 'idempotency key reused with divergent reservation' USING ERRCODE='55000'; END IF;
    IF v_auth.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('action','denied','reason','authorization_revoked'); END IF;
    IF now()<v_auth.valid_from THEN RETURN jsonb_build_object('action','denied','reason','authorization_not_yet_valid'); END IF;
    IF now()>=v_auth.valid_until THEN RETURN jsonb_build_object('action','denied','reason','authorization_expired'); END IF;
    IF EXISTS(SELECT 1 FROM public.paid_compute_budget_events e WHERE e.reservation_id=v_existing.reservation_id AND e.event_type='voided')
      THEN RETURN jsonb_build_object('action','denied','reason','reservation_voided'); END IF;
    RETURN jsonb_build_object('action','replayed','reservation_id',v_existing.reservation_id,'amount',v_existing.amount,'currency',v_existing.currency);
  END IF;
  IF v_auth.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('action','denied','reason','authorization_revoked'); END IF;
  IF now()<v_auth.valid_from THEN RETURN jsonb_build_object('action','denied','reason','authorization_not_yet_valid'); END IF;
  IF now()>=v_auth.valid_until THEN RETURN jsonb_build_object('action','denied','reason','authorization_expired'); END IF;
  IF v_auth.max_cost_currency IS NULL OR v_auth.max_cost_amount IS NULL THEN RETURN jsonb_build_object('action','denied','reason','aggregate_cost_ceiling_required'); END IF;
  IF upper(btrim(v_auth.max_cost_currency))<>v_currency THEN RETURN jsonb_build_object('action','denied','reason','currency_mismatch'); END IF;
  IF v_auth.provider_id<>btrim(provider_id) THEN RETURN jsonb_build_object('action','denied','reason','provider_mismatch'); END IF;
  IF v_auth.node_id IS NOT NULL AND v_auth.node_id<>btrim(node_id) THEN RETURN jsonb_build_object('action','denied','reason','node_mismatch'); END IF;
  IF v_auth.resource_class IS NOT NULL AND v_auth.resource_class IS DISTINCT FROM NULLIF(btrim(resource_class),'') THEN RETURN jsonb_build_object('action','denied','reason','resource_class_mismatch'); END IF;
  IF v_auth.work_item_id IS NOT NULL AND v_auth.work_item_id<>work_item_id THEN RETURN jsonb_build_object('action','denied','reason','work_item_mismatch'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.work_items w WHERE w.id=work_item_id AND w.user_id=v_user) THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  SELECT COALESCE(sum(e.amount),0) INTO v_reserved FROM public.paid_compute_budget_events e WHERE e.authorization_id=authorization_id AND e.event_type='reserved';
  SELECT COALESCE(sum(e.amount),0) INTO v_voided FROM public.paid_compute_budget_events e WHERE e.authorization_id=authorization_id AND e.event_type='voided';
  SELECT COALESCE(sum(e.amount),0) INTO v_settled FROM public.paid_compute_budget_events e WHERE e.authorization_id=authorization_id AND e.event_type='settled';
  v_committed:=v_reserved-v_voided-v_settled;
  IF v_committed+estimate_amount>v_auth.max_cost_amount THEN RETURN jsonb_build_object('action','denied','reason','aggregate_budget_exceeded',
    'ceiling',v_auth.max_cost_amount,'committed',v_committed,'requested',estimate_amount,'remaining',v_auth.max_cost_amount-v_committed,'currency',v_currency); END IF;
  v_reservation:=gen_random_uuid();
  INSERT INTO public.paid_compute_budget_events(user_id,authorization_id,reservation_id,idempotency_key,event_type,provider_id,node_id,
    resource_class,work_item_id,attempt_id,lease_id,currency,amount)
  VALUES(v_user,authorization_id,v_reservation,btrim(idempotency_key),'reserved',btrim(provider_id),btrim(node_id),NULLIF(btrim(resource_class),''),
    work_item_id,NULLIF(btrim(attempt_id),''),btrim(lease_id),v_currency,estimate_amount);
  RETURN jsonb_build_object('action','reserved','reservation_id',v_reservation,'amount',estimate_amount,'currency',v_currency,
    'committed',v_committed+estimate_amount,'remaining',v_auth.max_cost_amount-v_committed-estimate_amount);
END;
$$;

-- 2) void — robust role resolution (resto idêntico à 20260910000001).
CREATE OR REPLACE FUNCTION public.void_paid_compute_budget_reservation(reservation_id uuid, reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  v_user uuid:=auth.uid();
  v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  v_reserved public.paid_compute_budget_events; v_existing public.paid_compute_budget_events;
BEGIN
  IF v_user IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'human-scoped resident identity required' USING ERRCODE='42501';
  END IF;
  IF reason NOT IN ('provider_not_called','provider_rejected_before_create') THEN
    RAISE EXCEPTION 'unsafe reservation void reason' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_reserved FROM public.paid_compute_budget_events e
    WHERE e.reservation_id=reservation_id AND e.event_type='reserved' AND e.user_id=v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation not found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.paid_compute_authorizations a WHERE a.id=v_reserved.authorization_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.paid_compute_budget_events e WHERE e.reservation_id=reservation_id AND e.event_type='settled') THEN
    RAISE EXCEPTION 'cannot void a settled reservation' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.paid_compute_budget_events e
    WHERE e.reservation_id=reservation_id AND e.event_type='voided';
  IF FOUND THEN
    IF v_existing.reason<>reason THEN RAISE EXCEPTION 'reservation already voided with different reason' USING ERRCODE='55000'; END IF;
    RETURN jsonb_build_object('action','replayed','reservation_id',reservation_id);
  END IF;
  INSERT INTO public.paid_compute_budget_events(user_id,authorization_id,reservation_id,idempotency_key,
    event_type,provider_id,node_id,resource_class,work_item_id,attempt_id,lease_id,currency,amount,reason)
  VALUES(v_reserved.user_id,v_reserved.authorization_id,v_reserved.reservation_id,v_reserved.idempotency_key,
    'voided',v_reserved.provider_id,v_reserved.node_id,v_reserved.resource_class,v_reserved.work_item_id,
    v_reserved.attempt_id,v_reserved.lease_id,v_reserved.currency,v_reserved.amount,reason);
  RETURN jsonb_build_object('action','voided','reservation_id',reservation_id);
END;
$$;

-- 3) settle — robust role resolution (resto idêntico à 20260910000001).
CREATE OR REPLACE FUNCTION public.settle_paid_compute_budget_reservation(
  reservation_id uuid, settled_currency text, settled_amount numeric, cost_source text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  v_user uuid:=auth.uid();
  v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  v_reserved public.paid_compute_budget_events; v_existing public.paid_compute_budget_events;
  v_currency text:=upper(btrim(settled_currency)); v_released numeric;
BEGIN
  IF v_user IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'human-scoped resident identity required' USING ERRCODE='42501';
  END IF;
  IF cost_source NOT IN ('estimated','provider_confirmed') THEN
    RAISE EXCEPTION 'invalid settlement cost source' USING ERRCODE='22023';
  END IF;
  IF settled_currency IS NULL OR btrim(settled_currency)='' OR settled_amount IS NULL OR settled_amount<0 THEN
    RAISE EXCEPTION 'invalid settlement amount' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_reserved FROM public.paid_compute_budget_events e
    WHERE e.reservation_id=reservation_id AND e.event_type='reserved' AND e.user_id=v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation not found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.paid_compute_authorizations a WHERE a.id=v_reserved.authorization_id FOR UPDATE;
  IF v_reserved.currency<>v_currency THEN RAISE EXCEPTION 'settlement currency mismatch' USING ERRCODE='22023'; END IF;
  IF settled_amount>v_reserved.amount THEN RAISE EXCEPTION 'settlement exceeds reservation' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.paid_compute_budget_events e WHERE e.reservation_id=reservation_id AND e.event_type='voided') THEN
    RAISE EXCEPTION 'cannot settle a voided reservation' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.paid_compute_budget_events e
    WHERE e.reservation_id=reservation_id AND e.event_type='settled';
  IF FOUND THEN
    IF v_existing.amount<>(v_reserved.amount-settled_amount) OR v_existing.reason<>cost_source THEN
      RAISE EXCEPTION 'reservation already settled with different amount/source' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('action','replayed','reservation_id',reservation_id,
      'settled_amount',v_reserved.amount-v_existing.amount,'released',v_existing.amount,'currency',v_existing.currency,'cost_source',v_existing.reason);
  END IF;
  v_released:=v_reserved.amount-settled_amount;
  INSERT INTO public.paid_compute_budget_events(user_id,authorization_id,reservation_id,idempotency_key,
    event_type,provider_id,node_id,resource_class,work_item_id,attempt_id,lease_id,currency,amount,reason)
  VALUES(v_reserved.user_id,v_reserved.authorization_id,v_reserved.reservation_id,v_reserved.idempotency_key,
    'settled',v_reserved.provider_id,v_reserved.node_id,v_reserved.resource_class,v_reserved.work_item_id,
    v_reserved.attempt_id,v_reserved.lease_id,v_currency,v_released,cost_source);
  RETURN jsonb_build_object('action','settled','reservation_id',reservation_id,
    'settled_amount',settled_amount,'released',v_released,'currency',v_currency,'cost_source',cost_source);
END;
$$;
