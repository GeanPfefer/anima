-- Correlação autoritativa e proibição de wildcard perigoso para compute pago via provider_api.
--
-- MOTIVAÇÃO (auditoria da governança OpenAI global): o ledger genérico já protege os nodes
-- pagos, mas para `provider_api` (ex.: OpenAI) faltavam duas defesas em profundidade:
--   1) GRANT aceitava autoridade AMPLA (work_item_id NULL ou resource_class NULL), o que
--      permitiria atravessar arbitrariamente work items/modelos com uma única autorização.
--   2) RESERVE aceitava `attempt_id` como TEXTO LIVRE, sem validar existência, pertencimento
--      ao work item, versão de proposta aprovada ou estado de ciclo de vida — confiando só no
--      caller.
--
-- Esta migration endurece AMBAS as RPCs por `CREATE OR REPLACE` com as MESMAS assinaturas
-- (privilégios preservados; tipos gerados intactos), mantendo integralmente a correção da
-- fonte do papel JWT (20260903000001) e a lógica agregada/replay (20260831000001..4). As
-- mudanças são ADITIVAS e escopadas a provider_api: nodes pagos (resource_class != provider_api:*)
-- seguem inalterados. `provider_api` é detectado pelo prefixo canônico `provider_api:<modelo>`
-- do resource_class e, como reforço, pelo provider `openai` (único provider de API hoje).

-- ── GRANT: proíbe wildcard para provider_api ────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_paid_compute_authorization(
  provider_id text, node_id text, resource_class text, work_item_id uuid,
  max_duration_ms bigint, max_cost_currency text, max_cost_amount numeric,
  valid_from timestamptz, valid_until timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user uuid:=auth.uid();
  v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''), nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  v_id uuid;
  v_is_provider_api boolean;
BEGIN
  IF v_user IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'human authenticated user required' USING ERRCODE='42501';
  END IF;
  IF provider_id IS NULL OR btrim(provider_id)='' OR max_duration_ms IS NULL OR max_duration_ms<=0
    OR valid_from IS NULL OR valid_until IS NULL OR valid_until<=valid_from
    OR max_cost_currency IS NULL OR btrim(max_cost_currency)='' OR max_cost_amount IS NULL OR max_cost_amount<=0 THEN
    RAISE EXCEPTION 'aggregate paid compute ceiling required' USING ERRCODE='22023';
  END IF;
  -- provider_api exige autoridade ESPECÍFICA ao envelope: work item concreto e um modelo
  -- concreto (`provider_api:<modelo>`, não vazio). Sem isso a autorização seria um wildcard
  -- que atravessaria itens/modelos — proibido.
  v_is_provider_api := (btrim(provider_id)='openai')
    OR (resource_class IS NOT NULL AND starts_with(btrim(resource_class),'provider_api:'));
  IF v_is_provider_api THEN
    IF work_item_id IS NULL THEN
      RAISE EXCEPTION 'provider_api authorization requires a work item' USING ERRCODE='22023';
    END IF;
    IF resource_class IS NULL OR NOT starts_with(btrim(resource_class),'provider_api:')
       OR length(btrim(resource_class)) <= length('provider_api:') THEN
      RAISE EXCEPTION 'provider_api authorization requires a specific resource class' USING ERRCODE='22023';
    END IF;
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

-- ── RESERVE: correlação autoritativa attempt ↔ work item ↔ proposal version ──
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
  v_item public.work_items; v_attempt_uuid uuid;
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

  -- Correlação AUTORITATIVA para provider_api (não confiar só no caller). O attempt precisa
  -- ser um UUID real; o item precisa estar EM EXECUÇÃO; e um evento execution_started deve
  -- amarrar attempt ↔ work item ↔ versão de proposta aprovada. Vale para o consumo pago do
  -- coder OpenAI, cuja reserva ocorre na 1ª chamada durante um attempt já iniciado.
  IF starts_with(btrim(coalesce(resource_class,'')),'provider_api:') OR btrim(provider_id)='openai' THEN
    IF attempt_id IS NULL OR btrim(attempt_id)='' THEN
      RAISE EXCEPTION 'provider_api reservation requires an attempt' USING ERRCODE='22023';
    END IF;
    BEGIN
      v_attempt_uuid := btrim(attempt_id)::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'provider_api reservation requires a uuid attempt' USING ERRCODE='22023';
    END;
    SELECT * INTO v_item FROM public.work_items w WHERE w.id=work_item_id AND w.user_id=v_user;
    IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
    IF v_item.state <> 'in_progress' THEN
      RETURN jsonb_build_object('action','denied','reason','work_item_not_executing');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.work_events we
      WHERE we.work_item_id = work_item_id
        AND we.event_type = 'execution_started'
        AND we.proposal_version = v_item.proposal_version
        AND (we.payload->'data'->>'attempt_id') = v_attempt_uuid::text
    ) THEN
      RETURN jsonb_build_object('action','denied','reason','attempt_correlation_required');
    END IF;
  END IF;

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
