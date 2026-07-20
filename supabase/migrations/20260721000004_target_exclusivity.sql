-- SUP-03: no máximo um trabalho ativo por alvo.
--
-- Alternativas consideradas:
--
-- (a) tabela própria `work_target_locks` — rejeitada: cria estado paralelo que
--     pode divergir dos work_items, exatamente o risco que o backlog manda
--     evitar preferindo projeção;
-- (b) verificação apenas na aplicação — rejeitada: dois itens diferentes no
--     mesmo alvo travam linhas diferentes, então nada serializa a corrida;
-- (c) extensão de `work_claims` com `target_reference` + índice único parcial
--     — **escolhida**: é a menor representação coerente, reaproveita a posse
--     que já existe e coloca a garantia no banco.
--
-- A exclusividade por item (AUTO-02) e por alvo (SUP-03) permanecem distintas:
-- são dois índices únicos parciais independentes sobre a mesma tabela.
--
-- Ocupação do alvo = claim ativo OU item em `in_progress`. O segundo termo é
-- indispensável e vale mesmo sem claim: cobre o claim que expira no meio de
-- uma execução longa e a execução comandada do INT-04, que não cria claim.
-- Claim expirado ou liberado sobre item que não executa NÃO ocupa nada, então
-- o alvo nunca fica bloqueado permanentemente.

ALTER TABLE public.work_claims ADD COLUMN target_reference text;

-- Backfill a partir da especificação de execução do próprio item. `SET NOT NULL`
-- falha alto se algum claim não tiver alvo derivável — preferimos a migration
-- quebrar a inventar dado.
UPDATE public.work_claims c
SET target_reference = btrim(i.intent #>> '{execution_spec,target,reference}')
FROM public.work_items i
WHERE i.id = c.work_item_id;

ALTER TABLE public.work_claims ALTER COLUMN target_reference SET NOT NULL;
ALTER TABLE public.work_claims ADD CONSTRAINT work_claims_target_reference_present
  CHECK (length(btrim(target_reference)) > 0);

-- Invariante do SUP-03, garantida pelo banco.
CREATE UNIQUE INDEX work_claims_single_open_per_target_idx
  ON public.work_claims (user_id, target_reference) WHERE released_at IS NULL;

COMMENT ON COLUMN public.work_claims.target_reference IS
  'Alvo ocupado pela posse, derivado no servidor a partir de intent.execution_spec.target.reference — nunca informado pelo cliente. O kind não participa da identidade do alvo: mesma referência é o mesmo alvo físico.';

-- ============================================================
-- Aquisição de claim ciente do alvo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.acquire_work_claim(
  work_item_id uuid,
  expected_proposal_version integer,
  claim_id uuid,
  owner_instance_id text,
  lease_seconds integer
)
RETURNS public.work_claims
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.work_items;
  v_existing public.work_claims;
  v_open public.work_claims;
  v_superseded uuid := NULL;
  v_now timestamptz := now();
  v_owner text := btrim(owner_instance_id);
  v_target text;
  v_claim public.work_claims;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF claim_id IS NULL OR expected_proposal_version IS NULL OR expected_proposal_version < 1
     OR owner_instance_id IS NULL OR length(v_owner)=0
     OR lease_seconds IS NULL OR lease_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid claim request' USING ERRCODE='22023';
  END IF;

  -- Lock do item: dois supervisores disputando o MESMO item são serializados aqui.
  SELECT * INTO v_item FROM public.work_items i
  WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;

  -- Identidade e replay antes de elegibilidade: uma reentrega legítima chega
  -- depois de o item já ter saído de `approved`.
  SELECT * INTO v_existing FROM public.work_claims c WHERE c.id=claim_id AND c.user_id=v_user_id;
  IF FOUND THEN
    IF v_existing.work_item_id <> v_item.id OR v_existing.owner_instance_id <> v_owner
       OR v_existing.approved_proposal_version <> expected_proposal_version THEN
      RAISE EXCEPTION 'claim identity conflict' USING ERRCODE='55000';
    END IF;
    IF v_existing.released_at IS NOT NULL THEN
      RAISE EXCEPTION 'claim already released' USING ERRCODE='55000';
    END IF;
    IF v_now >= v_existing.expires_at THEN
      RAISE EXCEPTION 'claim expired' USING ERRCODE='55000';
    END IF;
    RETURN v_existing;
  END IF;

  IF v_item.state <> 'approved' OR v_item.proposal_version <> expected_proposal_version THEN
    RAISE EXCEPTION 'work item is not eligible for an autonomous claim' USING ERRCODE='55000';
  END IF;
  IF jsonb_typeof(v_item.intent->'execution_spec') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'execution specification missing' USING ERRCODE='22023';
  END IF;

  -- Alvo derivado no servidor; ausente, vazio ou não textual falha fechado.
  v_target := btrim(v_item.intent #>> '{execution_spec,target,reference}');
  IF v_target IS NULL OR length(v_target)=0
     OR jsonb_typeof(v_item.intent #> '{execution_spec,target,reference}') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'execution target missing' USING ERRCODE='22023';
  END IF;

  -- Lock consultivo do alvo: serializa dois supervisores disputando itens
  -- DIFERENTES do mesmo alvo, que travam linhas diferentes. O índice único
  -- parcial permanece como garantia final.
  PERFORM pg_advisory_xact_lock(hashtextextended('work_target:'||v_user_id::text||':'||v_target, 0));

  -- Posse anterior do próprio item (AUTO-02).
  SELECT * INTO v_open FROM public.work_claims c
  WHERE c.work_item_id=v_item.id AND c.released_at IS NULL FOR UPDATE;
  IF FOUND THEN
    IF v_now < v_open.expires_at THEN
      RAISE EXCEPTION 'work item is held by an active claim' USING ERRCODE='55000';
    END IF;
    UPDATE public.work_claims SET released_at=v_now, release_reason='expired'
    WHERE id=v_open.id RETURNING * INTO v_open;
    v_superseded := v_open.id;
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
      (v_item.id,'work_claim_released','system',v_open.approved_proposal_version,
        jsonb_build_object('schema_version',1,'data',jsonb_build_object(
          'claim_id',v_open.id,'work_item_id',v_item.id,
          'approved_proposal_version',v_open.approved_proposal_version,
          'owner_instance_id',v_open.owner_instance_id,'attempt_id',v_open.attempt_id,
          'reason','expired','released_at',v_now)));
  END IF;

  -- Execução em curso de OUTRO item no mesmo alvo, com ou sem claim.
  IF EXISTS (
    SELECT 1 FROM public.work_items other
    WHERE other.user_id=v_user_id AND other.id<>v_item.id AND other.state='in_progress'
      AND btrim(other.intent #>> '{execution_spec,target,reference}')=v_target
  ) THEN
    RAISE EXCEPTION 'work target is busy with a running attempt' USING ERRCODE='55000';
  END IF;

  -- Posse de OUTRO item sobre o mesmo alvo.
  SELECT * INTO v_open FROM public.work_claims c
  WHERE c.user_id=v_user_id AND c.target_reference=v_target AND c.released_at IS NULL
  FOR UPDATE;
  IF FOUND THEN
    IF v_now < v_open.expires_at THEN
      RAISE EXCEPTION 'work target is held by an active claim' USING ERRCODE='55000';
    END IF;
    -- Claim vencido de outro item não bloqueia o alvo: liberado de forma
    -- auditável, preservando a linha.
    UPDATE public.work_claims SET released_at=v_now, release_reason='expired'
    WHERE id=v_open.id RETURNING * INTO v_open;
    INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
      (v_open.work_item_id,'work_claim_released','system',v_open.approved_proposal_version,
        jsonb_build_object('schema_version',1,'data',jsonb_build_object(
          'claim_id',v_open.id,'work_item_id',v_open.work_item_id,
          'approved_proposal_version',v_open.approved_proposal_version,
          'owner_instance_id',v_open.owner_instance_id,'attempt_id',v_open.attempt_id,
          'reason','expired','released_at',v_now)));
  END IF;

  INSERT INTO public.work_claims(id,work_item_id,user_id,approved_proposal_version,owner_instance_id,acquired_at,expires_at,target_reference)
  VALUES (claim_id,v_item.id,v_user_id,expected_proposal_version,v_owner,v_now,v_now + make_interval(secs => lease_seconds),v_target)
  RETURNING * INTO v_claim;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES
    (v_item.id,'work_claimed','system',v_claim.approved_proposal_version,
      jsonb_build_object('schema_version',1,'data',jsonb_build_object(
        'claim_id',v_claim.id,'work_item_id',v_item.id,
        'approved_proposal_version',v_claim.approved_proposal_version,
        'owner_instance_id',v_claim.owner_instance_id,'acquired_at',v_claim.acquired_at,
        'expires_at',v_claim.expires_at,'superseded_claim_id',v_superseded,
        'target_reference',v_claim.target_reference)));

  RETURN v_claim;
EXCEPTION
  -- Garantia final: se o índice único disparar, a corrida foi perdida.
  WHEN unique_violation THEN
    RAISE EXCEPTION 'work target is held by an active claim' USING ERRCODE='55000';
END;
$$;

-- ============================================================
-- Fila e seleção cientes da ocupação do alvo.
-- O tipo de retorno muda, então as funções são recriadas.
-- ============================================================

DROP FUNCTION public.next_autonomous_work();
DROP FUNCTION public.autonomous_work_queue();

CREATE FUNCTION public.autonomous_work_queue()
RETURNS TABLE (
  work_item_id              uuid,
  approved_proposal_version integer,
  approval_seq              bigint,
  approved_at               timestamptz,
  capability                public.work_capability,
  target_reference          text,
  queue_position            bigint,
  target_occupied           boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.proposal_version,
    approval.seq,
    approval.created_at,
    i.capability,
    btrim(i.intent #>> '{execution_spec,target,reference}'),
    -- Ordem total materializada como dado, não como sorte de plano.
    row_number() OVER (ORDER BY approval.seq, i.id),
    -- SUP-03: outro trabalho ocupa este alvo agora. O item permanece na fila —
    -- ele espera, não é descartado.
    (EXISTS (
       SELECT 1 FROM public.work_claims oc
       WHERE oc.user_id=v_user_id
         AND oc.target_reference=btrim(i.intent #>> '{execution_spec,target,reference}')
         AND oc.released_at IS NULL AND oc.expires_at > now()
     ) OR EXISTS (
       SELECT 1 FROM public.work_items oi
       WHERE oi.user_id=v_user_id AND oi.state='in_progress'
         AND btrim(oi.intent #>> '{execution_spec,target,reference}')=btrim(i.intent #>> '{execution_spec,target,reference}')
     ))
  FROM public.work_items i
  -- Aprovação vigente: proposta revisada perde a posição anterior na fila.
  JOIN LATERAL (
    SELECT e.seq, e.created_at
    FROM public.work_events e
    WHERE e.work_item_id = i.id
      AND e.event_type = 'work_approved'
      AND e.proposal_version = i.proposal_version
    ORDER BY e.seq DESC
    LIMIT 1
  ) AS approval ON TRUE
  WHERE i.user_id = v_user_id
    AND private.is_autonomously_eligible(i.state, i.proposal, i.intent)
    AND NOT EXISTS (
      SELECT 1 FROM public.work_claims c
      WHERE c.work_item_id = i.id AND c.released_at IS NULL AND c.expires_at > now()
    )
  ORDER BY approval.seq, i.id;
END;
$$;

REVOKE ALL ON FUNCTION public.autonomous_work_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.autonomous_work_queue() TO authenticated, service_role;

COMMENT ON FUNCTION public.autonomous_work_queue() IS
  'Projeção da fila de trabalhos aguardando execução autônoma, derivada de work_items, da aprovação vigente e de work_claims. Ordem FIFO pela sequência do evento de aprovação, com o id do item como desempate defensivo. target_occupied indica que outro trabalho ocupa o alvo agora — o item espera, não sai da fila. Não possui estado próprio.';

CREATE FUNCTION public.next_autonomous_work()
RETURNS TABLE (
  work_item_id              uuid,
  approved_proposal_version integer,
  approval_seq              bigint,
  approved_at               timestamptz,
  capability                public.work_capability,
  target_reference          text,
  selection_policy          text,
  queue_size                bigint,
  runner_up_approval_seq    bigint,
  skipped_occupied_targets  bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
BEGIN
  -- A fila já aplica autenticação, allowlist, elegibilidade e posse.
  RETURN QUERY
  WITH queue AS (SELECT * FROM public.autonomous_work_queue()),
       -- SUP-03: alvo ocupado não reordena a fila nem descarta o item; apenas
       -- o torna inelegível agora.
       free AS (SELECT * FROM queue WHERE NOT queue.target_occupied)
  SELECT
    head.work_item_id,
    head.approved_proposal_version,
    head.approval_seq,
    head.approved_at,
    head.capability,
    head.target_reference,
    'oldest_approval_first'::text,
    (SELECT count(*) FROM queue),
    -- Segundo colocado entre os que podem executar agora.
    (SELECT runner_up.approval_seq FROM free AS runner_up
      WHERE runner_up.queue_position > head.queue_position
      ORDER BY runner_up.queue_position LIMIT 1),
    -- Quantos mais antigos foram pulados por alvo ocupado.
    (SELECT count(*) FROM queue AS skipped WHERE skipped.queue_position < head.queue_position)
  FROM free AS head
  ORDER BY head.queue_position
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.next_autonomous_work() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_autonomous_work() TO authenticated, service_role;

COMMENT ON FUNCTION public.next_autonomous_work() IS
  'Próximo trabalho elegível cujo alvo está livre, segundo a política determinística oldest_approval_first, com a razão da escolha. Não emite evento: selecionar é leitura; o efeito auditável é o claim.';
