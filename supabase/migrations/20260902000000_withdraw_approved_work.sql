-- Retirada canônica de um PLANO APROVADO NÃO INICIADO que ficou obsoleto ANTES da execução.
--
-- Um sistema autônomo precisa reconhecer honestamente: "eu estava autorizado a executar
-- este plano, mas antes de começar descobri que ele ficou obsoleto" (base SHA mudou, o
-- contrato de domínio evoluiu, uma capability nova mudou a forma correta de validar, uma
-- dependência mudou, o usuário retirou a autorização, ou um sucessor melhor o substitui).
-- A resposta correta NÃO é executá-lo mesmo assim, editar sua história, apagá-lo, nem
-- fabricar uma falha. É registrar explicitamente que a AUTORIZAÇÃO foi RETIRADA antes da
-- execução, preservando toda a evidência.
--
-- SEMÂNTICA (menor delta): reusa o estado terminal `cancelled` e a transição JÁ normativa
-- `('approved','work_cancelled','cancelled')` da matriz `private.work_state_transitions`.
-- `cancelled` já significa legitimamente "não será executado". Distingue-se de:
--   * `rejected`      — a PROPOSTA foi recusada (nunca aprovada) via `resolve_approval`;
--   * `changes_requested` — pediu-se correção de uma proposta/resultado;
--   * `failed`        — a EXECUÇÃO começou e falhou.
-- Aqui o plano foi aprovado mas NUNCA executou, e a autorização é retirada de propósito.
--
-- INVARIANTE (fail-closed): só atinge um plano que NUNCA começou. `state='approved'` já
-- garante isso pela matriz (approved só é alcançado de `proposed` via `work_approved`, e sai
-- por `work_started`→in_progress ou `work_cancelled`→cancelled) — nunca reentra approved após
-- executar. Ainda assim conferimos, em defesa de profundidade, que não há evento de execução.
--
-- AUTORIDADE: retirar uma autorização já concedida é ato do DONO (author='user'), sob a mesma
-- allowlist + RLS (auth.uid) das demais decisões humanas. Nunca service_role no fluxo normal.
--
-- DEPENDÊNCIAS: `cancelled` NÃO é `completed`, então esta retirada NÃO satisfaz dependências
-- nem desbloqueia trabalho que exigia a CONCLUSÃO deste (a satisfação de dependência exige
-- `completed`). O lineage/append-only é preservado; nada é apagado nem resetado.
--
-- IDEMPOTÊNCIA: repetir a retirada de um item já retirado por este fluxo devolve o item sem
-- novo efeito (nenhum evento duplicado).

CREATE OR REPLACE FUNCTION public.withdraw_approved_work(
  work_item_id uuid,
  expected_proposal_version integer,
  reason text
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_target_state public.work_state;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.work_orchestration_allowlist AS allowlist
    WHERE allowlist.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;

  IF expected_proposal_version IS NULL OR expected_proposal_version <= 0
     OR reason IS NULL OR length(btrim(reason)) = 0 THEN
    RAISE EXCEPTION 'invalid withdrawal input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item
  FROM public.work_items AS item
  WHERE item.id = work_item_id
    AND item.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE = 'P0002';
  END IF;

  -- Replay idempotente: já retirado antes da execução por este mesmo fluxo.
  IF v_item.state = 'cancelled'
     AND v_item.proposal_version = expected_proposal_version
     AND EXISTS (
       SELECT 1 FROM public.work_events AS event
       WHERE event.work_item_id = v_item.id
         AND event.event_type = 'work_cancelled'
         AND event.payload -> 'data' ->> 'withdrawn_before_execution' = 'true'
     ) THEN
    RETURN v_item;
  END IF;

  -- Precondição de estado: SÓ um plano APROVADO e da versão vigente. Uma proposta
  -- (`proposed`) é recusada por `resolve_approval` (reject); estados de execução ou
  -- terminais não são retiráveis por esta via.
  IF v_item.state <> 'approved' OR v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'work item is not an unstarted approved plan' USING ERRCODE = '55000';
  END IF;

  -- Defesa em profundidade: nenhuma execução jamais começou (deve ser vazio dado `approved`).
  IF EXISTS (
    SELECT 1 FROM public.work_events AS event
    WHERE event.work_item_id = v_item.id
      AND event.event_type IN ('execution_started', 'work_started', 'result_submitted')
  ) THEN
    RAISE EXCEPTION 'approved plan has execution history and cannot be withdrawn' USING ERRCODE = '55000';
  END IF;

  SELECT transition.to_state INTO v_target_state
  FROM private.work_state_transitions AS transition
  WHERE transition.from_state = v_item.state
    AND transition.event_type = 'work_cancelled';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transition not allowed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.work_items AS item
  SET state = v_target_state,
      updated_at = now()
  WHERE item.id = v_item.id
  RETURNING * INTO v_item;

  INSERT INTO public.work_events (
    work_item_id, event_type, author, proposal_version, payload
  ) VALUES (
    v_item.id,
    'work_cancelled',
    'user',
    v_item.proposal_version,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object(
      'reason', btrim(reason),
      'withdrawn_before_execution', true,
      'withdrawn_from_state', 'approved'
    ))
  );

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_approved_work(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_approved_work(uuid, integer, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.withdraw_approved_work(uuid, integer, text) IS
  'Retira canonicamente um plano APROVADO NÃO INICIADO que ficou obsoleto antes da execução '
  '(approved → work_cancelled → cancelled). Ato do dono (author=user), allowlist+RLS, fail-closed '
  '(só approved sem histórico de execução), idempotente. Não satisfaz dependências nem apaga lineage.';
