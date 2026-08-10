-- Corrige recuperação sob resultado incerto: created/already_existed descrevem
-- como o mesmo efeito foi observado, não identidades externas diferentes.
DROP INDEX public.work_events_branch_publication_authorization_idx;
CREATE UNIQUE INDEX work_events_branch_publication_authorization_idx
  ON public.work_events (work_item_id,(payload->'data'->>'authorization_decision_id'))
  WHERE event_type='branch_published';

CREATE OR REPLACE FUNCTION public.record_branch_published(work_item_id uuid,expected_proposal_version integer,authorization_decision_id text,receipt jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user uuid:=auth.uid();v_item public.work_items;v_decision public.work_events;v_accept public.work_events;v_result public.work_events;v_handoff jsonb;v_existing public.work_events;v_seq bigint;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user) THEN RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501'; END IF;
 IF expected_proposal_version IS NULL OR expected_proposal_version<1 OR length(btrim(coalesce(authorization_decision_id,'')))=0 OR jsonb_typeof(receipt)<>'object' THEN RAISE EXCEPTION 'invalid branch publication input' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_item FROM public.work_items i WHERE i.id=work_item_id AND i.user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
 IF v_item.state<>'completed' OR v_item.proposal_version<>expected_proposal_version THEN RAISE EXCEPTION 'work item state or proposal version changed' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_decision FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='integration_decided' AND e.payload->'data'->>'decision_id'=authorization_decision_id ORDER BY e.seq DESC LIMIT 1;
 IF NOT FOUND OR v_decision.payload->'data'->>'decision'<>'authorize' THEN RAISE EXCEPTION 'integration authorization not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_accept FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='result_accepted' ORDER BY e.seq DESC LIMIT 1;
 IF NOT FOUND OR v_accept.payload->'data'->>'accepted_result_event_id' IS DISTINCT FROM v_decision.payload->'data'->>'accepted_result_event_id' OR v_accept.seq>=v_decision.seq THEN RAISE EXCEPTION 'accepted result changed' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_result FROM public.work_events e WHERE e.id=(v_accept.payload->'data'->>'accepted_result_event_id')::uuid AND e.work_item_id=v_item.id AND e.event_type='result_submitted' AND e.seq<v_accept.seq;
 IF NOT FOUND THEN RAISE EXCEPTION 'accepted result not found' USING ERRCODE='P0002'; END IF;
 v_handoff:=v_result.payload->'data'->'executor_signal'->'worktreeHandoff';
 IF v_handoff IS NULL THEN RAISE EXCEPTION 'worktree handoff not found' USING ERRCODE='P0002'; END IF;
 IF receipt->>'kind'<>'branch_publication' OR receipt->>'idempotencyKey'<>('integration-publication:'||authorization_decision_id||':'||(v_handoff->>'commitSha')||':branch')
   OR receipt->>'remoteBranch' IS DISTINCT FROM v_handoff->>'branch' OR receipt->>'commitSha' IS DISTINCT FROM v_handoff->>'commitSha' OR receipt->>'verifiedBaseSha' IS DISTINCT FROM v_handoff->>'baseSha'
   OR length(btrim(coalesce(receipt->>'receiptId','')))=0 OR length(btrim(coalesce(receipt->>'providerId','')))=0 OR length(btrim(coalesce(receipt->>'repositoryId','')))=0 OR length(btrim(coalesce(receipt->>'remoteName','')))=0 OR length(btrim(coalesce(receipt->>'baseBranch','')))=0
   OR receipt->>'disposition' NOT IN ('created','already_existed') OR v_handoff->>'workItemId'<>v_item.id::text OR v_handoff->>'attemptId' IS DISTINCT FROM v_decision.payload->'data'->>'attempt_id' OR (v_handoff->>'approvedProposalVersion')::integer<>expected_proposal_version
 THEN RAISE EXCEPTION 'branch publication receipt mismatch' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_existing FROM public.work_events e WHERE e.work_item_id=v_item.id AND e.event_type='branch_published' AND e.payload->'data'->>'authorization_decision_id'=authorization_decision_id;
 IF FOUND THEN IF (v_existing.payload->'data'->'receipt')-'disposition'=receipt-'disposition' THEN RETURN jsonb_build_object('action','replayed','event_seq',v_existing.seq); END IF;RAISE EXCEPTION 'branch publication receipt conflict' USING ERRCODE='55000'; END IF;
 INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload) VALUES(v_item.id,'branch_published','system',expected_proposal_version,jsonb_build_object('schema_version',1,'data',jsonb_build_object('authorization_decision_id',authorization_decision_id,'accepted_result_event_id',v_accept.payload->'data'->>'accepted_result_event_id','attempt_id',v_decision.payload->'data'->>'attempt_id','receipt',receipt))) RETURNING seq INTO v_seq;
 RETURN jsonb_build_object('action','recorded','event_seq',v_seq);
END $$;
