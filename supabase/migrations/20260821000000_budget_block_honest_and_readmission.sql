-- INTEL-04 (coerência V0) — o bloqueio por orçamento é temporal, não uma decisão
-- humana falsa, e volta a ser elegível quando a janela móvel libera.
--
-- Achado (registro 6bef210): `block_work_on_budget` materializava um
-- `input_requested` com `reason='persistent_inability_after_limits'` e a
-- explicação "continuar exige decisão humana", mas sem `options`, `attempt_id`,
-- `checkpoint_reference` nem `executor_signal`. Logo `projectPendingWorkDecision`
-- ignorava o evento e `respond_to_work_decision` não o aceitava: o sistema
-- afirmava exigir decisão humana num checkpoint que a superfície não conseguia
-- responder. Além disso o item ficava `blocked` (fora da fila, `work_blocked_
-- unresolved`) para sempre, mesmo depois de a janela móvel de 24h/60min liberar.
--
-- Os quatro motivos de orçamento (item/usuário por tentativa, tempo global,
-- reserva interativa) são todos limites de JANELA MÓVEL: recuperam-se apenas
-- esperando, nunca por entrada humana. A semântica correta (Opção A, ratificada
-- pela evidência): o bloqueio por orçamento é um estado TEMPORAL não respondível
-- ("aguardando a janela do orçamento"), com uma re-admissão estreita, idempotente
-- e derivada de estado persistido que devolve o item a `approved` quando a janela
-- volta a admitir. Nada afrouxa o teto 6/24h; nenhum override humano é criado.

-- 1) Explicação honesta: o bloqueio não pede decisão humana, apenas aguarda a
--    janela. `reason='persistent_inability_after_limits'` e `budget_reason`
--    permanecem tipados e auditáveis; um marcador `resolution` explícito diz que
--    a única retomada é a recuperação da janela — nunca uma resposta humana.
CREATE OR REPLACE FUNCTION public.block_work_on_budget(p_work_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid();
  v_now timestamptz:=now();
  v_item public.work_items;
  v_decision jsonb;
  v_reason text;
  v_limit text;
  v_checkpoint public.work_events;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||v_uid::text,0));
  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=p_work_item_id AND i.user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  v_decision:=private.autonomous_work_budget_decision(v_uid,v_item.id,v_now);
  v_reason:=v_decision->>'reason';
  IF coalesce((v_decision->>'admitted')::boolean,false) OR v_reason IS NULL THEN
    RETURN jsonb_build_object('blocked',false,'budget',v_decision);
  END IF;
  IF v_item.state='blocked' THEN
    RETURN jsonb_build_object('blocked',true,'reason',v_reason,'replayed',true,'budget',v_decision);
  END IF;
  IF v_item.state<>'approved' THEN
    RAISE EXCEPTION 'work item state changed before budget block' USING ERRCODE='55000';
  END IF;
  v_limit:=CASE
    WHEN v_reason IN ('item_attempt_budget_exhausted','user_attempt_budget_exhausted') THEN 'attempts'
    WHEN v_reason='user_runtime_budget_exhausted' THEN 'duration'
    ELSE 'resources'
  END;
  SELECT * INTO v_checkpoint FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
   ORDER BY e.seq DESC LIMIT 1;

  UPDATE public.work_items SET state='blocked',updated_at=v_now
   WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES
    (v_item.id,'input_requested','anima',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_strip_nulls(jsonb_build_object(
        'reason','persistent_inability_after_limits',
        'budget_reason',v_reason,
        'reached_limit',v_limit,
        -- Marcador tipado: a única retomada é a janela do orçamento liberar,
        -- não uma decisão/resposta humana. Distingue este checkpoint temporal
        -- dos checkpoints de decisão humana de verdade (UX-02).
        'resolution','awaits_budget_window',
        'source_state',jsonb_strip_nulls(jsonb_build_object(
          'work_state','approved',
          'proposal_version',v_item.proposal_version,
          'checkpoint_event_seq',v_checkpoint.seq)),
        'explanation','O orçamento autônomo foi atingido; nenhuma decisão sua é necessária. A execução volta a ficar elegível automaticamente quando a janela móvel do orçamento liberar.')))),
    (v_item.id,'work_blocked','anima',v_item.proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_strip_nulls(jsonb_build_object(
        'work_item_id',v_item.id,
        'approved_proposal_version',v_item.proposal_version,
        'reason',v_reason,
        'reached_limit',v_limit,
        'resolution','awaits_budget_window',
        'checkpoint_event_seq',v_checkpoint.seq,
        'observed_at',v_now))));
  RETURN jsonb_build_object(
    'blocked',true,'reason',v_reason,'reachedLimit',v_limit,
    'checkpointEventSeq',v_checkpoint.seq,'budget',v_decision
  );
END;
$$;

COMMENT ON FUNCTION public.block_work_on_budget(uuid) IS
  'INTEL-04: materializa orçamento negado antes da tentativa como input_requested + work_blocked TEMPORAIS (resolution=awaits_budget_window), sem afirmar decisão humana. Retira o item da fila derivada; a re-admissão ocorre por readmit_budget_blocked_work quando a janela libera.';

-- 2) Re-admissão idempotente de UM item bloqueado por orçamento pré-tentativa.
--    Guarda estreita: só age quando o ÚLTIMO work_blocked do item é um bloqueio
--    de orçamento (razão tipada) SEM `attempt_id` — isto é, exatamente o produzido
--    por block_work_on_budget. Bloqueios de decisão humana (human_input_required)
--    e interrupções em tentativa (interrupt_work_on_budget, que carregam
--    attempt_id e checkpoint) nunca são re-admitidos por aqui. Recalcula a decisão
--    de orçamento no instante observado; só devolve `approved` quando volta a ser
--    admitido. Assume que o lock consultivo por usuário já é mantido pelo chamador.
CREATE FUNCTION private.readmit_budget_blocked_item(
  p_user_id uuid,
  p_work_item_id uuid,
  p_observed_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_item public.work_items;
  v_block public.work_events;
  v_reason text;
  v_attempt text;
  v_decision jsonb;
BEGIN
  SELECT * INTO v_item FROM public.work_items i
   WHERE i.id=p_work_item_id AND i.user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('readmitted',false,'reason','not_found'); END IF;
  IF v_item.state<>'blocked' THEN
    RETURN jsonb_build_object('readmitted',false,'reason','not_blocked');
  END IF;

  SELECT * INTO v_block FROM public.work_events e
   WHERE e.work_item_id=v_item.id AND e.event_type='work_blocked'
   ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('readmitted',false,'reason','not_budget_blocked');
  END IF;
  v_reason:=v_block.payload->'data'->>'reason';
  v_attempt:=v_block.payload->'data'->>'attempt_id';
  IF v_attempt IS NOT NULL OR v_reason NOT IN (
    'item_attempt_budget_exhausted','user_attempt_budget_exhausted',
    'user_runtime_budget_exhausted','interactive_reserve_protected'
  ) THEN
    RETURN jsonb_build_object('readmitted',false,'reason','not_budget_blocked');
  END IF;

  v_decision:=private.autonomous_work_budget_decision(p_user_id,v_item.id,p_observed_at);
  IF NOT coalesce((v_decision->>'admitted')::boolean,false) THEN
    RETURN jsonb_build_object('readmitted',false,'reason','still_exhausted','budget',v_decision);
  END IF;

  UPDATE public.work_items SET state='approved',updated_at=p_observed_at
   WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'work_approved','system',v_item.proposal_version,
    jsonb_build_object('schema_version',1,'data',jsonb_build_object(
      'reason','budget_window_recovered',
      'budget_reason',v_reason,
      'blocked_event_seq',v_block.seq,
      'readmitted_at',p_observed_at)));
  RETURN jsonb_build_object('readmitted',true,'budgetReason',v_reason,'budget',v_decision);
END;
$$;

REVOKE ALL ON FUNCTION private.readmit_budget_blocked_item(uuid,uuid,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.readmit_budget_blocked_item(uuid,uuid,timestamptz)
  TO service_role;

-- 3) Reconciliação de re-admissão por orçamento do usuário chamador. Sem daemon,
--    sem scheduler: é invocada no início de uma volta do Supervisor (como a
--    reconciliação do SUP-04). Serializa por usuário e re-admite exatamente os
--    itens cujo bloqueio de orçamento pré-tentativa voltou a ser admitido pela
--    janela móvel. Idempotente: um item já `approved` não reaparece; um item ainda
--    esgotado permanece `blocked`.
CREATE FUNCTION public.readmit_budget_blocked_work()
RETURNS TABLE (work_item_id uuid, budget_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid:=auth.uid();
  v_now timestamptz:=now();
  v_candidate uuid;
  v_outcome jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_uid) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||v_uid::text,0));
  FOR v_candidate IN
    SELECT i.id FROM public.work_items i
     WHERE i.user_id=v_uid AND i.state='blocked'
     ORDER BY i.updated_at
  LOOP
    v_outcome:=private.readmit_budget_blocked_item(v_uid,v_candidate,v_now);
    IF coalesce((v_outcome->>'readmitted')::boolean,false) THEN
      work_item_id:=v_candidate;
      budget_reason:=v_outcome->>'budgetReason';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.readmit_budget_blocked_work()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.readmit_budget_blocked_work()
  TO authenticated,service_role;

COMMENT ON FUNCTION public.readmit_budget_blocked_work() IS
  'INTEL-04: re-admite (blocked -> approved) os itens do usuário cujo bloqueio de orçamento pré-tentativa voltou a ser admitido pela janela móvel, emitindo work_approved (author=system, reason=budget_window_recovered). Idempotente, derivada de estado persistido, sem override do teto e sem falsificar decisão humana. Invocada por volta do Supervisor; não é scheduler.';
