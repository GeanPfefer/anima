-- Persiste somente um receipt de review request já verificado por um provider.
-- NÃO cria PR, não faz push, não muda o estado do item, não registra integrated.
-- Exige a branch já publicada e verificada (ordenação do protocolo ADR-002:
-- integration_authorized -> branch_published -> review_request_created) e amarra o
-- receipt de review ao receipt de branch persistido (source/commit/base/provider/
-- repo/remote). Sem provider real, este fato nunca é produzido em produção: a
-- criação real de review request permanece a próxima fronteira humana.
CREATE UNIQUE INDEX work_events_review_request_authorization_idx
  ON public.work_events ((payload->'data'->>'authorization_decision_id'))
  WHERE event_type='review_request_created';

CREATE FUNCTION public.record_review_request_created(work_item_id uuid,expected_proposal_version integer,authorization_decision_id text,receipt jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user uuid:=auth.uid();v_item public.work_items;v_decision public.work_events;v_accept public.work_events;v_result public.work_events;v_handoff jsonb;v_branch public.work_events;v_breceipt jsonb;v_existing public.work_events;v_seq bigint;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user) THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
 IF expected_proposal_version<1 OR length(btrim(coalesce(authorization_decision_id,'')))=0 OR jsonb_typeof(receipt)<>'object' THEN RAISE EXCEPTION 'invalid review request input' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
 IF v_item.state<>'completed' OR v_item.proposal_version<>expected_proposal_version THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_decision FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='integration_decided' AND e.payload->'data'->>'decision_id'=authorization_decision_id ORDER BY e.seq DESC LIMIT 1;
 IF NOT FOUND OR v_decision.payload->'data'->>'decision'<>'authorize' THEN RAISE EXCEPTION 'integration authorization not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_accept FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='result_accepted' ORDER BY e.seq DESC LIMIT 1;
 IF NOT FOUND OR v_accept.payload->'data'->>'accepted_result_event_id' IS DISTINCT FROM v_decision.payload->'data'->>'accepted_result_event_id' THEN RAISE EXCEPTION 'accepted result changed' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_result FROM public.work_events e WHERE e.id=(v_accept.payload->'data'->>'accepted_result_event_id')::uuid AND e.work_item_id=v_item.id AND e.event_type='result_submitted';
 v_handoff:=v_result.payload->'data'->'executor_signal'->'worktreeHandoff';
 IF v_handoff IS NULL THEN RAISE EXCEPTION 'worktree handoff not found' USING ERRCODE='P0002'; END IF;
 -- Ordenação: exige a branch já publicada e verificada para esta autorização.
 SELECT * INTO v_branch FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='branch_published' AND e.payload->'data'->>'authorization_decision_id'=authorization_decision_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'branch publication required before review request' USING ERRCODE='P0002'; END IF;
 v_breceipt:=v_branch.payload->'data'->'receipt';
 -- Valida o receipt de review contra o handoff E o receipt de branch persistido.
 IF receipt->>'kind'<>'review_request'
   OR receipt->>'idempotencyKey'<>('integration-publication:'||authorization_decision_id||':'||(v_handoff->>'commitSha')||':review')
   OR receipt->>'sourceBranch' IS DISTINCT FROM v_handoff->>'branch' OR receipt->>'sourceCommitSha' IS DISTINCT FROM v_handoff->>'commitSha'
   OR receipt->>'verifiedBaseSha' IS DISTINCT FROM v_handoff->>'baseSha'
   OR receipt->>'sourceBranch' IS DISTINCT FROM v_breceipt->>'remoteBranch' OR receipt->>'sourceCommitSha' IS DISTINCT FROM v_breceipt->>'commitSha'
   OR receipt->>'verifiedBaseSha' IS DISTINCT FROM v_breceipt->>'verifiedBaseSha' OR receipt->>'baseBranch' IS DISTINCT FROM v_breceipt->>'baseBranch'
   OR receipt->>'providerId' IS DISTINCT FROM v_breceipt->>'providerId' OR receipt->>'repositoryId' IS DISTINCT FROM v_breceipt->>'repositoryId'
   OR receipt->>'remoteName' IS DISTINCT FROM v_breceipt->>'remoteName'
   OR length(btrim(coalesce(receipt->>'receiptId','')))=0 OR length(btrim(coalesce(receipt->>'reviewId','')))=0
   OR length(btrim(coalesce(receipt->>'reviewReference','')))=0 OR receipt->>'state'<>'open'
   OR receipt->>'disposition' NOT IN ('created','already_existed')
   OR v_handoff->>'workItemId'<>v_item.id::text OR v_handoff->>'attemptId' IS DISTINCT FROM v_decision.payload->'data'->>'attempt_id'
   OR (v_handoff->>'approvedProposalVersion')::integer<>expected_proposal_version
 THEN RAISE EXCEPTION 'review request receipt mismatch' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_existing FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='review_request_created' AND e.payload->'data'->>'authorization_decision_id'=authorization_decision_id;
 IF FOUND THEN IF v_existing.payload->'data'->'receipt'=receipt THEN RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq); END IF;RAISE EXCEPTION 'review request receipt conflict' USING ERRCODE='55000'; END IF;
 INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(v_item.id,'review_request_created','system',expected_proposal_version,jsonb_build_object('schema_version',1,'data',jsonb_build_object('authorization_decision_id',authorization_decision_id,'accepted_result_event_id',v_accept.payload->'data'->>'accepted_result_event_id','attempt_id',v_decision.payload->'data'->>'attempt_id','receipt',receipt))) RETURNING seq INTO v_seq;
 RETURN jsonb_build_object('action','recorded','event_seq',v_seq);
END $$;
REVOKE ALL ON FUNCTION public.record_review_request_created(uuid,integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_review_request_created(uuid,integer,text,jsonb) TO authenticated,service_role;
