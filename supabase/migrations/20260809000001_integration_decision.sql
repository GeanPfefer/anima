-- Camada de aplicação/integração (ADR-002): persistência da SEGUNDA aprovação humana.
--
-- ============================================================
-- O que esta migration entrega
-- ============================================================
--
-- `decide_integration` registra, como evento append-only `integration_decided`, a
-- decisão humana de AUTORIZAR ou RECUSAR a integração de um resultado JÁ ACEITO.
-- É o passo persistido que faltava para tornar vivo o `IntegrationBoundary`
-- ratificado (INT-03): `result_produced → result_accepted → integration_authorized
-- /integration_refused`. Decide apenas por fato persistido, fail-closed, e é
-- idempotente por decisão.
--
-- Fronteiras que esta migration NÃO cruza (etapa do publisher real, adiante):
--   * NÃO existe caminho para `integrated`: marcar integração como REALIZADA exige
--     efeito externo comprovado, que só um IntegrationPublisher real (atrás de nova
--     aprovação humana) pode fornecer;
--   * NÃO faz push, PR, merge, apply nem publicação externa;
--   * NÃO muda o estado do item (`completed` permanece `completed`; não há
--     `WorkState` `integrated`), não toca a matriz de estados, o laço, o supervisor
--     nem o worktree.
--
-- ============================================================
-- Idempotência e "uma decisão por resultado aceito"
-- ============================================================
--
-- O contrato ratificado admite EXATAMENTE UMA decisão de integração por resultado
-- aceito. Para o resultado aceito informado:
--   * decisão idêntica já registrada (mesmo decision_id e mesma decisão) → replay
--     idempotente, sem novo evento;
--   * mesmo decision_id, decisão diferente → conflito fail-closed (55000);
--   * já decidido por outro decision_id → recusa "already decided" (55000).
-- `SELECT ... FOR UPDATE` do item serializa concorrentes; o índice único parcial
-- por `accepted_result_event_id` é a garantia final.

CREATE TYPE public.work_integration_decision AS ENUM ('authorize', 'refuse');

-- Garantia final: no máximo uma decisão de integração por resultado aceito.
CREATE UNIQUE INDEX work_events_integration_decision_result_idx
  ON public.work_events ((payload -> 'data' ->> 'accepted_result_event_id'))
  WHERE event_type = 'integration_decided';

CREATE FUNCTION public.decide_integration(
  work_item_id uuid,
  expected_proposal_version integer,
  accepted_result_event_id uuid,
  decision public.work_integration_decision,
  decision_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_item        public.work_items;
  v_accept      public.work_events;
  v_attempt_id  text;
  v_existing    public.work_events;
  v_event_seq   bigint;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version < 1
     OR accepted_result_event_id IS NULL OR decision IS NULL
     OR decision_id IS NULL OR length(btrim(decision_id)) = 0 THEN
    RAISE EXCEPTION 'invalid integration decision input' USING ERRCODE='22023';
  END IF;

  -- Fronteira de concorrência: bloqueia o item e serializa decisões do item.
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  -- A integração só decide sobre um resultado ACEITO: item `completed`, versão
  -- correta. `completed` é terminal — não reabre —, então isto é estável.
  IF v_item.state <> 'completed' OR v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;

  -- O aceite persistido tem de apontar exatamente para o resultado informado.
  SELECT * INTO v_accept FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='result_accepted'
  ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'accepted result not found' USING ERRCODE='P0002'; END IF;
  IF v_accept.payload->'data'->>'accepted_result_event_id' IS DISTINCT FROM accepted_result_event_id::text THEN
    RAISE EXCEPTION 'accepted result changed' USING ERRCODE='55000';
  END IF;

  -- O resultado aceito é um result_submitted real; dele deriva a correlação da
  -- tentativa (INT-02), nunca informada pelo cliente.
  SELECT e.payload->'data'->>'attempt_id' INTO v_attempt_id FROM public.work_events e
  WHERE e.id=accepted_result_event_id AND e.work_item_id=v_item.id AND e.event_type='result_submitted';
  IF v_attempt_id IS NULL THEN RAISE EXCEPTION 'accepted result not found' USING ERRCODE='P0002'; END IF;

  -- Uma decisão por resultado aceito. Replay idêntico antes de qualquer conflito.
  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='integration_decided'
    AND e.payload->'data'->>'accepted_result_event_id'=accepted_result_event_id::text
  ORDER BY e.seq DESC LIMIT 1;
  IF FOUND THEN
    IF v_existing.payload->'data'->>'decision_id' = decision_id
       AND v_existing.payload->'data'->>'decision' = decision::text THEN
      RETURN jsonb_build_object('action','replayed','decision',decision::text,'event_seq',v_existing.seq);
    END IF;
    IF v_existing.payload->'data'->>'decision_id' = decision_id THEN
      RAISE EXCEPTION 'integration decision conflict' USING ERRCODE='55000';
    END IF;
    RAISE EXCEPTION 'integration already decided' USING ERRCODE='55000';
  END IF;

  -- Evento append-only, autoria humana, SEM tocar o estado do item.
  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, 'integration_decided', 'user', v_item.proposal_version,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
      'work_item_id', v_item.id,
      'attempt_id', v_attempt_id,
      'approved_proposal_version', expected_proposal_version,
      'accepted_result_event_id', accepted_result_event_id,
      'decision', decision::text,
      'decision_id', decision_id,
      'origin', 'user')))
  RETURNING seq INTO v_event_seq;

  RETURN jsonb_build_object('action','recorded','decision',decision::text,'event_seq',v_event_seq);
END;
$$;

REVOKE ALL ON FUNCTION public.decide_integration(uuid, integer, uuid, public.work_integration_decision, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_integration(uuid, integer, uuid, public.work_integration_decision, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.decide_integration(uuid, integer, uuid, public.work_integration_decision, text) IS
  'ADR-002: registra a segunda aprovação humana (autorizar/recusar a integração) de um resultado aceito, como evento append-only integration_decided, decidindo apenas por fato persistido e fail-closed. Exige item do usuário em completed, aceite persistido apontando o resultado exato, versão correta e decision_id não vazio; deriva a tentativa do resultado aceito. Uma decisão por resultado aceito: replay idêntico sem novo evento, conflito e "already decided" falham fechados. NÃO muda estado, não integra, não publica, não aplica e não existe caminho para integrated sem efeito externo comprovado.';
