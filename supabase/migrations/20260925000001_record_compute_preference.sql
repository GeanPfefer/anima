-- ============================================================
-- Preferência de compute por unidade (ato humano, append-only)
-- ============================================================
--
-- Registra, por work item, QUAL estratégia de compute o humano escolheu para a unidade
-- — p.ex. `provider_api` / `openai` / `gpt-5.6-sol`. É DISTINTA da authority paga:
-- registrar uma preferência NÃO concede dinheiro, NÃO cria authority/reserva e NÃO
-- inicia execução. O Compute Router lê a preferência mais recente e a trata como
-- autoritativa para a unidade (sem authority ⇒ espera; nunca fallback silencioso).
--
-- Estratégias:
--   provider_api   → exige provider ('openai') + model; o Router mira esse candidato.
--   router_default → limpa a escolha explícita; a unidade volta ao Router padrão.
--
-- Só antes de executar (proposed/approved), na versão vigente. Idempotente: registrar
-- a mesma preferência que já é a vigente é replay (não anexa evento).

CREATE OR REPLACE FUNCTION public.record_compute_preference(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
  p_preference jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_current public.work_events;
  v_event public.work_events;
  v_strategy text;
  v_normalized jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id)
    THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
  IF p_work_item_id IS NULL OR p_expected_proposal_version IS NULL OR p_expected_proposal_version < 1
    OR jsonb_typeof(p_preference) <> 'object'
    OR p_preference->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  THEN RAISE EXCEPTION 'invalid compute preference' USING ERRCODE='22023'; END IF;

  v_strategy := p_preference->>'strategy';
  IF v_strategy = 'provider_api' THEN
    IF p_preference->>'provider' IS DISTINCT FROM 'openai'
      OR jsonb_typeof(p_preference->'model') <> 'string'
      OR (p_preference->>'model') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'
      OR (SELECT count(*) FROM jsonb_object_keys(p_preference)) <> 4
    THEN RAISE EXCEPTION 'invalid compute preference' USING ERRCODE='22023'; END IF;
    v_normalized := jsonb_build_object('schemaVersion',1,'strategy','provider_api',
      'provider','openai','model',p_preference->>'model');
  ELSIF v_strategy = 'router_default' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_preference)) <> 2
    THEN RAISE EXCEPTION 'invalid compute preference' USING ERRCODE='22023'; END IF;
    v_normalized := jsonb_build_object('schemaVersion',1,'strategy','router_default');
  ELSE
    RAISE EXCEPTION 'invalid compute preference' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i
    WHERE i.id=p_work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state NOT IN ('proposed','approved') OR v_item.proposal_version <> p_expected_proposal_version
  THEN RAISE EXCEPTION 'work item state or version changed' USING ERRCODE='55000'; END IF;

  SELECT * INTO v_current FROM public.work_events e
    WHERE e.work_item_id=p_work_item_id AND e.event_type='compute_preference_recorded'
    ORDER BY e.seq DESC LIMIT 1;
  IF FOUND AND v_current.payload->'data'->'preference' = v_normalized THEN
    RETURN jsonb_build_object('action','replayed','event_id',v_current.id,'event_seq',v_current.seq);
  END IF;
  -- Sem escolha vigente, "voltar ao padrão" não tem o que limpar: replay sem evento.
  IF NOT FOUND AND v_strategy = 'router_default' THEN
    RETURN jsonb_build_object('action','replayed','event_id',NULL,'event_seq',NULL);
  END IF;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(p_work_item_id,'compute_preference_recorded','user',p_expected_proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'work_item_id',p_work_item_id,'proposal_version',p_expected_proposal_version,
      'preference',v_normalized))) RETURNING * INTO v_event;
  RETURN jsonb_build_object('action','recorded','event_id',v_event.id,'event_seq',v_event.seq);
END;
$$;

-- Ato humano: service_role não fabrica preferência (como a concessão de authority paga).
REVOKE ALL ON FUNCTION public.record_compute_preference(uuid,integer,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_compute_preference(uuid,integer,jsonb) TO authenticated;

COMMENT ON FUNCTION public.record_compute_preference(uuid,integer,jsonb) IS
  'Ato humano: registra a preferência de compute da unidade (provider_api/openai/<modelo> ou router_default) como evento append-only compute_preference_recorded. NÃO concede authority paga, NÃO cria reserva e NÃO inicia execução.';
