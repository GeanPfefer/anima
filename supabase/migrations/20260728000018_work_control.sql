-- UX-01 — controle cooperativo da execução autônoma: pausa e cancelamento.
--
-- ============================================================
-- O que esta migration entrega
-- ============================================================
--
-- Duas fronteiras, deliberadamente separadas como o INTEL-04 já separa "ler o
-- orçamento" de "interromper por orçamento":
--
--   * `request_work_control` — o usuário PEDE pausa ou cancelamento pelo cartão
--     da conversa. É só a persistência de uma intenção auditável
--     (`work_control_requested`); NÃO muda estado, NÃO libera posse e NÃO mata
--     execução. Correlaciona item + versão aprovada + tentativa autônoma.
--
--   * `apply_work_control_at_checkpoint` — o laço do Supervisor APLICA o pedido
--     pendente ao chegar a um checkpoint seguro, exatamente como
--     `interrupt_work_on_budget` faz depois de um checkpoint persistido. Só aqui
--     o item vira `blocked` (pausa) ou `cancelled` (cancelamento), o evento
--     terminal (`work_paused`/`work_cancelled`) é gravado e o claim é liberado.
--
-- Essa separação é o que torna a pausa/cancelamento COOPERATIVA: nada é morto no
-- meio de uma edição. A aplicação exige um checkpoint da tentativa e reaproveita
-- a mesma liberação de posse (`attempt_finished`) do INTEL-04. Um sinal terminal
-- tardio do executor, depois da aplicação, já é recusado pela guarda de estado
-- de `record_commanded_work_terminal` (item não está mais `in_progress`) — nenhum
-- contrato ratificado é tocado.
--
-- ============================================================
-- Escopo: apenas tentativa AUTÔNOMA
-- ============================================================
--
-- O controle exige um `execution_started` com `claim_id` para a tentativa: só a
-- execução supervisionada é pausável/cancelável de forma cooperativa. A execução
-- comandada do INT-04 é single-shot, sem posse, e permanece fora deste contrato.

-- A única linha nova da matriz normativa. O cancelamento a partir de
-- `in_progress` (`work_cancelled` → `cancelled`) já existe desde a fundação; a
-- pausa reaproveita o estado `blocked`, soberano de decisão humana (AUTO-05).
INSERT INTO private.work_state_transitions(from_state,event_type,to_state)
VALUES('in_progress','work_paused','blocked');

-- ============================================================
-- Pedido de controle (usuário → intenção persistida)
-- ============================================================

CREATE FUNCTION public.request_work_control(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
  p_attempt_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid();
  v_item public.work_items;
  v_pending public.work_events;
  v_seq bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF p_attempt_id IS NULL OR p_expected_proposal_version IS NULL
    OR p_expected_proposal_version<1 OR p_action NOT IN ('pause','cancel') THEN
    RAISE EXCEPTION 'invalid work control request' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=p_work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state<>'in_progress' OR v_item.proposal_version<>p_expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;

  -- A tentativa é autônoma (posse ativa registrada no início) e da versão exata.
  IF NOT EXISTS(SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
      AND e.proposal_version=p_expected_proposal_version
      AND e.payload->'data'->>'attempt_id'=p_attempt_id::text
      AND e.payload->'data'->>'claim_id' IS NOT NULL) THEN
    RAISE EXCEPTION 'autonomous attempt not found' USING ERRCODE='P0002';
  END IF;

  -- Tentativa já encerrada (por qualquer desfecho) não aceita novo controle.
  IF EXISTS(SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id
      AND e.event_type IN ('result_submitted','execution_failed','work_cancelled','attempt_abandoned','work_paused')
      AND e.payload->'data'->>'attempt_id'=p_attempt_id::text) THEN
    RAISE EXCEPTION 'attempt already finished' USING ERRCODE='55000';
  END IF;

  -- Pedido pendente = `work_control_requested` da tentativa ainda não consumido
  -- por um `work_paused`/`work_cancelled` de controle. Mesmo pedido é replay
  -- idempotente; pedido divergente (ex.: pausa pendente e agora cancelamento)
  -- falha fechado, sem sobrescrever a intenção anterior.
  SELECT * INTO v_pending FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.event_type='work_control_requested'
     AND e.payload->'data'->>'attempt_id'=p_attempt_id::text
     AND NOT EXISTS(SELECT 1 FROM public.work_events applied
       WHERE applied.work_item_id=v_item.id
         AND applied.event_type IN ('work_paused','work_cancelled')
         AND (applied.payload->'data'->>'control_request_event_seq')::bigint=e.seq)
   ORDER BY e.seq DESC LIMIT 1;
  IF FOUND THEN
    IF v_pending.payload->'data'->>'action'=p_action THEN
      RETURN jsonb_build_object('action','replayed','requestEventSeq',v_pending.seq);
    END IF;
    RAISE EXCEPTION 'another work control request is pending' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'work_control_requested','user',v_item.proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'work_item_id',v_item.id,'attempt_id',p_attempt_id,
      'approved_proposal_version',v_item.proposal_version,
      'action',p_action,'requested_at',now())))
  RETURNING seq INTO v_seq;
  RETURN jsonb_build_object('action','recorded','requestEventSeq',v_seq);
END $$;

-- ============================================================
-- Aplicação cooperativa (laço → efeito real, só em checkpoint)
-- ============================================================

CREATE FUNCTION public.apply_work_control_at_checkpoint(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid(); v_now timestamptz:=now();
  v_item public.work_items; v_request public.work_events;
  v_checkpoint public.work_events; v_claim public.work_claims;
  v_action text; v_event public.work_event_type;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF p_attempt_id IS NULL OR p_expected_proposal_version IS NULL OR p_expected_proposal_version<1 THEN
    RAISE EXCEPTION 'invalid work control application' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=p_work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state<>'in_progress' OR v_item.proposal_version<>p_expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;

  -- Nada pendente: no-op idempotente. O laço chama após cada checkpoint, então
  -- a ausência de pedido é o caso comum e não é erro.
  SELECT * INTO v_request FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.event_type='work_control_requested'
     AND e.payload->'data'->>'attempt_id'=p_attempt_id::text
     AND NOT EXISTS(SELECT 1 FROM public.work_events applied
       WHERE applied.work_item_id=v_item.id
         AND applied.event_type IN ('work_paused','work_cancelled')
         AND (applied.payload->'data'->>'control_request_event_seq')::bigint=e.seq)
   ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('applied',false); END IF;

  -- Aplicar apenas em checkpoint seguro: exige um `checkpoint_recorded` da
  -- tentativa. Sem ele, pausar/cancelar reconstruiria estado por suposição.
  SELECT * INTO v_checkpoint FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
     AND e.payload->'data'->>'attempt_id'=p_attempt_id::text
   ORDER BY (e.payload->'data'->>'signal_sequence')::integer DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkpoint required before work control' USING ERRCODE='55000'; END IF;

  v_action:=v_request.payload->'data'->>'action';
  v_event:=CASE WHEN v_action='pause' THEN 'work_paused'::public.work_event_type
    ELSE 'work_cancelled'::public.work_event_type END;

  UPDATE public.work_items
     SET state=CASE WHEN v_action='pause' THEN 'blocked'::public.work_state
                    ELSE 'cancelled'::public.work_state END,
         updated_at=v_now
   WHERE id=v_item.id RETURNING * INTO v_item;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,v_event,'user',v_item.proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'work_item_id',v_item.id,'attempt_id',p_attempt_id,
      'approved_proposal_version',v_item.proposal_version,
      'reason',CASE WHEN v_action='pause' THEN 'paused_by_user' ELSE 'cancelled_by_user' END,
      'control_request_event_seq',v_request.seq,
      'checkpoint_event_seq',v_checkpoint.seq,'applied_at',v_now)));

  -- Liberação auditável da posse desta tentativa, com a mesma razão
  -- `attempt_finished` que o INTEL-04 usa: a tentativa deixou de ocupar o item.
  SELECT * INTO v_claim FROM public.work_claims c
   WHERE c.user_id=v_uid AND c.work_item_id=v_item.id
     AND c.attempt_id=p_attempt_id AND c.released_at IS NULL FOR UPDATE;
  IF FOUND THEN
    UPDATE public.work_claims SET released_at=v_now,release_reason='attempt_finished'
     WHERE id=v_claim.id RETURNING * INTO v_claim;
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
    VALUES(v_item.id,'work_claim_released','system',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_build_object(
        'claim_id',v_claim.id,'work_item_id',v_item.id,
        'approved_proposal_version',v_item.proposal_version,
        'owner_instance_id',v_claim.owner_instance_id,'attempt_id',p_attempt_id,
        'reason','attempt_finished','released_at',v_now)));
  END IF;

  RETURN jsonb_build_object(
    'applied',true,'action',v_action,'eventType',v_event,
    'controlRequestEventSeq',v_request.seq,'checkpointEventSeq',v_checkpoint.seq,
    'claimReleased',v_claim.id IS NOT NULL
  );
END $$;

REVOKE ALL ON FUNCTION public.request_work_control(uuid,integer,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.apply_work_control_at_checkpoint(uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_work_control(uuid,integer,uuid,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.apply_work_control_at_checkpoint(uuid,integer,uuid) TO authenticated,service_role;

COMMENT ON FUNCTION public.request_work_control(uuid,integer,uuid,text) IS
  'UX-01: persiste a intenção do usuário de pausar/cancelar uma tentativa autônoma (work_control_requested), correlacionada a item + versão aprovada + tentativa. NÃO muda estado, não libera posse e não mata execução. Idempotente por ação; ação divergente pendente falha fechado (55000). Tentativa comandada (INT-04, sem claim) e tentativa já encerrada são recusadas.';
COMMENT ON FUNCTION public.apply_work_control_at_checkpoint(uuid,integer,uuid) IS
  'UX-01: aplica cooperativamente o pedido de controle pendente ao chegar a um checkpoint seguro, como interrupt_work_on_budget. Exige item in_progress do usuário, versão aprovada e checkpoint da tentativa; move para blocked (pausa) ou cancelled (cancelamento), grava work_paused/work_cancelled e libera o claim com attempt_finished. Sem pedido pendente, é no-op (applied:false). Nunca aceita, autoriza nem integra resultado.';
