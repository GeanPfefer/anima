-- SUP-05: exclusividade de alvo simétrica.
--
-- Brecha fechada: `acquire_work_claim` verificava ocupação do alvo, mas o
-- INÍCIO da tentativa não. A assimetria real não era comandado-vs-autônomo e
-- sim aquisição-vs-início: o caminho comandado chega direto ao início, sem
-- passar por aquisição alguma, então um comando explícito do usuário podia
-- iniciar execução sobre alvo com claim autônomo ativo.
--
-- Fronteira atômica escolhida: `private.begin_work_attempt`, o corpo único já
-- compartilhado pelos dois caminhos. Verificar ali dá simetria por construção
-- — uma implementação só, não duas que podem divergir — e coloca a garantia na
-- mesma transação que vira o item para `in_progress`.
--
-- Alternativas consideradas e rejeitadas:
--
-- (a) verificar em `start_commanded_work_attempt` — rejeitada: duplicaria a
--     regra em dois lugares, que é exatamente como assimetrias nascem;
-- (b) verificar na aplicação antes do RPC — rejeitada pela mesma razão do
--     SUP-03: dois itens diferentes no mesmo alvo travam LINHAS DIFERENTES,
--     então o `FOR UPDATE` do item não serializa nada e a janela de corrida
--     permanece aberta entre a consulta e o início;
-- (c) índice único sobre itens `in_progress` por alvo — rejeitada: `in_progress`
--     é estado do item, não posse; um índice parcial sobre uma coluna derivada
--     de jsonb exigiria coluna gerada e ainda não cobriria o claim ativo sem
--     execução, que também ocupa.
--
-- Ordem de locks preservada: item primeiro, alvo depois — a mesma de
-- `acquire_work_claim`, o que impede ciclo entre as duas funções.

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

  UPDATE public.work_items SET state='in_progress', updated_at=now() WHERE id=v_item.id RETURNING * INTO v_item;
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

COMMENT ON FUNCTION private.begin_work_attempt(uuid,uuid,integer,uuid,text,text,uuid) IS
  'Corpo único do início de tentativa, compartilhado pela execução comandada (INT-04) e pela execução sob claim (AUTO-02). Recusa iniciar sobre alvo ocupado por claim ativo de outro dono ou por outro item em in_progress (SUP-05), com lock consultivo por alvo adquirido após o lock do item. Replay da mesma tentativa retorna antes da verificação e permanece idempotente; nenhum claim alheio é liberado ou roubado por este caminho.';
