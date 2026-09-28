-- Completed → Integrated V0 (2026-09-28): autorização humana de UM efeito Git e receipt
-- persistido do efeito observado. Não executa Git, não muda o estado do item.
--
-- Fronteiras:
--   completed ≠ integrated; aceite ≠ autorização de merge ≠ execução.
--   `integration_decided` (V1) NÃO serve como autorização de merge.
--   Alvo V0: SOMENTE refs/heads/dev; qualquer outro (main, origin/main, …) é negado.
--   Modo V0: SOMENTE merge_no_ff.
--   O commit do resultado e a attempt são DERIVADOS dos fatos persistidos (handoff do
--   resultado aceito) — nunca fornecidos pelo chamador.

CREATE UNIQUE INDEX work_events_integration_effect_authorization_idx
  ON public.work_events ((payload->'data'->>'authorization_id'))
  WHERE event_type='integration_effect_authorized';

-- Um receipt por autorização E no máximo uma integração concluída por item (V0).
CREATE UNIQUE INDEX work_events_integration_completed_authorization_idx
  ON public.work_events ((payload->'data'->>'authorization_id'))
  WHERE event_type='integration_completed';
CREATE UNIQUE INDEX work_events_integration_completed_item_idx
  ON public.work_events (work_item_id)
  WHERE event_type='integration_completed';

CREATE OR REPLACE FUNCTION private.is_sha1_hex(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT p IS NOT NULL AND p ~ '^[a-f0-9]{40}$';
$$;

-- ─── Autorização humana específica do efeito ─────────────────────────────────

CREATE FUNCTION public.authorize_integration_effect(
  work_item_id uuid,
  expected_proposal_version integer,
  accepted_result_event_id uuid,
  authorization_id text,
  repository_id text,
  target_ref text,
  expected_target_sha text,
  mode text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v_user uuid:=auth.uid(); v_item public.work_items; v_accept public.work_events; v_result public.work_events;
  v_handoff jsonb; v_commit text; v_attempt text; v_key text; v_data jsonb; v_existing public.work_events; v_seq bigint;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version<1 OR accepted_result_event_id IS NULL
     OR length(btrim(coalesce(authorization_id,'')))=0 OR length(btrim(coalesce(repository_id,'')))=0
     OR NOT private.is_sha1_hex(expected_target_sha) THEN
    RAISE EXCEPTION 'invalid integration effect authorization' USING ERRCODE='22023';
  END IF;
  -- Alvo e modo fixos no V0: dev e merge --no-ff. main e qualquer outro alvo: negados.
  IF target_ref IS DISTINCT FROM 'refs/heads/dev' THEN
    RAISE EXCEPTION 'integration target not allowed' USING ERRCODE='22023';
  END IF;
  IF mode IS DISTINCT FROM 'merge_no_ff' THEN
    RAISE EXCEPTION 'integration mode not allowed' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state<>'completed' OR v_item.proposal_version<>expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;

  -- O resultado autorizado é EXATAMENTE o último aceito.
  SELECT * INTO v_accept FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='result_accepted' ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'accepted result not found' USING ERRCODE='P0002'; END IF;
  IF (v_accept.payload->'data'->>'accepted_result_event_id') IS DISTINCT FROM accepted_result_event_id::text THEN
    RAISE EXCEPTION 'accepted result changed' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_result FROM public.work_events e
  WHERE e.id=accepted_result_event_id AND e.work_item_id=v_item.id AND e.event_type='result_submitted'
    AND e.proposal_version=expected_proposal_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'accepted result not found' USING ERRCODE='P0002'; END IF;

  -- Identidade do efeito DERIVADA do handoff persistido (o chamador não fornece SHA nem branch).
  v_handoff:=v_result.payload->'data'->'executor_signal'->'worktreeHandoff';
  v_commit:=v_handoff->>'commitSha';
  v_attempt:=v_result.payload->'data'->>'attempt_id';
  IF v_handoff IS NULL OR NOT private.is_sha1_hex(v_commit) OR v_attempt IS NULL
     OR v_handoff->>'attemptId' IS DISTINCT FROM v_attempt
     OR v_handoff->>'workItemId' IS DISTINCT FROM v_item.id::text
     OR (v_handoff->>'approvedProposalVersion')::integer IS DISTINCT FROM expected_proposal_version THEN
    RAISE EXCEPTION 'result commit not derivable' USING ERRCODE='P0002';
  END IF;
  IF EXISTS(SELECT 1 FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='integration_completed') THEN
    RAISE EXCEPTION 'work item already integrated' USING ERRCODE='55000';
  END IF;

  v_key:='integration-effect:'||authorization_id||':'||accepted_result_event_id::text||':'||repository_id||':'
    ||target_ref||':'||expected_target_sha||':'||v_commit||':'||mode;
  v_data:=jsonb_build_object(
    'authorization_id',authorization_id,'operation_key',v_key,
    'work_item_id',v_item.id,'approved_proposal_version',expected_proposal_version,'attempt_id',v_attempt,
    'accepted_result_event_id',accepted_result_event_id,'result_commit_sha',v_commit,
    'repository_id',repository_id,'target_ref',target_ref,'expected_target_sha',expected_target_sha,'mode',mode);

  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.event_type='integration_effect_authorized' AND e.payload->'data'->>'authorization_id'=authorization_id;
  IF FOUND THEN
    IF v_existing.work_item_id=v_item.id AND v_existing.payload->'data'=v_data THEN
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq,'operation_key',v_key,'result_commit_sha',v_commit);
    END IF;
    RAISE EXCEPTION 'integration effect authorization conflict' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'integration_effect_authorized','user',expected_proposal_version,jsonb_build_object('schema_version',1,'data',v_data))
  RETURNING seq INTO v_seq;
  RETURN jsonb_build_object('action','recorded','event_seq',v_seq,'operation_key',v_key,'result_commit_sha',v_commit);
END $$;
REVOKE ALL ON FUNCTION public.authorize_integration_effect(uuid,integer,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_integration_effect(uuid,integer,uuid,text,text,text,text,text) TO authenticated,service_role;

-- ─── Receipt do efeito OBSERVADO ─────────────────────────────────────────────

CREATE FUNCTION public.record_integration_completed(
  work_item_id uuid,
  expected_proposal_version integer,
  authorization_id text,
  receipt jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v_user uuid:=auth.uid(); v_item public.work_items; v_auth public.work_events; v_accept public.work_events;
  v_a jsonb; v_existing public.work_events; v_seq bigint;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  IF expected_proposal_version IS NULL OR expected_proposal_version<1 OR length(btrim(coalesce(authorization_id,'')))=0
     OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid integration receipt' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.state<>'completed' OR v_item.proposal_version<>expected_proposal_version THEN
    RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_auth FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='integration_effect_authorized'
    AND e.payload->'data'->>'authorization_id'=authorization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'integration effect authorization not found' USING ERRCODE='P0002'; END IF;
  v_a:=v_auth.payload->'data';
  SELECT * INTO v_accept FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='result_accepted' ORDER BY e.seq DESC LIMIT 1;
  IF NOT FOUND OR (v_accept.payload->'data'->>'accepted_result_event_id') IS DISTINCT FROM v_a->>'accepted_result_event_id' THEN
    RAISE EXCEPTION 'accepted result changed' USING ERRCODE='55000';
  END IF;

  -- O receipt reproduz EXATAMENTE a autorização e descreve o efeito observado:
  -- merge commit com pais [SHA-alvo esperado, commit do resultado] e alvo = merge.
  IF receipt->>'kind' IS DISTINCT FROM 'integration_effect'
     OR receipt->>'operationKey' IS DISTINCT FROM v_a->>'operation_key'
     OR receipt->>'authorizationId' IS DISTINCT FROM authorization_id
     OR receipt->>'workItemId' IS DISTINCT FROM v_item.id::text
     OR (receipt->>'proposalVersion')::integer IS DISTINCT FROM expected_proposal_version
     OR receipt->>'attemptId' IS DISTINCT FROM v_a->>'attempt_id'
     OR receipt->>'acceptedResultEventId' IS DISTINCT FROM v_a->>'accepted_result_event_id'
     OR receipt->>'resultCommitSha' IS DISTINCT FROM v_a->>'result_commit_sha'
     OR receipt->>'repositoryId' IS DISTINCT FROM v_a->>'repository_id'
     OR receipt->>'targetRef' IS DISTINCT FROM v_a->>'target_ref'
     OR receipt->>'mode' IS DISTINCT FROM v_a->>'mode'
     OR receipt->>'previousTargetSha' IS DISTINCT FROM v_a->>'expected_target_sha'
     OR NOT private.is_sha1_hex(receipt->>'mergeCommitSha')
     OR receipt->>'resultingTargetSha' IS DISTINCT FROM receipt->>'mergeCommitSha'
     OR receipt->'mergeParents' IS DISTINCT FROM jsonb_build_array(v_a->>'expected_target_sha',v_a->>'result_commit_sha')
     OR receipt->'observed' IS DISTINCT FROM 'true'::jsonb
     OR receipt->>'disposition' NOT IN ('effected','reconciled') THEN
    RAISE EXCEPTION 'integration receipt mismatch' USING ERRCODE='55000';
  END IF;

  SELECT * INTO v_existing FROM public.work_events e
  WHERE e.work_item_id=v_item.id AND e.event_type='integration_completed';
  IF FOUND THEN
    -- Idempotência por identidade do EFEITO (a disposição pode diferir entre execução e reconciliação).
    IF v_existing.payload->'data'->>'authorization_id'=authorization_id
       AND (v_existing.payload->'data'->'receipt') - 'disposition' = receipt - 'disposition' THEN
      RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq);
    END IF;
    RAISE EXCEPTION 'integration receipt conflict' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(v_item.id,'integration_completed','system',expected_proposal_version,jsonb_build_object('schema_version',1,'data',
    jsonb_build_object('authorization_id',authorization_id,'operation_key',v_a->>'operation_key',
      'accepted_result_event_id',v_a->>'accepted_result_event_id','attempt_id',v_a->>'attempt_id','receipt',receipt)))
  RETURNING seq INTO v_seq;
  RETURN jsonb_build_object('action','recorded','event_seq',v_seq);
END $$;
REVOKE ALL ON FUNCTION public.record_integration_completed(uuid,integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_integration_completed(uuid,integer,text,jsonb) TO authenticated,service_role;

COMMENT ON FUNCTION public.authorize_integration_effect(uuid,integer,uuid,text,text,text,text,text) IS
  'Completed → Integrated V0: autorização HUMANA de um efeito Git exato (merge --no-ff do commit do resultado aceito em refs/heads/dev, sobre expected_target_sha). Commit e attempt derivados do handoff persistido. Só refs/heads/dev e merge_no_ff. Não executa Git nem muda estado. integration_decided (V1) não é aceito como autorização de merge.';
COMMENT ON FUNCTION public.record_integration_completed(uuid,integer,text,jsonb) IS
  'Completed → Integrated V0: persiste o receipt de um efeito Git OBSERVADO que reproduz exatamente a autorização (pais [expected, commit], alvo = merge). Append-only, idempotente por identidade do efeito; divergência = conflito. Item continua completed.';
