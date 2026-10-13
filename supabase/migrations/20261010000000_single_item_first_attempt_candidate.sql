-- Candidato mínimo para primeira attempt Single-Item; não promover automaticamente.
-- B→I→C no início novo; I→C na liberação; replay sem admissão de orçamento.
-- Sem alterações de acquire, retomadas, políticas ou privilégios.
-- Piso temporal do item relido sob lock: preserva created_at e updated_at.




CREATE OR REPLACE FUNCTION public.release_work_claim(
  claim_id uuid,
  reason text
)
RETURNS public.work_claims
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_claim public.work_claims;
  v_discovered_item uuid;
  v_now timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF claim_id IS NULL OR reason IS NULL OR reason NOT IN ('attempt_finished','released_without_attempt','expired') THEN
    RAISE EXCEPTION 'invalid claim release' USING ERRCODE='22023';
  END IF;

  -- Descoberta sem lock: serve somente para localizar o item próprio.
  SELECT c.work_item_id INTO v_discovered_item FROM public.work_claims c
  WHERE c.id=claim_id AND c.user_id=v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim not found' USING ERRCODE='P0002'; END IF;

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

  IF v_claim.released_at IS NOT NULL THEN
    IF v_claim.release_reason = reason THEN RETURN v_claim; END IF;
    RAISE EXCEPTION 'claim already released with a different reason' USING ERRCODE='55000';
  END IF;
  IF reason='attempt_finished' AND v_claim.attempt_id IS NULL THEN
    RAISE EXCEPTION 'no attempt was started under this claim' USING ERRCODE='22023';
  END IF;
  IF reason='released_without_attempt' AND v_claim.attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'an attempt was started under this claim' USING ERRCODE='22023';
  END IF;

  UPDATE public.work_claims SET released_at=v_now, release_reason=reason
  WHERE id=v_claim.id RETURNING * INTO v_claim;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
    (v_claim.work_item_id,'work_claim_released','system',v_claim.approved_proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_build_object(
        'claim_id',v_claim.id,'work_item_id',v_claim.work_item_id,
        'approved_proposal_version',v_claim.approved_proposal_version,
        'owner_instance_id',v_claim.owner_instance_id,'attempt_id',v_claim.attempt_id,
        'reason',reason,'released_at',v_now)));

  RETURN v_claim;
END;
$$;


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
  v_preview public.work_claims;
  v_item public.work_items;
  v_started public.work_events;
  v_replay_observed boolean;
  v_target text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF claim_id IS NULL OR attempt_id IS NULL OR executor_id IS NULL OR length(btrim(executor_id))=0 THEN
    RAISE EXCEPTION 'invalid claimed attempt input' USING ERRCODE='22023';
  END IF;

  -- Descoberta sem lock: serve somente para localizar o item próprio.
  SELECT * INTO v_preview FROM public.work_claims c
  WHERE c.id=claim_id AND c.user_id=v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim not found' USING ERRCODE='P0002'; END IF;
  v_discovered_item:=v_preview.work_item_id;

  PERFORM 1 FROM public.work_items i
  WHERE i.id=v_discovered_item AND i.user_id=v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim item not found' USING ERRCODE='P0002'; END IF;

  -- Recusas sem admissão: não tomar orçamento para claim já incompatível.
  IF v_preview.attempt_id IS NOT NULL THEN
    IF v_preview.attempt_id <> attempt_id THEN
      RAISE EXCEPTION 'claim already started another attempt' USING ERRCODE='55000';
    END IF;
  ELSE
    IF v_preview.released_at IS NOT NULL THEN
      RAISE EXCEPTION 'claim already released' USING ERRCODE='55000';
    END IF;
    IF now() >= v_preview.expires_at THEN
      RAISE EXCEPTION 'claim expired' USING ERRCODE='55000';
    END IF;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_discovered_item AND e.event_type='execution_started'
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) INTO v_replay_observed;
  -- Somente possível admissão entra em B antes de I/C/T. Replay não espera B.
  IF NOT v_replay_observed THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||v_user_id::text,0));
  END IF;

  -- Ordem localizada: item próprio antes do claim, inclusive no replay.
  SELECT * INTO v_item FROM public.work_items i
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

  -- Reler após I/C. Um replay desaparecido nunca vira admissão com B tardio.
  SELECT * INTO v_started FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text
  ORDER BY e.seq DESC LIMIT 1;
  IF v_replay_observed AND NOT FOUND THEN
    RAISE EXCEPTION 'attempt correlation changed while acquiring locks' USING ERRCODE='55000';
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

  -- Mesma regra de replay de private.begin_work_attempt; sem T/B nem novo evento.
  IF v_started.id IS NOT NULL THEN
    IF v_started.proposal_version = v_claim.approved_proposal_version
       AND v_started.payload->'data'->>'executor_id' = btrim(executor_id)
       AND v_started.payload->'data'->>'work_item_id' = v_item.id::text THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'attempt correlation conflict' USING ERRCODE='55000';
  END IF;

  IF v_item.state <> 'approved' OR v_item.proposal_version <> v_claim.approved_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;
  IF jsonb_typeof(v_item.intent->'execution_spec') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'execution specification missing' USING ERRCODE='22023';
  END IF;


  v_target := btrim(v_item.intent #>> '{execution_spec,target,reference}');
  IF v_target IS NULL OR length(v_target) = 0
     OR jsonb_typeof(v_item.intent #> '{execution_spec,target,reference}') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'execution target missing' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('work_target:'||v_user_id::text||':'||v_target, 0));

  -- T já adquirido: revalidar autoridade após essa espera antes de delegar.
  IF auth.uid() IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'authentication changed while acquiring locks' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;

  v_item:=private.begin_work_attempt(
    v_user_id, v_claim.work_item_id, v_claim.approved_proposal_version,
    attempt_id, executor_id, 'supervised_execution', v_claim.id);
  -- Inclui esperas implícitas do INSERT/UPDATE: revogação aborta tudo.
  IF auth.uid() IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'authentication changed while acquiring locks' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  RETURN v_item;
END;
$$;


CREATE OR REPLACE FUNCTION private.begin_work_attempt(
  p_user_id                   uuid,
  p_work_item_id              uuid,
  p_expected_proposal_version integer,
  p_attempt_id                uuid,
  p_executor_id               text,
  p_reason                    text,
  p_claim_id                  uuid
)
RETURNS public.work_items
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_item public.work_items;
  v_started public.work_events;
  v_target text;
  v_claim jsonb := CASE WHEN p_claim_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('claim_id', p_claim_id) END;
BEGIN
  SELECT * INTO v_item FROM public.work_items i
  WHERE i.id = p_work_item_id AND i.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  -- Replay ANTES de qualquer verificação de ocupação: reentregar a MESMA
  -- tentativa é devolver o resultado já produzido, não ocupar o alvo de novo.
  -- A tentativa em curso é, ela própria, a ocupante — reavaliar aqui faria a
  -- execução recusar a si mesma.
  SELECT * INTO v_started FROM public.work_events e
  WHERE e.work_item_id = v_item.id AND e.event_type = 'execution_started'
    AND e.payload->'data'->>'attempt_id' = p_attempt_id::text
  ORDER BY e.seq DESC LIMIT 1;
  IF FOUND THEN
    IF v_started.proposal_version = p_expected_proposal_version
       AND v_started.payload->'data'->>'executor_id' = btrim(p_executor_id)
       AND v_started.payload->'data'->>'work_item_id' = v_item.id::text THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'attempt correlation conflict' USING ERRCODE='55000';
  END IF;

  IF v_item.state <> 'approved' OR v_item.proposal_version <> p_expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;
  IF jsonb_typeof(v_item.intent->'execution_spec') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'execution specification missing' USING ERRCODE='22023';
  END IF;

  -- ---------- SUP-05: ocupação do alvo, idêntica nos dois caminhos ----------

  -- Alvo derivado no servidor, com a mesma régua fechada de `acquire_work_claim`.
  -- Alvo inderivável falha fechado: sem alvo não há como garantir exclusividade,
  -- e iniciar assim seria executar exatamente onde a garantia não alcança.
  v_target := btrim(v_item.intent #>> '{execution_spec,target,reference}');
  IF v_target IS NULL OR length(v_target) = 0
     OR jsonb_typeof(v_item.intent #> '{execution_spec,target,reference}') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'execution target missing' USING ERRCODE='22023';
  END IF;

  -- Lock consultivo do alvo: serializa o início comandado contra a aquisição
  -- autônoma e contra outro início no mesmo alvo. Sem ele a verificação abaixo
  -- seria só uma leitura otimista, com janela entre consultar e gravar.
  PERFORM pg_advisory_xact_lock(hashtextextended('work_target:'||p_user_id::text||':'||v_target, 0));

  -- Execução em curso de OUTRO item no mesmo alvo, com ou sem claim.
  IF EXISTS (
    SELECT 1 FROM public.work_items other
    WHERE other.user_id = p_user_id AND other.id <> v_item.id AND other.state = 'in_progress'
      AND btrim(other.intent #>> '{execution_spec,target,reference}') = v_target
  ) THEN
    RAISE EXCEPTION 'work target is busy with a running attempt' USING ERRCODE='55000';
  END IF;

  -- Claim ATIVO sobre o mesmo alvo. Duas exclusões são indispensáveis:
  --   * o claim desta própria tentativa (p_claim_id) não bloqueia a si mesmo —
  --     o caminho supervisionado chega aqui justamente segurando-o;
  --   * claim expirado ou liberado não ocupa nada, e NÃO é liberado aqui: o
  --     caminho comandado não rouba nem encerra posse alheia. Quem recolhe o
  --     claim vencido de forma auditável continua sendo `acquire_work_claim`.
  IF EXISTS (
    SELECT 1 FROM public.work_claims c
    WHERE c.user_id = p_user_id AND c.target_reference = v_target
      AND c.released_at IS NULL AND c.expires_at > now()
      AND (p_claim_id IS NULL OR c.id <> p_claim_id)
  ) THEN
    RAISE EXCEPTION 'work target is held by an active claim' USING ERRCODE='55000';
  END IF;

  -- ---------- fim SUP-05 ----------

  UPDATE public.work_items SET state='in_progress', updated_at=GREATEST(v_item.created_at,v_item.updated_at,clock_timestamp()) WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
    (v_item.id,'work_started','user',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',
        jsonb_build_object('reason',p_reason,'attempt_id',p_attempt_id) || v_claim)),
    (v_item.id,'execution_started','anima',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',
        jsonb_build_object(
          'work_item_id',v_item.id,'attempt_id',p_attempt_id,'approved_proposal_version',v_item.proposal_version,
          'origin','anima','executor_id',btrim(p_executor_id)) || v_claim));
  RETURN v_item;
END;
$$;
