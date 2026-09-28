-- Restaura a CORRELAÇÃO AUTORITATIVA de reservas provider_api no `reserve_paid_compute_budget`.
--
-- REGRESSÃO PREEXISTENTE (descoberta durante B1, 2026-09-27; não causada por B1).
--   * 20260904000000 introduziu no reserve a correlação provider_api: attempt UUID obrigatório,
--     work item `in_progress` e evento `execution_started` amarrando attempt ↔ work item ↔ versão
--     de proposta aprovada (senão `attempt_correlation_required` / `work_item_not_executing`).
--   * 20260910000001 (settlement) recompilou o reserve a partir do corpo da 20260831000004 —
--     ANTERIOR a 20260903000001 (role robusto) e a 20260904000000 (correlação) — acrescentando só a
--     subtração de `settled`. Com isso perdeu as DUAS evoluções.
--   * 20260910000003 restaurou apenas o role robusto, copiando o corpo da 20260910000001; a
--     correlação continuou ausente. pgTAP `paid_compute_provider_api_correlation` ficou 3/8.
--   * Verificação read-only (2026-09-27): as 28 reservas provider_api reais do banco local — incluindo
--     as feitas após 2026-09-10 — têm `execution_started` correlacionado; o caminho canônico do coder
--     OpenAI satisfaz a regra e nenhuma reserva inconsistente atravessou a janela.
--
-- CORREÇÃO. Migration NOVA e ADITIVA (as históricas não são editadas): recompila o reserve com o
-- corpo VIVO (20260910000003: role robusto + committed = reserved − voided − settled) e reinsere,
-- verbatim, o bloco de correlação da 20260904000000 no mesmo ponto (após a checagem de work item,
-- antes do cálculo de budget). Mesma assinatura; CREATE OR REPLACE preserva GRANTs. Funciona em
-- instalação nova (sequência completa) e em banco existente. NÃO altera dados; NÃO toca settle/void.

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
  -- (Bloco VERBATIM da 20260904000000, restaurado por esta migration.)
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

COMMENT ON FUNCTION public.reserve_paid_compute_budget(uuid,text,text,text,text,uuid,text,text,text,numeric) IS
  'Reserva exposição no ledger de compute pago. Role robusto; committed = reserved − voided − settled; provider_api exige correlação attempt ↔ work item in_progress ↔ execution_started (restaurada em 20260927000001).';
