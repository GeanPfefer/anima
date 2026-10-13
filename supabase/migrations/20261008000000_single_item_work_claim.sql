-- Single-Item V1: compõe a aquisição canônica na MESMA transação.
-- Não recompila acquire_work_claim, não altera índices, orçamento ou fluxo global.
CREATE FUNCTION public.acquire_single_item_work_claim(
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
  v_target text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF claim_id IS NULL OR expected_proposal_version IS NULL OR expected_proposal_version < 1
     OR owner_instance_id IS NULL OR length(btrim(owner_instance_id))=0
     OR lease_seconds IS NULL OR lease_seconds <= 0 THEN
    RAISE EXCEPTION 'invalid claim request' USING ERRCODE='22023';
  END IF;

  -- Mesma ordem item -> alvo da aquisição canônica. O início sob claim
  -- bloqueia primeiro o claim; sua ordem distinta ainda requer prova real.
  SELECT * INTO v_item FROM public.work_items i
    WHERE i.id=work_item_id AND i.user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  v_target := btrim(v_item.intent #>> '{execution_spec,target,reference}');
  IF v_target IS NULL OR length(v_target)=0
     OR jsonb_typeof(v_item.intent #> '{execution_spec,target,reference}') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'execution target missing' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_target:'||v_user_id::text||':'||v_target, 0));

  -- Não bloqueia linhas alheias: o lock de alvo serializa suas aquisições.
  -- Sem filtro de expires_at: vencido ainda aberto também exige recusa.
  IF EXISTS (
    SELECT 1 FROM public.work_claims c
    WHERE c.user_id=v_user_id AND c.target_reference=v_target
      AND c.work_item_id<>v_item.id AND c.released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'single_item_foreign_claim_open' USING ERRCODE='55000';
  END IF;

  -- Locks transacionais/reentrantes permanecem até COMMIT/ROLLBACK externo.
  -- Reutiliza estado/versão, replay, ocupação in_progress, triggers de
  -- classificação, substituição auditável do claim PRÓPRIO e índices únicos.
  RETURN public.acquire_work_claim(
    v_item.id, expected_proposal_version, claim_id, owner_instance_id, lease_seconds);
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_single_item_work_claim(uuid,integer,uuid,text,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acquire_single_item_work_claim(uuid,integer,uuid,text,integer)
  TO authenticated;
COMMENT ON FUNCTION public.acquire_single_item_work_claim(uuid,integer,uuid,text,integer) IS
  'Aquisição scoped: recusa claim aberto alheio inclusive vencido, sob os locks canônicos de item e alvo, antes de delegar a acquire_work_claim na mesma transação. Claim não inicia attempt; start_claimed_work_attempt preserva orçamento/classificação. Não faz manutenção global.';
