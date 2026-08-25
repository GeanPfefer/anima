-- Recovery lineage V0. Liga, por ID estável, um work item SUCESSOR ao ORIGINAL falho,
-- permitindo 1..N sucessores. NAO altera dependency satisfaction: o predecessor de uma
-- dependencia so e satisfeito quando `completed` (autonomous_work_dependencies_satisfied,
-- inalterado). `satisfies_original_objective` e um FATO honesto (false aqui) — nenhuma
-- autoridade o le para substituir dependencia neste recorte. O original permanece `failed`
-- com suas attempts/evidencia intactas; a lineage nao reseta budget nem reabre o original.

CREATE TABLE public.work_recovery_lineage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  original_work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  successor_work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  recovery_sequence integer NOT NULL CHECK (recovery_sequence >= 1),
  relation_kind text NOT NULL DEFAULT 'recovery_successor' CHECK (relation_kind = 'recovery_successor'),
  recovery_reason text NOT NULL CHECK (length(btrim(recovery_reason)) > 0),
  satisfies_original_objective boolean NOT NULL DEFAULT false,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_recovery_lineage_distinct CHECK (original_work_item_id <> successor_work_item_id),
  CONSTRAINT work_recovery_lineage_successor_unique UNIQUE (successor_work_item_id),
  CONSTRAINT work_recovery_lineage_sequence_unique UNIQUE (original_work_item_id, recovery_sequence),
  CONSTRAINT work_recovery_lineage_idem_unique UNIQUE (user_id, idempotency_key)
);

ALTER TABLE public.work_recovery_lineage ENABLE ROW LEVEL SECURITY;
-- Leitura apenas das proprias linhas; INSERT/UPDATE/DELETE somente pela funcao
-- SECURITY DEFINER (append-only para o usuario). Outro usuario nao le nem vincula.
CREATE POLICY work_recovery_lineage_select_own ON public.work_recovery_lineage
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.work_recovery_lineage FROM PUBLIC, anon;
GRANT SELECT ON public.work_recovery_lineage TO authenticated;

COMMENT ON TABLE public.work_recovery_lineage IS
  'Liga um work item sucessor de recuperacao ao original falho (1..N sucessores), por ID. Append-only; NAO substitui dependency satisfaction (predecessor so satisfaz quando completed).';

-- Logica autoritativa. Recebe o user_id explicito para ser reutilizavel pelo wrapper
-- public (auth.uid) e por chamada administrativa idempotente. Cria o sucessor `proposed`
-- + `work_proposed` + a linha de lineage, atomicamente. NAO aprova, classifica nem executa.
CREATE FUNCTION private.record_recovery_successor(
  p_user_id uuid, p_original_work_item_id uuid, p_recovery_sequence integer,
  p_impact_level public.work_impact_level, p_capability public.work_capability,
  p_intent jsonb, p_proposal jsonb, p_recovery_reason text, p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE v_original public.work_items; v_existing public.work_recovery_lineage;
        v_item public.work_items; v_lineage public.work_recovery_lineage;
BEGIN
  IF p_user_id IS NULL OR p_idempotency_key IS NULL OR p_recovery_sequence IS NULL OR p_recovery_sequence < 1
     OR p_recovery_reason IS NULL OR length(btrim(p_recovery_reason)) = 0 THEN
    RAISE EXCEPTION 'invalid recovery successor input' USING ERRCODE = '22023';
  END IF;
  -- Idempotencia: replay exato devolve o mesmo sucessor, sem duplicar.
  SELECT * INTO v_existing FROM public.work_recovery_lineage l
    WHERE l.user_id = p_user_id AND l.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('successorWorkItemId', v_existing.successor_work_item_id,
      'lineageId', v_existing.id, 'recoverySequence', v_existing.recovery_sequence, 'replayed', true);
  END IF;
  -- O original precisa pertencer ao usuario e estar `failed` (recuperacao so de falha).
  SELECT * INTO v_original FROM public.work_items i
    WHERE i.id = p_original_work_item_id AND i.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'original work item not found' USING ERRCODE = 'P0002'; END IF;
  IF v_original.state <> 'failed' THEN
    RAISE EXCEPTION 'recovery successor requires a failed original' USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(p_intent) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'intent must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF private.is_valid_work_proposal(p_proposal) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invalid proposal envelope' USING ERRCODE = '22023';
  END IF;
  -- Sucessor `proposed` reusando a origem (source_message_id + original_request) do falho.
  INSERT INTO public.work_items(user_id, source_message_id, state, impact_level, capability,
    original_request, intent, proposal, proposal_version)
  VALUES (p_user_id, v_original.source_message_id, 'proposed', p_impact_level, p_capability,
    v_original.original_request, p_intent, p_proposal, 1)
  RETURNING * INTO v_item;
  INSERT INTO public.work_events(work_item_id, event_type, author, proposal_version, payload)
  VALUES (v_item.id, 'work_proposed', 'anima', 1,
    jsonb_build_object('schema_version', 1, 'data', jsonb_build_object('proposal', p_proposal)));
  INSERT INTO public.work_recovery_lineage(user_id, original_work_item_id, successor_work_item_id,
    recovery_sequence, recovery_reason, satisfies_original_objective, idempotency_key)
  VALUES (p_user_id, v_original.id, v_item.id, p_recovery_sequence, btrim(p_recovery_reason), false, p_idempotency_key)
  RETURNING * INTO v_lineage;
  RETURN jsonb_build_object('successorWorkItemId', v_item.id, 'lineageId', v_lineage.id,
    'recoverySequence', v_lineage.recovery_sequence, 'replayed', false, 'state', v_item.state);
END; $$;
REVOKE ALL ON FUNCTION private.record_recovery_successor(uuid,uuid,integer,public.work_impact_level,public.work_capability,jsonb,jsonb,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.record_recovery_successor(uuid,uuid,integer,public.work_impact_level,public.work_capability,jsonb,jsonb,text,uuid) TO service_role;

-- Wrapper autenticado: identidade por auth.uid + allowlist; desfecho maximo = `proposed`.
CREATE FUNCTION public.propose_recovery_successor(
  p_original_work_item_id uuid, p_recovery_sequence integer,
  p_impact_level public.work_impact_level, p_capability public.work_capability,
  p_intent jsonb, p_proposal jsonb, p_recovery_reason text, p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id = v_uid) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE = '42501';
  END IF;
  RETURN private.record_recovery_successor(v_uid, p_original_work_item_id, p_recovery_sequence,
    p_impact_level, p_capability, p_intent, p_proposal, p_recovery_reason, p_idempotency_key);
END; $$;
REVOKE ALL ON FUNCTION public.propose_recovery_successor(uuid,integer,public.work_impact_level,public.work_capability,jsonb,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_recovery_successor(uuid,integer,public.work_impact_level,public.work_capability,jsonb,jsonb,text,uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.propose_recovery_successor(uuid,integer,public.work_impact_level,public.work_capability,jsonb,jsonb,text,uuid) IS
  'Cria, idempotente e owner-scoped, um work item sucessor `proposed` ligado a um original FALHO via work_recovery_lineage. Nao aprova/classifica/executa; nao satisfaz dependencia; nao reseta budget; sem autorizacao financeira.';
