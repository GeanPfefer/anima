-- B1 — PROVIDER_API COST SETTLEMENT: liquidação de reservas `provider_api` por usage × preço versionado.
--
-- CONTEXTO. O coder OpenAI reserva CONSERVADORAMENTE todo o teto humano na 1ª chamada da attempt
-- (lease `provider-api:<attempt>`). Sem settlement, a reserva fica para sempre `cost_unknown` e o
-- `committed` da autoridade carrega o teto inteiro. A 20260910000001 já criou o evento append-only
-- `settled` (amount = excesso liberado R−S) com fontes `estimated` (preço/h × tempo de node) e
-- `provider_confirmed` (fatura do provider). Nenhuma das duas descreve HONESTAMENTE custo derivado de
-- tokens reportados × tabela de preço versionada — e nenhuma carrega a versão de preço usada.
--
-- MODELO. Esta migration é ADITIVA:
--   1. coluna `settlement_provenance jsonb` (nullable) em `paid_compute_budget_events`;
--   2. nova fonte `usage_priced`, válida SÓ em evento `settled` e SEMPRE com proveniência;
--   3. nova RPC `settle_paid_compute_usage_priced_reservation(...)` — mesmas invariantes da
--      `settle_paid_compute_budget_reservation` (S ≥ 0, S ≤ R, void⊕settle, serialização na linha da
--      autorização, replay idempotente) + coerência provider/modelo/attempt da proveniência com a
--      reserva + replay que compara a VERSÃO de preço (versão divergente conflita, nunca re-liquida).
--
-- SEGURANÇA. Ato com identidade humana/residente (role `authenticated`; service_role REVOGADO). NÃO
-- altera nenhuma linha existente; NÃO recompila as funções existentes; NÃO liquida retroativamente
-- nenhuma reserva histórica — apenas habilita o mecanismo para attempts futuras.

-- 1) Proveniência do settlement (nullable: linhas existentes seguem válidas).
ALTER TABLE public.paid_compute_budget_events ADD COLUMN IF NOT EXISTS settlement_provenance jsonb;

-- 2) Fontes do `settled` ganham `usage_priced`; `usage_priced` ⇔ proveniência presente.
ALTER TABLE public.paid_compute_budget_events DROP CONSTRAINT IF EXISTS paid_compute_budget_events_check;
ALTER TABLE public.paid_compute_budget_events ADD CONSTRAINT paid_compute_budget_events_check
  CHECK (
    (event_type='reserved' AND reason IS NULL) OR
    (event_type='voided' AND reason IN ('provider_not_called','provider_rejected_before_create')) OR
    (event_type='settled' AND reason IN ('estimated','provider_confirmed','usage_priced'))
  );
ALTER TABLE public.paid_compute_budget_events DROP CONSTRAINT IF EXISTS paid_compute_budget_events_provenance_check;
ALTER TABLE public.paid_compute_budget_events ADD CONSTRAINT paid_compute_budget_events_provenance_check
  CHECK ((event_type='settled' AND reason IS NOT DISTINCT FROM 'usage_priced') = (settlement_provenance IS NOT NULL));

-- 3) settle por usage × preço versionado.
CREATE FUNCTION public.settle_paid_compute_usage_priced_reservation(
  reservation_id uuid, settled_currency text, settled_amount numeric, provenance jsonb
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
  IF settled_currency IS NULL OR btrim(settled_currency)='' OR settled_amount IS NULL OR settled_amount<0 THEN
    RAISE EXCEPTION 'invalid settlement amount' USING ERRCODE='22023';
  END IF;
  -- Proveniência mínima obrigatória: sem versão de preço identificável não há liquidação.
  IF provenance IS NULL OR jsonb_typeof(provenance)<>'object'
    OR provenance->>'schemaVersion' IS DISTINCT FROM '1' OR provenance->>'method' IS DISTINCT FROM 'usage_priced'
    OR coalesce(btrim(provenance->>'pricingVersion'),'')='' OR coalesce(btrim(provenance->>'pricingSourceRef'),'')=''
    OR coalesce(btrim(provenance->>'catalogRef'),'')='' OR coalesce(btrim(provenance->>'provider'),'')=''
    OR coalesce(btrim(provenance->>'model'),'')='' OR coalesce(btrim(provenance->>'attemptId'),'')=''
    OR upper(coalesce(provenance->>'currency',''))<>v_currency
    OR jsonb_typeof(provenance->'usage')<>'object' THEN
    RAISE EXCEPTION 'invalid usage-priced settlement provenance' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_reserved FROM public.paid_compute_budget_events e
    WHERE e.reservation_id=reservation_id AND e.event_type='reserved' AND e.user_id=v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation not found' USING ERRCODE='P0002'; END IF;
  -- Serializa na linha da autorização (mesma primitive do reserve/void/settle).
  PERFORM 1 FROM public.paid_compute_authorizations a WHERE a.id=v_reserved.authorization_id FOR UPDATE;
  -- Coerência da proveniência com a reserva: mesmo provider, mesmo modelo, mesma attempt.
  IF v_reserved.provider_id<>provenance->>'provider'
    OR v_reserved.resource_class IS DISTINCT FROM ('provider_api:'||(provenance->>'model'))
    OR (v_reserved.attempt_id IS NOT NULL AND v_reserved.attempt_id<>provenance->>'attemptId') THEN
    RAISE EXCEPTION 'settlement provenance does not match reservation' USING ERRCODE='22023';
  END IF;
  IF v_reserved.currency<>v_currency THEN RAISE EXCEPTION 'settlement currency mismatch' USING ERRCODE='22023'; END IF;
  -- INVARIANTE: settlement jamais excede a reserva.
  IF settled_amount>v_reserved.amount THEN RAISE EXCEPTION 'settlement exceeds reservation' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.paid_compute_budget_events e WHERE e.reservation_id=reservation_id AND e.event_type='voided') THEN
    RAISE EXCEPTION 'cannot settle a voided reservation' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.paid_compute_budget_events e
    WHERE e.reservation_id=reservation_id AND e.event_type='settled';
  IF FOUND THEN
    -- Replay idempotente só com MESMO valor, MESMA fonte e MESMA versão de preço.
    IF v_existing.amount<>(v_reserved.amount-settled_amount) OR v_existing.reason IS DISTINCT FROM 'usage_priced'
      OR v_existing.settlement_provenance->>'pricingVersion' IS DISTINCT FROM provenance->>'pricingVersion' THEN
      RAISE EXCEPTION 'reservation already settled with different amount/source/pricing version' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('action','replayed','reservation_id',reservation_id,
      'settled_amount',v_reserved.amount-v_existing.amount,'released',v_existing.amount,'currency',v_existing.currency,
      'cost_source',v_existing.reason,'pricing_version',v_existing.settlement_provenance->>'pricingVersion');
  END IF;
  v_released:=v_reserved.amount-settled_amount;
  INSERT INTO public.paid_compute_budget_events(user_id,authorization_id,reservation_id,idempotency_key,
    event_type,provider_id,node_id,resource_class,work_item_id,attempt_id,lease_id,currency,amount,reason,settlement_provenance)
  VALUES(v_reserved.user_id,v_reserved.authorization_id,v_reserved.reservation_id,v_reserved.idempotency_key,
    'settled',v_reserved.provider_id,v_reserved.node_id,v_reserved.resource_class,v_reserved.work_item_id,
    v_reserved.attempt_id,v_reserved.lease_id,v_currency,v_released,'usage_priced',provenance);
  RETURN jsonb_build_object('action','settled','reservation_id',reservation_id,
    'settled_amount',settled_amount,'released',v_released,'currency',v_currency,
    'cost_source','usage_priced','pricing_version',provenance->>'pricingVersion');
END;
$$;

REVOKE ALL ON FUNCTION public.settle_paid_compute_usage_priced_reservation(uuid,text,numeric,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.settle_paid_compute_usage_priced_reservation(uuid,text,numeric,jsonb) TO authenticated;

COMMENT ON FUNCTION public.settle_paid_compute_usage_priced_reservation(uuid,text,numeric,jsonb) IS
  'B1: liquida uma reserva provider_api por usage reportada × preço versionado (fonte usage_priced + proveniência). Append-only, S≤R, idempotente por versão de preço; nunca retroage sozinha.';
