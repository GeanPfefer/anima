-- Etapa 2B.1: o terminal comandado pode vir DEPOIS de checkpoints.
--
-- ============================================================
-- O defeito corrigido
-- ============================================================
--
-- `record_commanded_work_terminal` exigia `sequence == 1`. Isso ficou obsoleto:
-- a `sequence` pertence à transcrição inteira do INT-01, e um terminal legítimo
-- aparece depois de zero ou mais `progress`/`checkpoint`. Exemplo válido:
--
--   progress    sequence=1
--   checkpoint  sequence=2
--   progress    sequence=3
--   checkpoint  sequence=4
--   result      sequence=5
--
-- A guarda passa a ser o menor contrato persistente correto: `sequence` é
-- inteiro positivo e o terminal vem DEPOIS do maior checkpoint persistido da
-- tentativa. `progress` NÃO é persistido, então não se exige contiguidade
-- (`terminal == checkpoint + 1`) — a continuidade completa da transcrição é
-- responsabilidade de `validateWorkExecutorTranscript`, no processo que consome
-- o stream, não do banco.
--
-- Regra: sem checkpoint persistido → `sequence >= 1`; com maior checkpoint em
-- N → `sequence > N`; `sequence <= N` recusa fail-closed.
--
-- A guarda de sequência entra DEPOIS da verificação de replay idempotente e da
-- guarda de abandono do SUP-04, para que a reentrega de um terminal legítimo
-- continue idempotente e que sinal tardio de tentativa abandonada continue
-- recusado. Fora essas linhas, o corpo é o da migration 20260721000007.
--
-- O `signal_sequence` gravado passa a ser o real do terminal (não mais 1 fixo).

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
  v_terminal_seq integer;
  v_max_checkpoint_seq integer;
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
     OR jsonb_typeof(signal->'sequence') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'terminal signal correlation mismatch' USING ERRCODE='22023';
  END IF;
  v_terminal_seq := (signal->>'sequence')::integer;
  IF v_terminal_seq < 1 THEN
    RAISE EXCEPTION 'terminal sequence must be a positive integer' USING ERRCODE='22023';
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

  -- Etapa 2B.1: o terminal vem DEPOIS de todos os checkpoints persistidos da
  -- tentativa. progress não é persistido, então basta estar à frente do maior.
  SELECT max((e.payload->'data'->>'signal_sequence')::integer) INTO v_max_checkpoint_seq
  FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='checkpoint_recorded'
    AND e.payload->'data'->>'attempt_id'=attempt_id::text;
  IF v_max_checkpoint_seq IS NOT NULL AND v_terminal_seq <= v_max_checkpoint_seq THEN
    RAISE EXCEPTION 'terminal sequence must follow the latest checkpoint' USING ERRCODE='55000';
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
    'approved_proposal_version',expected_proposal_version,'origin','executor','signal_sequence',v_terminal_seq,'executor_signal',signal);

  UPDATE public.work_items SET state=v_state,updated_at=now() WHERE id=v_item.id RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,v_event,CASE WHEN v_kind='cancelled' THEN 'user'::public.work_event_author ELSE 'executor'::public.work_event_author END,
    v_item.proposal_version,jsonb_build_object('schema_version',1,'data',v_data));
  RETURN v_item;
END;
$$;

COMMENT ON FUNCTION public.record_commanded_work_terminal(uuid,integer,uuid,jsonb) IS
  'Persiste o desfecho tipado do executor sob comando (INT-04) e do laço supervisionado. O terminal pode vir depois de checkpoints: exige sequence inteiro positivo e, quando há checkpoint persistido, sequence maior que o último. Reentrega do mesmo sinal é idempotente; sinal divergente e sinal de tentativa abandonada pela reconciliação (SUP-04) são recusados, nunca sobrescrevem estado nem ressuscitam tentativa encerrada.';
