-- Cloud Resource Matching V1 — AUTORIDADE PAGA POR CAPACIDADE (alternativa aditiva à SKU-fixa).
--
-- CONTEXTO. O contrato PURO já modela `capabilityScope`
-- (`packages/core/src/work-orchestration/paid-compute-authorization.ts` +
-- `cloud-resource-matching.ts`): uma autoridade que NÃO amarra uma GPU específica (ex.: A40),
-- mas autoriza QUALQUER recurso do provider cujas capacidades REAIS (VRAM, features, preço/hora)
-- satisfaçam limites que o humano concede. Faltava a PERSISTÊNCIA: a tabela e a RPC de concessão
-- só conheciam `resource_class` (SKU-fixa). Sem esta coluna, uma autoridade por capacidade seria
-- ILEGÍVEL — o leitor a projetaria como "qualquer recurso do provider" (resource_class nulo +
-- capability_scope invisível), perdendo os limites: risco de segurança. Esta migração fecha a
-- lacuna de forma ADITIVA e RETROCOMPATÍVEL.
--
-- INVARIANTE. SKU-fixa XOR capacidade: `resource_class` e `capability_scope` NUNCA coexistem.
-- Ambas nulas continua válido (= "qualquer recurso do provider", semântica pré-existente de
-- `resource_class` nulo). provider_api (OpenAI/Anthropic) exige `resource_class='provider_api:<modelo>'`
-- e portanto NUNCA carrega `capability_scope` (capacidade de GPU não se aplica a API terceira).
--
-- SEGURANÇA. NÃO concede nenhuma autoridade e NÃO altera nenhuma linha existente. Apenas habilita
-- o humano a conceder uma autoridade por capacidade (ato humano; a RPC exige role `authenticated`;
-- `service_role` continua REVOGADO). Preserva integralmente a fonte robusta do papel JWT
-- (20260903000001), o teto agregado obrigatório (20260831000002) e a correlação provider_api
-- (20260904000000).

ALTER TABLE public.paid_compute_authorizations
  ADD COLUMN capability_scope jsonb;

-- `record_compute_routing_decision` também é chamado antes de existir tentativa. O contrato SQL
-- original já aceitava NULL, mas parâmetros sem DEFAULT são emitidos pelo gerador como `string`.
-- Reordenar o parâmetro opcional para o fim e dar DEFAULT NULL torna esse estado pré-attempt
-- explícito no schema gerado: callers podem omitir `p_attempt_id`, e o payload persistido continua
-- contendo `attempt_id: null`. A assinatura de tipos PostgreSQL é recriada e os privilégios são
-- restabelecidos abaixo.
DROP FUNCTION IF EXISTS public.record_compute_routing_decision(uuid,integer,uuid,uuid,jsonb);

CREATE FUNCTION public.record_compute_routing_decision(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
  p_decision_id uuid,
  p_decision jsonb,
  p_attempt_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_existing public.work_events;
  v_event public.work_events;
  v_status text;
  v_provider text;
  v_authorization text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  IF p_expected_proposal_version IS NULL OR p_expected_proposal_version < 1 OR p_decision_id IS NULL
    OR jsonb_typeof(p_decision) <> 'object'
    OR p_decision->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR p_decision->>'policyVersion' <> 'compute-router-v1'
    OR p_decision->>'workItemId' <> p_work_item_id::text
    OR p_decision->>'approvedProposalVersion' <> p_expected_proposal_version::text
    OR NOT private.jsonb_is_nonblank_string(p_decision->'reasonCode')
    OR NOT private.jsonb_is_nonblank_string(p_decision->'reason')
    OR jsonb_typeof(p_decision->'alternativesConsidered') <> 'array'
    OR jsonb_array_length(p_decision->'alternativesConsidered') <> 2
    OR jsonb_typeof(p_decision->'fallbackChain') <> 'array'
    OR jsonb_typeof(p_decision->'paidAuthorityRequired') <> 'boolean'
    OR jsonb_typeof(p_decision->'economicsBasis') <> 'object'
  THEN RAISE EXCEPTION 'invalid compute routing decision' USING ERRCODE='22023'; END IF;
  v_status := p_decision->>'status';
  v_provider := p_decision->>'selectedProvider';
  v_authorization := p_decision->>'authorizationId';
  IF v_status NOT IN ('selected','waiting_for_human_authorization','blocked')
    OR (v_status='selected' AND (v_provider NOT IN ('ollama','openai') OR p_attempt_id IS NULL))
    OR (v_status<>'selected' AND (v_provider IS NOT NULL OR p_attempt_id IS NOT NULL))
    OR (v_provider='openai' AND (v_authorization IS NULL OR btrim(v_authorization)=''))
    OR (v_provider IS DISTINCT FROM 'openai' AND v_authorization IS NOT NULL)
  THEN RAISE EXCEPTION 'invalid compute routing authority correlation' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_item FROM public.work_items i
    WHERE i.id=p_work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state <> 'approved' OR v_item.proposal_version <> p_expected_proposal_version
    OR p_decision->>'capability' <> v_item.capability::text
  THEN RAISE EXCEPTION 'work item state, version or capability changed' USING ERRCODE='55000'; END IF;

  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.work_item_id=p_work_item_id AND e.event_type='compute_routing_decided'
      AND e.payload->'data'->>'decision_id'=p_decision_id::text LIMIT 1;
  IF FOUND THEN
    IF v_existing.proposal_version=p_expected_proposal_version
      AND v_existing.payload->'data'->'decision'=p_decision
      AND v_existing.payload->'data'->>'attempt_id' IS NOT DISTINCT FROM p_attempt_id::text
    THEN RETURN jsonb_build_object('action','replayed','event_id',v_existing.id,'event_seq',v_existing.seq); END IF;
    RAISE EXCEPTION 'compute routing decision conflict' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(p_work_item_id,'compute_routing_decided','system',p_expected_proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'work_item_id',p_work_item_id,'approved_proposal_version',p_expected_proposal_version,
      'decision_id',p_decision_id,'attempt_id',p_attempt_id,'decision',p_decision))) RETURNING * INTO v_event;
  RETURN jsonb_build_object('action','recorded','event_id',v_event.id,'event_seq',v_event.seq);
END;
$$;

REVOKE ALL ON FUNCTION public.record_compute_routing_decision(uuid,integer,uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_compute_routing_decision(uuid,integer,uuid,jsonb,uuid) TO authenticated,service_role;

-- Exclusividade estrutural: SKU-fixa XOR capacidade. Nunca ambas.
ALTER TABLE public.paid_compute_authorizations
  ADD CONSTRAINT paid_compute_authorizations_scope_exclusive
  CHECK (NOT (resource_class IS NOT NULL AND capability_scope IS NOT NULL));

-- Forma mínima do escopo por capacidade quando presente: objeto com minimumVramGiB numérico > 0,
-- requiredGpuFeatures array e maxNodes inteiro > 0. (maxHourlyPrice é opcional e validado no core.)
-- `?&` (todas as chaves presentes) é obrigatório: sem ele, uma chave AUSENTE torna
-- `jsonb_typeof(scope->'chave')` NULL, o AND vira NULL e o CHECK PASSA (NULL não é FALSE) —
-- aceitaria um escopo malformado. Com a guarda de chaves, ausência ⇒ FALSE ⇒ rejeita.
ALTER TABLE public.paid_compute_authorizations
  ADD CONSTRAINT paid_compute_authorizations_capability_scope_shape
  CHECK (
    capability_scope IS NULL OR (
      jsonb_typeof(capability_scope) = 'object'
      AND (capability_scope ?& array['minimumVramGiB','requiredGpuFeatures','maxNodes'])
      AND jsonb_typeof(capability_scope->'minimumVramGiB') = 'number'
      AND (capability_scope->>'minimumVramGiB')::numeric > 0
      AND jsonb_typeof(capability_scope->'requiredGpuFeatures') = 'array'
      AND jsonb_typeof(capability_scope->'maxNodes') = 'number'
      AND (capability_scope->>'maxNodes')::numeric > 0
      AND (capability_scope->>'maxNodes')::numeric = floor((capability_scope->>'maxNodes')::numeric)
    )
  );

-- RPC evoluída: novo parâmetro OPCIONAL `capability_scope jsonb DEFAULT NULL` (retrocompatível —
-- callers de 9 argumentos continuam válidos; o 10º assume NULL). DROP+CREATE porque a assinatura
-- muda; GRANT/REVOKE são re-emitidos para a nova assinatura.
DROP FUNCTION IF EXISTS public.grant_paid_compute_authorization(text,text,text,uuid,bigint,text,numeric,timestamptz,timestamptz);

CREATE FUNCTION public.grant_paid_compute_authorization(
  provider_id text, node_id text, resource_class text, work_item_id uuid,
  max_duration_ms bigint, max_cost_currency text, max_cost_amount numeric,
  valid_from timestamptz, valid_until timestamptz,
  capability_scope jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user uuid:=auth.uid();
  v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''), nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  v_id uuid;
  v_is_provider_api boolean;
  v_scope jsonb := capability_scope;
BEGIN
  IF v_user IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'human authenticated user required' USING ERRCODE='42501';
  END IF;
  IF provider_id IS NULL OR btrim(provider_id)='' OR max_duration_ms IS NULL OR max_duration_ms<=0
    OR valid_from IS NULL OR valid_until IS NULL OR valid_until<=valid_from
    OR max_cost_currency IS NULL OR btrim(max_cost_currency)='' OR max_cost_amount IS NULL OR max_cost_amount<=0 THEN
    RAISE EXCEPTION 'aggregate paid compute ceiling required' USING ERRCODE='22023';
  END IF;
  -- Exclusividade SKU-fixa XOR capacidade (erro tipado antes do CHECK genérico da tabela).
  IF resource_class IS NOT NULL AND btrim(resource_class)<>'' AND v_scope IS NOT NULL THEN
    RAISE EXCEPTION 'resource_class and capability_scope are mutually exclusive' USING ERRCODE='22023';
  END IF;
  -- Forma mínima do escopo por capacidade. `?&` garante presença das chaves (senão uma chave
  -- ausente tornaria a validação NULL e passaria em branco — mesma armadilha do CHECK da tabela).
  IF v_scope IS NOT NULL AND NOT (
       jsonb_typeof(v_scope) = 'object'
       AND (v_scope ?& array['minimumVramGiB','requiredGpuFeatures','maxNodes'])
       AND jsonb_typeof(v_scope->'minimumVramGiB') = 'number' AND (v_scope->>'minimumVramGiB')::numeric > 0
       AND jsonb_typeof(v_scope->'requiredGpuFeatures') = 'array'
       AND jsonb_typeof(v_scope->'maxNodes') = 'number' AND (v_scope->>'maxNodes')::numeric > 0
       AND (v_scope->>'maxNodes')::numeric = floor((v_scope->>'maxNodes')::numeric)) THEN
    RAISE EXCEPTION 'invalid capability scope' USING ERRCODE='22023';
  END IF;
  -- provider_api (API terceira) exige autoridade ESPECÍFICA (work item + `provider_api:<modelo>`)
  -- e NUNCA carrega escopo por capacidade (capacidade de GPU não se aplica a API terceira).
  v_is_provider_api := (btrim(provider_id)='openai')
    OR (resource_class IS NOT NULL AND starts_with(btrim(resource_class),'provider_api:'));
  IF v_is_provider_api THEN
    IF v_scope IS NOT NULL THEN
      RAISE EXCEPTION 'provider_api authorization cannot carry a capability scope' USING ERRCODE='22023';
    END IF;
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
  INSERT INTO public.paid_compute_authorizations(user_id,provider_id,node_id,resource_class,capability_scope,work_item_id,
    max_duration_ms,max_cost_currency,max_cost_amount,valid_from,valid_until)
  VALUES(v_user,btrim(provider_id),NULLIF(btrim(node_id),''),NULLIF(btrim(resource_class),''),v_scope,work_item_id,
    max_duration_ms,upper(btrim(max_cost_currency)),max_cost_amount,valid_from,valid_until)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('action','granted','authorization_id',v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_paid_compute_authorization(text,text,text,uuid,bigint,text,numeric,timestamptz,timestamptz,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.grant_paid_compute_authorization(text,text,text,uuid,bigint,text,numeric,timestamptz,timestamptz,jsonb) TO authenticated;
