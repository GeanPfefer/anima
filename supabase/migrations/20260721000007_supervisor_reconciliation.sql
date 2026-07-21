-- SUP-04: reconciliação e retomada segura do Supervisor V0.
--
-- ============================================================
-- O defeito
-- ============================================================
--
-- Nenhum caminho tira um item de `in_progress` sem um sinal do executor.
-- `begin_work_attempt` vira o item para `in_progress`; o terminal chega por
-- `record_commanded_work_terminal` ou `finish_work_execution`. Se o processo
-- morrer entre os dois — máquina reiniciada, Docker fora, limite de provedor,
-- rede caída —, o item fica em `in_progress` PARA SEMPRE: ocupa o alvo
-- permanentemente (SUP-05), sai da fila (SUP-01 exige `approved`) e
-- `planWorkResumption` recusa com `work_not_resumable`, apontando para cá.
-- O AUTO-05 é hoje estruturalmente inalcançável; esta migration é o elo.
--
-- ============================================================
-- O princípio
-- ============================================================
--
-- Ausência de processo, executor ou heartbeat NÃO prova sucesso nem fracasso.
-- Toda transição produzida aqui precisa ser justificada por fato persistido.
--
-- A pergunta que a reconciliação sabe responder não é "a execução terminou?"
-- — essa ela não pode responder — e sim "esta tentativa excedeu um limite que
-- alguém declarou e o banco guardou?". Duas fontes de limite existem no
-- contrato atual, e nenhuma delas é relógio solto:
--
--   * tentativa sob claim (AUTO-02): o lease `work_claims.expires_at`, que já
--     é o contrato de posse — `acquire_work_claim` recolhe claim vencido desde
--     sempre, com razão `expired` e evento;
--   * tentativa comandada (INT-04): `execution_spec.limits.max_duration_minutes`,
--     declarado na proposta APROVADA e já validado pela régua do AUTO-01
--     (`private.is_valid_execution_limits`), medido a partir do evento
--     `execution_started` persistido.
--
-- Sem nenhum limite declarado não há fato: a reconciliação relata e não muda
-- nada. Com limites declarados, exige-se que TODOS os aplicáveis estejam
-- excedidos — lease vencido com duração ainda dentro do declarado não abandona,
-- porque a execução pode legitimamente seguir viva.
--
-- `attempt_abandoned` afirma estritamente que a tentativa excedeu seu limite
-- declarado e deixou de ser a ocupante do item. Não afirma sucesso, não afirma
-- fracasso, não aceita, não autoriza e não integra resultado algum.
--
-- ============================================================
-- Alternativas consideradas e rejeitadas
-- ============================================================
--
-- (a) marcar a órfã como `failed` via `execution_failed` — rejeitada: afirma um
--     desfecho que ninguém observou. É exatamente a conclusão inventada que o
--     princípio proíbe;
-- (b) mandar a órfã para `blocked` — rejeitada por ser beco sem saída real:
--     NENHUMA rpc emite `work_blocked`, e `private.begin_work_attempt` exige
--     `approved`, então a linha `blocked → work_started` da matriz é
--     inexecutável. Trocaria um item travado por outro travado;
-- (c) deixar em `in_progress` e apenas relatar — rejeitada: o alvo permanece
--     ocupado para sempre e nada é restaurado, que é o defeito de origem;
-- (d) heartbeat/lease para o caminho comandado — rejeitada: alteraria o
--     contrato ratificado do INT-04 sem regressão demonstrada. O limite
--     declarado na proposta aprovada já é contrato persistido suficiente;
-- (e) reconciliar e já iniciar a próxima tentativa — rejeitada: o backlog
--     separa reconciliar de executar. Voltar a `approved` restaura
--     ELEGIBILIDADE; escolher e iniciar continua sendo SUP-02 + AUTO-02, e o
--     `planWorkResumption` do AUTO-05 ainda recusa sem checkpoint.
--
-- ============================================================
-- Fronteira transacional e ordem de locks
-- ============================================================
--
-- Uma transação por chamada. Lock consultivo por USUÁRIO no início serializa
-- duas reconciliações concorrentes inteiras: a segunda espera, encontra os
-- efeitos já commitados da primeira e não acha nada a fazer. Depois dele, um
-- `FOR UPDATE` por item, na ordem do id.
--
-- A reconciliação NUNCA adquire lock de alvo. `acquire_work_claim` e
-- `begin_work_attempt` pegam item→alvo; a reconciliação pega usuário→item e
-- nunca pede o alvo, então não existe ciclo possível entre elas.

-- Transição consumida pela reconciliação. Única linha nova da matriz.
INSERT INTO private.work_state_transitions (from_state, event_type, to_state) VALUES
  ('in_progress', 'attempt_abandoned', 'approved');

CREATE FUNCTION public.reconcile_supervised_work()
RETURNS TABLE (
  work_item_id uuid,
  attempt_id   uuid,
  claim_id     uuid,
  finding      text,
  action       text,
  item_state   public.work_state,
  detail       jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_user_id           uuid := auth.uid();
  v_now               timestamptz := now();
  v_candidate         uuid;
  v_item              public.work_items;
  v_attempt           uuid;
  v_attempt_started   timestamptz;
  v_terminal          public.work_event_type;
  v_claim             public.work_claims;
  v_lease             public.work_claims;
  v_lease_bound       boolean;
  v_lease_exceeded    boolean;
  v_duration_minutes  integer;
  v_duration_bound    boolean;
  v_duration_exceeded boolean;
  v_target_state      public.work_state;
  v_reason            text;
  v_release_reason    text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;

  -- Duas reconciliações concorrentes são serializadas inteiras. A segunda não
  -- decide sobre estado que a primeira já mudou: ela relê tudo depois do commit.
  PERFORM pg_advisory_xact_lock(hashtextextended('work_reconciliation:'||v_user_id::text, 0));

  FOR v_candidate IN
    SELECT i.id FROM public.work_items i
    WHERE i.user_id = v_user_id
      AND (i.state = 'in_progress'
           OR EXISTS (SELECT 1 FROM public.work_claims c
                      WHERE c.work_item_id = i.id AND c.released_at IS NULL))
    ORDER BY i.id
  LOOP
    SELECT * INTO v_item FROM public.work_items i
    WHERE i.id = v_candidate AND i.user_id = v_user_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;

    -- Tentativa vigente do item: o `execution_started` mais recente que carrega
    -- `attempt_id`. A execução delimitada da P1.6 usa `execution_id` e não
    -- participa deste vocabulário.
    v_attempt := NULL; v_attempt_started := NULL;
    SELECT (e.payload->'data'->>'attempt_id')::uuid, e.created_at
      INTO v_attempt, v_attempt_started
    FROM public.work_events e
    WHERE e.work_item_id = v_item.id AND e.event_type = 'execution_started'
      AND e.payload->'data' ? 'attempt_id'
    ORDER BY e.seq DESC LIMIT 1;

    v_terminal := NULL;
    IF v_attempt IS NOT NULL THEN
      SELECT e.event_type INTO v_terminal FROM public.work_events e
      WHERE e.work_item_id = v_item.id
        AND e.event_type IN ('result_submitted','execution_failed','work_cancelled','attempt_abandoned')
        AND e.payload->'data'->>'attempt_id' = v_attempt::text
      ORDER BY e.seq DESC LIMIT 1;
    END IF;

    -- ---------- (1) evento final já persistido, estado derivado atrasado ----------
    --
    -- Materializar não emite evento novo: o evento JÁ existe e duplicá-lo seria
    -- inventar um segundo fato. Aplica-se a transição que o próprio evento
    -- justifica, pela mesma matriz normativa que todas as RPCs consultam.
    IF v_item.state = 'in_progress' AND v_terminal IS NOT NULL THEN
      SELECT t.to_state INTO v_target_state FROM private.work_state_transitions t
      WHERE t.from_state = v_item.state AND t.event_type = v_terminal;
      IF FOUND THEN
        UPDATE public.work_items SET state=v_target_state, updated_at=v_now
        WHERE id=v_item.id RETURNING * INTO v_item;
        RETURN QUERY SELECT v_item.id, v_attempt, NULL::uuid,
          'terminal_not_materialized'::text, 'state_materialized'::text, v_item.state,
          jsonb_build_object('terminal_event_type', v_terminal::text);
      END IF;
    END IF;

    -- ---------- (2) posse aberta ----------
    v_claim := NULL;
    SELECT * INTO v_claim FROM public.work_claims c
    WHERE c.work_item_id = v_item.id AND c.released_at IS NULL FOR UPDATE;
    IF FOUND THEN
      v_release_reason := NULL;
      IF v_claim.attempt_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.work_events e
        WHERE e.work_item_id = v_item.id
          AND e.event_type IN ('result_submitted','execution_failed','work_cancelled','attempt_abandoned')
          AND e.payload->'data'->>'attempt_id' = v_claim.attempt_id::text
      ) THEN
        -- A tentativa desta posse já tem desfecho persistido; o que faltou foi
        -- materializar a liberação. Fato, não relógio.
        v_release_reason := 'attempt_finished';
      ELSIF v_claim.expires_at <= v_now THEN
        -- Lease vencido: recolhido com a MESMA razão declarada que
        -- `acquire_work_claim` já usa. A linha permanece, nada é apagado.
        v_release_reason := 'expired';
      END IF;

      IF v_release_reason IS NOT NULL THEN
        UPDATE public.work_claims SET released_at=v_now, release_reason=v_release_reason
        WHERE id=v_claim.id RETURNING * INTO v_claim;
        INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
          (v_claim.work_item_id,'work_claim_released','system',v_claim.approved_proposal_version,
            jsonb_build_object('schema_version',1,'data',jsonb_build_object(
              'claim_id',v_claim.id,'work_item_id',v_claim.work_item_id,
              'approved_proposal_version',v_claim.approved_proposal_version,
              'owner_instance_id',v_claim.owner_instance_id,'attempt_id',v_claim.attempt_id,
              'reason',v_release_reason,'released_at',v_now)));
        RETURN QUERY SELECT v_item.id, v_claim.attempt_id, v_claim.id,
          (CASE WHEN v_release_reason='expired' THEN 'claim_expired' ELSE 'claim_open_after_terminal' END)::text,
          'claim_released'::text, v_item.state,
          jsonb_build_object('release_reason',v_release_reason,'owner_instance_id',v_claim.owner_instance_id);
      ELSE
        -- Posse ainda válida: intocada. Tomá-la seria o roubo silencioso que o
        -- SUP-05 proíbe, e liberá-la duplicaria execução.
        RETURN QUERY SELECT v_item.id, v_claim.attempt_id, v_claim.id,
          'claim_active'::text, 'none'::text, v_item.state,
          jsonb_build_object('expires_at',v_claim.expires_at,'owner_instance_id',v_claim.owner_instance_id);
      END IF;
    END IF;

    -- ---------- (3) tentativa interrompida ----------
    IF v_item.state = 'in_progress' AND v_terminal IS NULL THEN
      IF v_attempt IS NULL THEN
        -- Item executando sem tentativa registrada: inconsistência que nenhum
        -- fato persistido resolve. Relata e não toca.
        RETURN QUERY SELECT v_item.id, NULL::uuid, NULL::uuid,
          'attempt_missing'::text, 'requires_human'::text, v_item.state,
          jsonb_build_object('explanation','item em execução sem evento de tentativa correlacionado');
      ELSE
        -- Limite de posse: o lease do claim que iniciou ESTA tentativa.
        v_lease := NULL;
        SELECT * INTO v_lease FROM public.work_claims c
        WHERE c.user_id = v_user_id AND c.attempt_id = v_attempt;
        v_lease_bound := FOUND;
        v_lease_exceeded := v_lease_bound
          AND (v_lease.released_at IS NOT NULL OR v_lease.expires_at <= v_now);

        -- Limite de duração declarado na proposta aprovada. Mesma régua de
        -- `private.is_valid_execution_limits`: inteiro positivo ou nada.
        v_duration_minutes := NULL;
        IF jsonb_typeof(v_item.intent #> '{execution_spec,limits,max_duration_minutes}') = 'number'
           AND (v_item.intent #>> '{execution_spec,limits,max_duration_minutes}') ~ '^[0-9]+$'
           AND (v_item.intent #>> '{execution_spec,limits,max_duration_minutes}')::numeric > 0 THEN
          v_duration_minutes := (v_item.intent #>> '{execution_spec,limits,max_duration_minutes}')::integer;
        END IF;
        v_duration_bound := v_duration_minutes IS NOT NULL;
        v_duration_exceeded := v_duration_bound
          AND v_attempt_started + make_interval(mins => v_duration_minutes) <= v_now;

        IF NOT v_lease_bound AND NOT v_duration_bound THEN
          -- Nenhum limite persistido: não há fato que sustente transição alguma.
          -- Preferir estado seguro e revisável a inventar conclusão.
          RETURN QUERY SELECT v_item.id, v_attempt, NULL::uuid,
            'attempt_without_declared_bound'::text, 'requires_human'::text, v_item.state,
            jsonb_build_object(
              'explanation','tentativa sem lease e sem max_duration_minutes: nada delimita quando ela deixou de valer',
              'attempt_started_at',v_attempt_started);
        ELSIF (NOT v_lease_bound OR v_lease_exceeded)
              AND (NOT v_duration_bound OR v_duration_exceeded) THEN
          v_reason := CASE
            WHEN v_lease_bound AND v_duration_bound THEN 'declared_bounds_exceeded'
            WHEN v_lease_bound THEN 'lease_expired'
            ELSE 'duration_limit_exceeded' END;

          SELECT t.to_state INTO v_target_state FROM private.work_state_transitions t
          WHERE t.from_state = v_item.state AND t.event_type = 'attempt_abandoned';
          IF NOT FOUND THEN RAISE EXCEPTION 'transition not allowed' USING ERRCODE='22023'; END IF;

          UPDATE public.work_items SET state=v_target_state, updated_at=v_now
          WHERE id=v_item.id RETURNING * INTO v_item;
          INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
            (v_item.id,'attempt_abandoned','system',v_item.proposal_version,
              jsonb_build_object('schema_version',1,'data',jsonb_build_object(
                'work_item_id',v_item.id,'attempt_id',v_attempt,
                'approved_proposal_version',v_item.proposal_version,
                'claim_id',v_lease.id,
                'origin',CASE WHEN v_lease_bound THEN 'supervised' ELSE 'commanded' END,
                'reason',v_reason,
                'attempt_started_at',v_attempt_started,'observed_at',v_now,
                'lease_expires_at',v_lease.expires_at,
                'max_duration_minutes',v_duration_minutes)));
          RETURN QUERY SELECT v_item.id, v_attempt, v_lease.id,
            'attempt_abandoned'::text, 'attempt_abandoned'::text, v_item.state,
            jsonb_build_object('reason',v_reason,'attempt_started_at',v_attempt_started);
        ELSE
          -- Ao menos um limite declarado ainda não foi excedido: a execução pode
          -- estar legitimamente viva. Não se mexe.
          RETURN QUERY SELECT v_item.id, v_attempt, v_lease.id,
            'attempt_within_declared_bounds'::text, 'none'::text, v_item.state,
            jsonb_build_object(
              'lease_expires_at',v_lease.expires_at,
              'max_duration_minutes',v_duration_minutes,
              'attempt_started_at',v_attempt_started);
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_supervised_work() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_supervised_work() TO authenticated, service_role;

COMMENT ON FUNCTION public.reconcile_supervised_work() IS
  'SUP-04: restaura consistência e elegibilidade do trabalho supervisionado após interrupção, decidindo apenas por estado persistido e eventos observáveis. Materializa desfecho já registrado, recolhe lease vencido com razão declarada e abandona tentativa que excedeu TODOS os limites persistidos aplicáveis (lease do claim e/ou max_duration_minutes da proposta aprovada), devolvendo o item a approved. Ausência de processo não conclui sucesso nem fracasso: sem limite declarado o caso sai como requires_human sem mutação. Não inicia execução, não aceita, não autoriza e não integra resultado algum. Idempotente e serializada por lock consultivo por usuário.';

-- ============================================================
-- Consequência direta: sinal tardio de tentativa abandonada
-- ============================================================
--
-- Abandonar uma tentativa cria um estado que antes não existia: a tentativa
-- deixou de ser a ocupante do item, mas seu executor pode continuar vivo e
-- entregar um terminal depois. Sem guarda, esse sinal reabriria a tentativa
-- antiga — possivelmente enquanto uma nova já corre — e produziria exatamente o
-- duplo processamento que o SUP-04 precisa impedir.
--
-- A guarda entra DEPOIS da verificação de replay idempotente, para que a
-- reentrega de um terminal legitimamente registrado continue idempotente. Fora
-- ela, o corpo é byte a byte o da migration 20260720000000: o contrato do
-- INT-04 não muda para nenhum fluxo que não passe por abandono.

CREATE OR REPLACE FUNCTION public.record_commanded_work_terminal(
  work_item_id uuid,
  expected_proposal_version integer,
  attempt_id uuid,
  signal jsonb
)
RETURNS public.work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_previous public.work_events;
  v_event public.work_event_type;
  v_state public.work_state;
  v_data jsonb;
  v_kind text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version<1 OR attempt_id IS NULL
     OR jsonb_typeof(signal) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid terminal signal' USING ERRCODE='22023';
  END IF;
  v_kind := signal->>'kind';
  IF v_kind NOT IN ('result','error','cancelled')
     OR signal->>'workItemId' IS DISTINCT FROM work_item_id::text
     OR signal->>'attemptId' IS DISTINCT FROM attempt_id::text
     OR (signal->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version
     OR signal->>'origin' IS DISTINCT FROM 'executor'
     OR (signal->>'sequence')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'terminal signal correlation mismatch' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='execution_started'
    AND e.proposal_version=expected_proposal_version AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt not found' USING ERRCODE='P0002';
  END IF;

  SELECT * INTO v_previous FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type IN ('result_submitted','execution_failed','work_cancelled')
    AND e.payload->'data'->>'attempt_id'=attempt_id::text ORDER BY e.seq DESC LIMIT 1;
  IF FOUND THEN
    IF v_previous.payload->'data'->'executor_signal'=signal THEN RETURN v_item; END IF;
    RAISE EXCEPTION 'attempt already finished with different signal' USING ERRCODE='55000';
  END IF;

  -- SUP-04: tentativa abandonada pela reconciliação não é ressuscitada por um
  -- sinal tardio. O bundle produzido não é apagado nem perdido — permanece
  -- referenciado pelo evento de abandono —, mas não move estado nenhum.
  IF EXISTS (SELECT 1 FROM public.work_events e
    WHERE e.work_item_id=v_item.id AND e.event_type='attempt_abandoned'
      AND e.payload->'data'->>'attempt_id'=attempt_id::text) THEN
    RAISE EXCEPTION 'attempt was abandoned by reconciliation' USING ERRCODE='55000';
  END IF;

  IF v_item.state<>'in_progress' OR v_item.proposal_version<>expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;

  IF v_kind='result' THEN
    IF jsonb_typeof(signal->'resultReferences') IS DISTINCT FROM 'array'
       OR jsonb_typeof(signal->'validations') IS DISTINCT FROM 'array'
       OR jsonb_typeof(signal->'limitations') IS DISTINCT FROM 'array'
       OR length(btrim(signal->>'summary'))=0 OR length(btrim(signal->>'handoffReference'))=0
       OR signal->>'handoffReference' ~ '^[A-Za-z]:[\\/]' OR signal->>'handoffReference' LIKE '/%' THEN
      RAISE EXCEPTION 'invalid result signal' USING ERRCODE='22023';
    END IF;
    v_event:='result_submitted'; v_state:='review';
    v_data:=jsonb_build_object('summary',signal->>'summary','result_references',signal->'resultReferences',
      'validations',signal->'validations','limitations',signal->'limitations','handoff_reference',signal->>'handoffReference');
  ELSIF v_kind='cancelled' THEN
    v_event:='work_cancelled'; v_state:='cancelled';
    v_data:=jsonb_build_object('reason','execution_cancelled','handoff_reference',signal->>'handoffReference');
  ELSE
    IF length(btrim(signal->>'message'))=0 OR length(btrim(signal->>'handoffReference'))=0 THEN
      RAISE EXCEPTION 'invalid error signal' USING ERRCODE='22023';
    END IF;
    v_event:='execution_failed'; v_state:='failed';
    v_data:=jsonb_build_object('reason',signal->>'code','message',signal->>'message',
      'retryable',signal->'retryable','handoff_reference',signal->>'handoffReference');
  END IF;
  v_data:=v_data||jsonb_build_object('work_item_id',v_item.id,'attempt_id',attempt_id,
    'approved_proposal_version',expected_proposal_version,'origin','executor','signal_sequence',1,'executor_signal',signal);

  UPDATE public.work_items SET state=v_state,updated_at=now() WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,v_event,CASE WHEN v_kind='cancelled' THEN 'user'::public.work_event_author ELSE 'executor'::public.work_event_author END,
    v_item.proposal_version,jsonb_build_object('schema_version',1,'data',v_data));
  RETURN v_item;
END;
$$;

COMMENT ON FUNCTION public.record_commanded_work_terminal(uuid,integer,uuid,jsonb) IS
  'Persiste o desfecho tipado do executor sob comando (INT-04). Reentrega do mesmo sinal é idempotente; sinal divergente e sinal de tentativa abandonada pela reconciliação (SUP-04) são recusados, nunca sobrescrevem estado nem ressuscitam tentativa encerrada.';
