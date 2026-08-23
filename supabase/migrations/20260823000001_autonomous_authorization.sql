-- ============================================================
-- Auto-aprovação autônoma de uma CLASSE ESTREITA de trabalho local canônico.
--
-- Decisão humana ratificada (autonomia progressiva): o Anima pode aprovar sozinho um
-- work_item `proposed` materializado pelo materializer canônico ratificado, DESDE QUE caiba
-- no envelope estreito avaliado pela policy determinística PURA (host). Esta RPC é a
-- PERSISTÊNCIA HONESTA e idempotente dessa decisão.
--
-- HONESTIDADE DE AUTORIA (invariante crítica): esta RPC grava a aprovação com
-- `author='system'` — NUNCA `author='user'`. Ela NÃO reutiliza `resolve_approval` (que grava
-- `author='user'` e representa decisão HUMANA). Assim uma aprovação humana jamais é forjada,
-- e o log append-only distingue para sempre uma decisão autônoma (system/autonomous_policy)
-- de uma decisão humana (user). A fila `autonomous_work_queue()` e os demais consumidores de
-- `work_approved` são AGNÓSTICOS de autor — logo o item auto-aprovado flui pela mesma
-- maquinaria de execução (Supervisor/worktree/gates/Verifier) sem nenhum caminho novo.
--
-- DEFESA EM PROFUNDIDADE (coarse, no banco; a decisão RICA é do evaluator puro): a RPC só
-- aprova um item `proposed`, do próprio usuário, que carregue proveniência canônica
-- (`canonical_provenance.kind='canonical_backlog'`) com a razão do materializer ratificado
-- (`materializationReason='selected_ready'`). O envelope avaliado pelo host é gravado no
-- payload (auditabilidade). A RPC NÃO afrouxa nenhum teto: desfecho `approved` (execução
-- continua limitada a `review`).
-- ============================================================

CREATE FUNCTION public.auto_approve_autonomous_work(
  work_item_id uuid,
  expected_proposal_version integer,
  envelope jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_item public.work_items;
  v_target_state public.work_state;
  v_existing public.work_events;
  v_seq bigint;
  v_source_id text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id = v_user) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;

  -- O envelope é a DECISÃO do evaluator puro; a RPC a persiste como fato auditável e exige
  -- a autoria autônoma explícita + versão de contrato suportada.
  IF expected_proposal_version IS NULL OR expected_proposal_version <= 0
     OR jsonb_typeof(envelope) IS DISTINCT FROM 'object'
     OR envelope ->> 'authority' IS DISTINCT FROM 'autonomous_policy'
     OR (envelope ->> 'envelope_version') IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'invalid autonomous authorization input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item
  FROM public.work_items i
  WHERE i.id = work_item_id AND i.user_id = v_user
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotência: um item já aprovado por autoria `system` nesta versão de proposta é replay
  -- (não aprova duas vezes, não erra). Serializado pelo FOR UPDATE.
  IF v_item.state = 'approved' THEN
    SELECT * INTO v_existing
    FROM public.work_events e
    WHERE e.work_item_id = v_item.id
      AND e.event_type = 'work_approved'
      AND e.author = 'system'
      AND e.proposal_version = expected_proposal_version
    ORDER BY e.seq DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('action', 'replayed', 'work_item_id', v_item.id,
        'state', v_item.state, 'proposal_version', v_item.proposal_version, 'event_seq', v_existing.seq);
    END IF;
  END IF;

  IF v_item.state <> 'proposed' OR v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE = '55000';
  END IF;

  -- Defesa em profundidade: SÓ trabalho local canônico do materializer RATIFICADO. Sem isto,
  -- a autoridade autônoma não se aplica — cai para a fronteira humana (fail-closed).
  v_source_id := v_item.intent #>> '{canonical_provenance,sourceId}';
  IF v_item.intent #>> '{canonical_provenance,kind}' IS DISTINCT FROM 'canonical_backlog'
     OR v_item.intent #>> '{canonical_provenance,materializationReason}' IS DISTINCT FROM 'selected_ready'
     OR length(btrim(coalesce(v_source_id, ''))) = 0 THEN
    RAISE EXCEPTION 'work item is not ratified canonical work' USING ERRCODE = '42501';
  END IF;

  -- Consistência: o envelope decidiu sobre ESTE item (mesmo sourceId).
  IF envelope ->> 'source_id' IS DISTINCT FROM v_source_id THEN
    RAISE EXCEPTION 'authorization envelope does not match work item' USING ERRCODE = '55000';
  END IF;

  -- Transição pela matriz normativa (proposed --work_approved--> approved). Author-agnóstica.
  SELECT t.to_state INTO v_target_state
  FROM private.work_state_transitions t
  WHERE t.from_state = v_item.state AND t.event_type = 'work_approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.work_items i
  SET state = v_target_state, updated_at = now()
  WHERE i.id = v_item.id
  RETURNING * INTO v_item;

  -- Aprovação HONESTA: author='system', authority=autonomous_policy, envelope auditável.
  INSERT INTO public.work_events (work_item_id, event_type, author, proposal_version, payload)
  VALUES (
    v_item.id, 'work_approved', 'system', v_item.proposal_version,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
      'decision', 'approve',
      'decided_proposal_version', v_item.proposal_version,
      'authority', 'autonomous_policy',
      'authorization', envelope
    ))
  )
  RETURNING seq INTO v_seq;

  RETURN jsonb_build_object('action', 'approved', 'work_item_id', v_item.id,
    'state', v_item.state, 'proposal_version', v_item.proposal_version, 'event_seq', v_seq);
END $$;

REVOKE ALL ON FUNCTION public.auto_approve_autonomous_work(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_approve_autonomous_work(uuid, integer, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.auto_approve_autonomous_work(uuid, integer, jsonb) IS
  'Auto-aprovação autônoma de trabalho local canônico dentro do envelope estreito ratificado. Grava work_approved com author=system/authority=autonomous_policy (NUNCA user), idempotente, apenas para item proposed com proveniência canônica do materializer ratificado. NÃO integra, NÃO faz merge/PR/push/deploy; desfecho approved. A decisão RICA do envelope é do evaluator puro (host) e vem gravada no payload para auditoria.';
