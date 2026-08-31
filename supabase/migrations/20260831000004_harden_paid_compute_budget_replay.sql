-- Replays recuperam resultado ambíguo, mas não podem iniciar efeito NOVO depois de revogação,
-- expiração ou void comprovado. Recompila a função aplicada em instalações existentes.
CREATE OR REPLACE FUNCTION public.reserve_paid_compute_budget(
  authorization_id uuid, idempotency_key text, provider_id text, node_id text,
  resource_class text, work_item_id uuid, attempt_id text, lease_id text,
  estimate_currency text, estimate_amount numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE v_user uuid:=auth.uid(); v_role text:=current_setting('request.jwt.claim.role',true);
  v_auth public.paid_compute_authorizations; v_existing public.paid_compute_budget_events;
  v_reserved numeric; v_voided numeric; v_committed numeric; v_reservation uuid;
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
  v_committed:=v_reserved-v_voided;
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
