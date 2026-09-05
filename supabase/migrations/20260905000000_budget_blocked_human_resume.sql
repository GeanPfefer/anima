-- Extensão estreita da Human Recovery Authority: +1 attempt para bloqueio de
-- orçamento pré-attempt. Não altera contadores nem cria successor.
CREATE TABLE public.work_budget_resume_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  work_item_id uuid NOT NULL UNIQUE REFERENCES public.work_items(id),
  request_id uuid NOT NULL,
  proposal_version integer NOT NULL CHECK (proposal_version > 0),
  blocked_event_id uuid NOT NULL UNIQUE REFERENCES public.work_events(id),
  budget_reason text NOT NULL CHECK (budget_reason IN ('item_attempt_budget_exhausted','user_attempt_budget_exhausted')),
  authority jsonb NOT NULL,
  additional_attempts integer NOT NULL DEFAULT 1 CHECK (additional_attempts = 1),
  consumed_at timestamptz,
  consumed_attempt_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_id),
  CHECK ((consumed_at IS NULL) = (consumed_attempt_id IS NULL))
);
ALTER TABLE public.work_budget_resume_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_budget_resume_authorizations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.work_budget_resume_authorizations TO authenticated;
CREATE POLICY budget_resume_authorizations_read_own ON public.work_budget_resume_authorizations
  FOR SELECT TO authenticated USING(user_id=auth.uid());

CREATE FUNCTION private.validate_budget_blocked_resume_authorization(p jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
    OR (p-ARRAY['schemaVersion','kind','requestId','reason','additionalAttempts','expectedBudgetReason'])<>'{}'::jsonb
    OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR p->>'kind' IS DISTINCT FROM 'budget_blocked_attempt_v1'
    OR coalesce(p->>'requestId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string'
    OR length(btrim(p->>'reason')) NOT BETWEEN 10 AND 500
    OR p->'additionalAttempts' IS DISTINCT FROM '1'::jsonb
    OR p->>'expectedBudgetReason' NOT IN ('item_attempt_budget_exhausted','user_attempt_budget_exhausted')
  THEN RAISE EXCEPTION 'authorization_invalid' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.validate_budget_blocked_resume_authorization(jsonb) FROM PUBLIC;

-- Overload canônico do mesmo verbo. Concede autoridade, readmite o MESMO item e
-- não inicia claim/attempt/provider/gate.
CREATE FUNCTION public.authorize_work_resume(
  p_work_item_id uuid,
  p_expected_proposal_version integer,
  p_authorization jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  u uuid:=auth.uid(); i public.work_items; b public.work_events;
  old public.work_budget_resume_authorizations; grant_id uuid:=gen_random_uuid();
  reason text; request_id uuid; active_attempt boolean; budget_decision jsonb;
BEGIN
  IF u IS NULL OR NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist WHERE user_id=u)
    THEN RAISE EXCEPTION 'authentication_or_allowlist_required' USING ERRCODE='42501'; END IF;
  PERFORM private.validate_budget_blocked_resume_authorization(p_authorization);
  request_id:=(p_authorization->>'requestId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||u::text,0));
  SELECT * INTO i FROM public.work_items WHERE id=p_work_item_id AND user_id=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_item_not_found' USING ERRCODE='P0002'; END IF;

  SELECT * INTO old FROM public.work_budget_resume_authorizations a
   WHERE a.work_item_id=i.id OR (a.user_id=u AND a.request_id=(p_authorization->>'requestId')::uuid);
  IF FOUND THEN
    IF old.work_item_id<>i.id OR old.proposal_version<>p_expected_proposal_version OR old.authority IS DISTINCT FROM p_authorization
      THEN RAISE EXCEPTION 'authorization_conflict' USING ERRCODE='55000'; END IF;
    RETURN jsonb_build_object('authorizationId',old.id,'workItemId',old.work_item_id,'additionalAttempts',1,
      'budgetReason',old.budget_reason,'consumed',old.consumed_at IS NOT NULL,'replayed',true,'mode','budget_blocked_attempt');
  END IF;

  IF i.state<>'blocked' THEN RAISE EXCEPTION 'work_item_not_budget_blocked' USING ERRCODE='55000'; END IF;
  IF i.proposal_version IS DISTINCT FROM p_expected_proposal_version
    THEN RAISE EXCEPTION 'proposal_version_conflict' USING ERRCODE='55000'; END IF;
  SELECT * INTO b FROM public.work_events e WHERE e.work_item_id=i.id AND e.event_type='work_blocked' ORDER BY e.seq DESC LIMIT 1;
  reason:=b.payload#>>'{data,reason}';
  IF b.id IS NULL OR b.proposal_version<>i.proposal_version OR b.payload#>>'{data,attempt_id}' IS NOT NULL
    OR b.payload#>>'{data,resolution}' IS DISTINCT FROM 'awaits_budget_window'
    OR reason NOT IN ('item_attempt_budget_exhausted','user_attempt_budget_exhausted')
    OR reason IS DISTINCT FROM p_authorization->>'expectedBudgetReason'
    THEN RAISE EXCEPTION 'work_item_not_budget_blocked' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.work_events e WHERE e.work_item_id=i.id AND e.event_type='work_approved' AND e.proposal_version=i.proposal_version)
    OR NOT EXISTS(SELECT 1 FROM public.work_events e WHERE e.work_item_id=i.id AND e.event_type='work_intelligence_classified' AND e.proposal_version=i.proposal_version)
    THEN RAISE EXCEPTION 'approved_classified_proposal_required' USING ERRCODE='55000'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.work_events s WHERE s.work_item_id=i.id AND s.event_type='execution_started'
    AND NOT EXISTS(SELECT 1 FROM public.work_events t WHERE t.work_item_id=i.id AND t.seq>s.seq
      AND t.event_type IN('execution_failed','result_submitted','work_cancelled','attempt_abandoned','work_blocked')
      AND t.payload#>>'{data,attempt_id}'=s.payload#>>'{data,attempt_id}')) INTO active_attempt;
  IF active_attempt OR EXISTS(SELECT 1 FROM public.work_claims c WHERE c.work_item_id=i.id AND c.released_at IS NULL)
    THEN RAISE EXCEPTION 'execution_active' USING ERRCODE='55000'; END IF;

  budget_decision:=private.autonomous_work_budget_decision(u,i.id,now());
  IF coalesce((budget_decision->>'admitted')::boolean,false)
    OR budget_decision->>'reason' IS DISTINCT FROM reason
    THEN RAISE EXCEPTION 'budget_block_no_longer_current' USING ERRCODE='55000'; END IF;

  INSERT INTO public.work_budget_resume_authorizations(id,user_id,work_item_id,request_id,proposal_version,blocked_event_id,budget_reason,authority)
  VALUES(grant_id,u,i.id,request_id,i.proposal_version,b.id,reason,p_authorization);
  UPDATE public.work_items SET state='approved',updated_at=now() WHERE id=i.id;
  INSERT INTO public.work_events(work_item_id,event_type,author,proposal_version,payload)
  VALUES(i.id,'work_approved','user',i.proposal_version,jsonb_build_object('schema_version',1,'data',jsonb_build_object(
    'authority','human_budget_blocked_resume','authorization_id',grant_id,'blocked_event_id',b.id,
    'budget_reason',reason,'additional_attempts',1,'request_id',request_id)));
  RETURN jsonb_build_object('authorizationId',grant_id,'workItemId',i.id,'additionalAttempts',1,
    'budgetReason',reason,'consumed',false,'replayed',false,'mode','budget_blocked_attempt');
END $$;
REVOKE ALL ON FUNCTION public.authorize_work_resume(uuid,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.authorize_work_resume(uuid,integer,jsonb) TO authenticated;

-- A decisão de leitura projeta a concessão ainda não consumida como uma admissão
-- específica, sem tocar nos valores de usage/remaining globais.
CREATE OR REPLACE FUNCTION private.autonomous_work_budget_decision(p_user_id uuid,p_work_item_id uuid,p_observed_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE v_usage jsonb; v_declared integer; v_item_limit integer; v_reason text; v_grant uuid;
BEGIN
  SELECT CASE WHEN jsonb_typeof(i.intent#>'{execution_spec,limits,max_attempts}')='number'
    AND (i.intent#>>'{execution_spec,limits,max_attempts}')~'^[0-9]+$'
    AND (i.intent#>>'{execution_spec,limits,max_attempts}')::integer>0
    THEN (i.intent#>>'{execution_spec,limits,max_attempts}')::integer END INTO v_declared
  FROM public.work_items i WHERE i.id=p_work_item_id AND i.user_id=p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_item_limit:=least(3,coalesce(v_declared,3));
  v_usage:=private.autonomous_work_budget_usage(p_user_id,p_work_item_id,p_observed_at);
  v_reason:=CASE WHEN (v_usage->>'itemAttempts24Hours')::integer>=v_item_limit THEN 'item_attempt_budget_exhausted'
    WHEN (v_usage->>'userAttempts24Hours')::integer>=6 THEN 'user_attempt_budget_exhausted'
    WHEN (v_usage->>'userRuntimeSeconds24Hours')::numeric>=7200 THEN 'user_runtime_budget_exhausted'
    WHEN (v_usage->>'autonomousRuntimeSeconds60Minutes')::numeric>=2700 THEN 'interactive_reserve_protected' END;
  IF v_reason IN ('item_attempt_budget_exhausted','user_attempt_budget_exhausted') THEN
    SELECT a.id INTO v_grant FROM public.work_budget_resume_authorizations a JOIN public.work_items i ON i.id=a.work_item_id
     WHERE a.user_id=p_user_id AND a.work_item_id=p_work_item_id AND a.proposal_version=i.proposal_version
       AND a.budget_reason=v_reason AND a.consumed_at IS NULL;
  END IF;
  RETURN jsonb_build_object('schemaVersion',1,'policyVersion','autonomous-work-budget-v1',
    'admitted',v_reason IS NULL OR v_grant IS NOT NULL,'reason',CASE WHEN v_grant IS NULL THEN v_reason END,
    'humanResumeAuthorizationId',v_grant,'effectiveItemAttemptLimit',v_item_limit,
    'remainingUserAttempts',greatest(0,6-(v_usage->>'userAttempts24Hours')::integer),
    'remainingRuntimeSeconds24Hours',greatest(0,7200-(v_usage->>'userRuntimeSeconds24Hours')::numeric),
    'remainingAutonomousRuntimeSeconds60Minutes',greatest(0,2700-(v_usage->>'autonomousRuntimeSeconds60Minutes')::numeric),'usage',v_usage);
END $$;

CREATE OR REPLACE FUNCTION private.enforce_autonomous_work_budget() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_uid uuid; v_decision jsonb; v_grant uuid;
BEGIN
  IF NEW.event_type<>'execution_started' OR NOT (NEW.payload->'data' ? 'claim_id') OR NEW.payload->'data'->>'claim_id' IS NULL THEN RETURN NEW; END IF;
  SELECT i.user_id INTO v_uid FROM public.work_items i WHERE i.id=NEW.work_item_id;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('autonomous_work_budget:'||v_uid::text,0));
  v_decision:=private.autonomous_work_budget_decision(v_uid,NEW.work_item_id,now());
  IF NOT coalesce((v_decision->>'admitted')::boolean,false) THEN RAISE EXCEPTION '%',v_decision->>'reason' USING ERRCODE='P0001',DETAIL=v_decision::text; END IF;
  v_grant:=(v_decision->>'humanResumeAuthorizationId')::uuid;
  IF v_grant IS NOT NULL THEN
    UPDATE public.work_budget_resume_authorizations SET consumed_at=now(),consumed_attempt_id=(NEW.payload#>>'{data,attempt_id}')::uuid
     WHERE id=v_grant AND consumed_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'budget_resume_authorization_consumed' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;
