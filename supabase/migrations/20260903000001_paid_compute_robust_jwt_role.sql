-- Fonte robusta do papel JWT nas RPCs de compute pago.
--
-- CAUSA RAIZ (observada ao vivo): as RPCs de compute pago liam o papel do chamador por
-- `current_setting('request.jwt.claim.role', true)` — a GUC PLANA/legada do PostgREST. Este
-- deploy do PostgREST NÃO popula as GUCs planas `request.jwt.claim.*` (ficam NULAS ou VAZIAS);
-- popula apenas o JSON agregado `request.jwt.claims`. Assim, para uma identidade residente
-- legitimamente autenticada (Bearer/GoTrue), `v_role` vinha NULL e o guard `v_role IS DISTINCT
-- FROM 'authenticated'` recusava a chamada com 42501 — mesmo com `auth.uid()` válido (o próprio
-- `auth.uid()` já é robusto: coalesce da sub via claims JSON). Os testes pgTAP mascaravam o
-- defeito porque SETAVAM a GUC plana manualmente; o PostgREST real não seta.
--
-- CORREÇÃO MÍNIMA: `v_role` passa a coalescer a GUC plana tratada como vazia≡ausente
-- (`nullif(...,'')`, compat) com o papel lido do JSON `request.jwt.claims` (a fonte que este
-- PostgREST realmente popula). Nenhum outro comportamento,
-- guard, código de erro, GRANT/REVOKE ou lógica de negócio muda. As assinaturas são idênticas,
-- então `CREATE OR REPLACE` preserva os privilégios já concedidos (EXECUTE só para `authenticated`;
-- REVOGADO de `anon`/`service_role`) — o papel continua imposto pelo GRANT, e o service_role
-- segue sem fabricar autorização. Convenção alinhada às demais RPCs do repo (auth.uid() + GRANT).

CREATE OR REPLACE FUNCTION public.grant_paid_compute_authorization(
  provider_id text, node_id text, resource_class text, work_item_id uuid,
  max_duration_ms bigint, max_cost_currency text, max_cost_amount numeric,
  valid_from timestamptz, valid_until timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user uuid:=auth.uid();
  v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''), nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  v_id uuid;
BEGIN
  IF v_user IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'human authenticated user required' USING ERRCODE='42501';
  END IF;
  IF provider_id IS NULL OR btrim(provider_id)='' OR max_duration_ms IS NULL OR max_duration_ms<=0
    OR valid_from IS NULL OR valid_until IS NULL OR valid_until<=valid_from
    OR max_cost_currency IS NULL OR btrim(max_cost_currency)='' OR max_cost_amount IS NULL OR max_cost_amount<=0 THEN
    RAISE EXCEPTION 'aggregate paid compute ceiling required' USING ERRCODE='22023';
  END IF;
  IF work_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.work_items w WHERE w.id=work_item_id AND w.user_id=v_user) THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002';
  END IF;
  INSERT INTO public.paid_compute_authorizations(user_id,provider_id,node_id,resource_class,work_item_id,
    max_duration_ms,max_cost_currency,max_cost_amount,valid_from,valid_until)
  VALUES(v_user,btrim(provider_id),NULLIF(btrim(node_id),''),NULLIF(btrim(resource_class),''),work_item_id,
    max_duration_ms,upper(btrim(max_cost_currency)),max_cost_amount,valid_from,valid_until)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('action','granted','authorization_id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_paid_compute_authorization(authorization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user uuid:=auth.uid();
  v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''), nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  v_row public.paid_compute_authorizations;
BEGIN
  IF v_user IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'human authenticated user required' USING ERRCODE='42501';
  END IF;
  UPDATE public.paid_compute_authorizations SET revoked_at=COALESCE(revoked_at,now())
  WHERE id=authorization_id AND user_id=v_user RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'authorization not found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('action','revoked','authorization_id',v_row.id,'revoked_at',v_row.revoked_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_paid_compute_budget(
  authorization_id uuid, idempotency_key text, provider_id text, node_id text,
  resource_class text, work_item_id uuid, attempt_id text, lease_id text,
  estimate_currency text, estimate_amount numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE v_user uuid:=auth.uid();
  v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''), nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
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

CREATE OR REPLACE FUNCTION public.void_paid_compute_budget_reservation(reservation_id uuid, reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE v_user uuid:=auth.uid();
  v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''), nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  v_reserved public.paid_compute_budget_events; v_existing public.paid_compute_budget_events;
BEGIN
  IF v_user IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'human-scoped resident identity required' USING ERRCODE='42501'; END IF;
  IF reason NOT IN ('provider_not_called','provider_rejected_before_create') THEN RAISE EXCEPTION 'unsafe reservation void reason' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_reserved FROM public.paid_compute_budget_events e WHERE e.reservation_id=reservation_id AND e.event_type='reserved' AND e.user_id=v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation not found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.paid_compute_authorizations a WHERE a.id=v_reserved.authorization_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.paid_compute_budget_events e WHERE e.reservation_id=reservation_id AND e.event_type='voided';
  IF FOUND THEN
    IF v_existing.reason<>reason THEN RAISE EXCEPTION 'reservation already voided with different reason' USING ERRCODE='55000'; END IF;
    RETURN jsonb_build_object('action','replayed','reservation_id',reservation_id);
  END IF;
  INSERT INTO public.paid_compute_budget_events(user_id,authorization_id,reservation_id,idempotency_key,event_type,
    provider_id,node_id,resource_class,work_item_id,attempt_id,lease_id,currency,amount,reason)
  VALUES(v_reserved.user_id,v_reserved.authorization_id,v_reserved.reservation_id,v_reserved.idempotency_key,'voided',
    v_reserved.provider_id,v_reserved.node_id,v_reserved.resource_class,v_reserved.work_item_id,v_reserved.attempt_id,
    v_reserved.lease_id,v_reserved.currency,v_reserved.amount,reason);
  RETURN jsonb_build_object('action','voided','reservation_id',reservation_id);
END;
$$;
