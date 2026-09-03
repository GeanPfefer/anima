-- One explicit human extension per exhausted replan envelope; past authority is immutable.
CREATE TABLE public.work_resume_authorizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 actor text NOT NULL DEFAULT 'user' CHECK(actor='user'),
 request_id uuid NOT NULL,
 envelope_root_id uuid NOT NULL UNIQUE REFERENCES public.work_items(id),
 predecessor_id uuid NOT NULL UNIQUE REFERENCES public.work_items(id),
 failure_event_id uuid NOT NULL REFERENCES public.work_events(id),
 source_attempt_id uuid NOT NULL,
 authority jsonb NOT NULL,
 previous_authorized integer NOT NULL,
 previous_consumed integer NOT NULL,
 additional_attempts integer NOT NULL CHECK(additional_attempts=1),
 aggregate_ceiling integer NOT NULL CHECK(aggregate_ceiling BETWEEN 2 AND 4),
 successor_id uuid NOT NULL UNIQUE REFERENCES public.work_items(id),
 lineage_id uuid NOT NULL REFERENCES public.work_recovery_lineage(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_id),
 CHECK(previous_consumed=previous_authorized AND aggregate_ceiling=previous_authorized+additional_attempts)
);
ALTER TABLE public.work_resume_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_resume_authorizations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.work_resume_authorizations TO authenticated;
CREATE POLICY resume_authorizations_read_own ON public.work_resume_authorizations FOR SELECT TO authenticated USING(user_id=auth.uid());

CREATE FUNCTION private.validate_resume_authorization(p jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE d jsonb:=p->'diagnosis'; c jsonb:=p->'compute';
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (p-ARRAY['schemaVersion','requestId','reason','additionalAttempts','aggregateCeiling','diagnosis','planRevision','compute'])<>'{}'::jsonb
 OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR p->'additionalAttempts' IS DISTINCT FROM '1'::jsonb
 OR coalesce(p->>'requestId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR length(btrim(p->>'reason')) NOT BETWEEN 10 AND 500
 OR NOT (p->'aggregateCeiling' IN ('2'::jsonb,'3'::jsonb,'4'::jsonb))
 OR p->>'planRevision' IS DISTINCT FROM 'inspect_existing_exports_and_current_reads_v1'
 OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR (d-ARRAY['reference','priorApiAssumption','correctedApiAssumption','apiPath','exports','syntaxFailure','anchorFailure'])<>'{}'::jsonb
 OR coalesce(d->>'reference','') !~ '^docs/registros/[A-Za-z0-9_-]+\.md$'
 OR d->>'priorApiAssumption' IS DISTINCT FROM 'exports_absent' OR d->>'correctedApiAssumption' IS DISTINCT FROM 'exports_present'
 OR d->>'syntaxFailure' IS DISTINCT FROM 'unbalanced_block' OR d->>'anchorFailure' IS DISTINCT FROM 'no_match_cause_unproven'
 OR coalesce(d->>'apiPath','') !~ '^[A-Za-z0-9_/-]+\.[ct]sx?$' OR d->>'apiPath' ~ '(^/|\.\.)'
 OR jsonb_typeof(d->'exports') IS DISTINCT FROM 'array'
 OR jsonb_typeof(c) IS DISTINCT FROM 'object' OR (c-ARRAY['placement','preferred','fallback','paid'])<>'{}'::jsonb
 OR c->>'placement' IS DISTINCT FROM 'local' OR c->'paid' IS DISTINCT FROM 'false'::jsonb
 OR coalesce(c->>'preferred','') !~ '^[A-Za-z0-9_.:-]{1,100}$' OR coalesce(c->>'fallback','') !~ '^[A-Za-z0-9_.:-]{1,100}$'
 THEN RAISE EXCEPTION 'authorization_invalid' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(d->'exports') NOT BETWEEN 1 AND 8 OR EXISTS(SELECT 1 FROM jsonb_array_elements(d->'exports') s WHERE jsonb_typeof(s)<>'string' OR s#>>'{}' !~ '^[A-Za-z_$][A-Za-z0-9_$]{0,79}$')
 OR (SELECT count(DISTINCT s) FROM jsonb_array_elements(d->'exports') s)<>jsonb_array_length(d->'exports') THEN
 RAISE EXCEPTION 'authorization_invalid' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.validate_resume_authorization(jsonb) FROM PUBLIC;

CREATE FUNCTION public.authorize_work_resume(p_work_item_id uuid,p_expected_proposal_version integer,p_failure_event_id uuid,p_authorization jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u uuid:=auth.uid(); i public.work_items; root public.work_items; r public.work_replans;
 f public.work_events; h public.work_events; g public.work_events; old public.work_resume_authorizations;
 a uuid; used integer; total integer; maximum integer; spec jsonb; proposal jsonb; checkpoint jsonb; envelope jsonb; seq integer; grant_id uuid:=gen_random_uuid();
BEGIN
 IF u IS NULL OR NOT EXISTS(SELECT 1 FROM private.work_orchestration_allowlist WHERE user_id=u) THEN RAISE EXCEPTION 'authentication_or_allowlist_required' USING ERRCODE='42501'; END IF;
 PERFORM private.validate_resume_authorization(p_authorization);
 SELECT * INTO i FROM public.work_items WHERE id=p_work_item_id AND user_id=u FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'work_item_not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO old FROM public.work_resume_authorizations WHERE predecessor_id=i.id OR (user_id=u AND request_id=(p_authorization->>'requestId')::uuid);
 IF FOUND THEN
  IF old.predecessor_id<>i.id OR old.failure_event_id IS DISTINCT FROM p_failure_event_id OR i.proposal_version IS DISTINCT FROM p_expected_proposal_version OR old.authority IS DISTINCT FROM p_authorization THEN RAISE EXCEPTION 'authorization_conflict' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('authorizationId',old.id,'successorWorkItemId',old.successor_id,'lineageId',old.lineage_id,'additionalAttempts',old.additional_attempts,'aggregateCeiling',old.aggregate_ceiling,'previousConsumed',old.previous_consumed,'replayed',true);
 END IF;
 IF i.state<>'failed' OR i.proposal_version IS DISTINCT FROM p_expected_proposal_version THEN RAISE EXCEPTION 'predecessor_not_current_failed' USING ERRCODE='55000'; END IF;
 SELECT * INTO r FROM public.work_replans WHERE successor_id=i.id AND user_id=u;
 IF NOT FOUND THEN RAISE EXCEPTION 'exhausted_replan_required' USING ERRCODE='55000'; END IF;
 SELECT * INTO root FROM public.work_items WHERE id=r.predecessor_id AND user_id=u FOR UPDATE;
 IF root.id IS NULL OR root.state<>'failed' OR EXISTS(SELECT 1 FROM public.work_resume_authorizations WHERE envelope_root_id=root.id)
 OR EXISTS(SELECT 1 FROM public.work_recovery_lineage WHERE original_work_item_id=i.id)
 THEN RAISE EXCEPTION 'authority_already_allocated' USING ERRCODE='55000'; END IF;
 SELECT * INTO f FROM public.work_events WHERE work_item_id=i.id AND event_type IN ('execution_failed','result_submitted','work_cancelled','attempt_abandoned') ORDER BY seq DESC LIMIT 1;
 IF f.id IS DISTINCT FROM p_failure_event_id OR f.event_type<>'execution_failed' OR f.proposal_version<>i.proposal_version OR f.payload#>'{data,retryable}' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'retryable_failure_required' USING ERRCODE='55000'; END IF;
 a:=(f.payload#>>'{data,attempt_id}')::uuid;
 IF a IS NULL OR NOT EXISTS(SELECT 1 FROM public.work_events WHERE work_item_id=i.id AND event_type='execution_started' AND payload#>>'{data,attempt_id}'=a::text) THEN RAISE EXCEPTION 'attempt_missing' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM public.work_claims WHERE work_item_id IN(i.id,root.id) AND released_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.work_events s WHERE s.work_item_id IN(i.id,root.id) AND s.event_type='execution_started' AND NOT EXISTS(SELECT 1 FROM public.work_events t WHERE t.work_item_id=s.work_item_id AND t.seq>s.seq AND t.event_type IN('execution_failed','result_submitted','work_cancelled','attempt_abandoned') AND t.payload#>>'{data,attempt_id}'=s.payload#>>'{data,attempt_id}')) THEN RAISE EXCEPTION 'execution_active' USING ERRCODE='55000'; END IF;
 SELECT count(DISTINCT payload#>>'{data,attempt_id}') INTO used FROM public.work_events WHERE work_item_id=i.id AND event_type='execution_started';
 maximum:=(i.intent#>>'{execution_spec,limits,max_attempts}')::integer;
 IF maximum IS NULL OR used<>maximum OR maximum<>r.allocated_attempts THEN RAISE EXCEPTION 'budget_not_exhausted' USING ERRCODE='55000'; END IF;
 WITH RECURSIVE tree(id) AS (SELECT root.id UNION SELECT l.successor_work_item_id FROM public.work_recovery_lineage l JOIN tree ON l.original_work_item_id=tree.id)
 SELECT count(DISTINCT e.payload#>>'{data,attempt_id}') INTO total FROM public.work_events e JOIN tree ON e.work_item_id=tree.id WHERE e.event_type='execution_started';
 IF total<>r.predecessor_max_attempts OR total+1<>(p_authorization->>'aggregateCeiling')::integer OR (root.intent#>>'{execution_spec,limits,max_attempts}')::integer<>r.predecessor_max_attempts THEN RAISE EXCEPTION 'aggregate_ceiling_mismatch' USING ERRCODE='55000'; END IF;
 spec:=i.intent->'execution_spec';
 IF i.impact_level<>'low' OR i.capability<>'programming' OR jsonb_array_length(i.proposal#>'{data,included_scope}')<>1
 OR coalesce(i.proposal#>>'{data,included_scope,0}','') !~ '^[A-Za-z0-9_/-]+\.(test|spec)\.[ct]sx?$'
 OR NOT (i.proposal#>'{data,excluded_scope}' @> jsonb_build_array(p_authorization#>>'{diagnosis,apiPath}'))
 OR spec->>'coder_backend' IS DISTINCT FROM 'ollama' OR spec->>'executor' IS DISTINCT FROM 'worktree' OR spec#>>'{target,kind}' IS DISTINCT FROM 'project'
 OR spec->'permissions' IS DISTINCT FROM '["workspace_read","workspace_write_isolated"]'::jsonb
 OR spec->>'model' IS DISTINCT FROM p_authorization#>>'{compute,preferred}' OR spec ? 'human_resume'
 THEN RAISE EXCEPTION 'execution_envelope_unsupported' USING ERRCODE='55000'; END IF;
 SELECT * INTO h FROM public.work_events WHERE work_item_id=i.id AND proposal_version=i.proposal_version AND event_type='host_observed_evidence_recorded' AND author='system' AND payload#>>'{data,origin}'='host' AND payload#>>'{data,attempt_id}'=a::text ORDER BY seq DESC LIMIT 1;
 SELECT * INTO g FROM public.work_events WHERE work_item_id=i.id AND proposal_version=i.proposal_version AND event_type='host_observed_gate_evidence_recorded' AND author='system' AND payload#>>'{data,origin}'='host' AND payload#>>'{data,attempt_id}'=a::text ORDER BY seq DESC LIMIT 1;
 IF h.id IS NULL OR g.id IS NULL OR h.payload#>>'{data,evidence,attemptId}' IS DISTINCT FROM a::text OR h.payload#>>'{data,evidence,workItemId}' IS DISTINCT FROM i.id::text
 OR g.payload#>>'{data,evidence,attemptId}' IS DISTINCT FROM a::text OR g.payload#>>'{data,evidence,workItemId}' IS DISTINCT FROM i.id::text
 OR coalesce(h.payload#>'{data,evidence,observedChangedFilesSinceStart}',h.payload#>'{data,evidence,observedChangedFiles}') IS DISTINCT FROM i.proposal#>'{data,included_scope}' THEN RAISE EXCEPTION 'host_evidence_missing_or_scope_changed' USING ERRCODE='55000'; END IF;
 checkpoint:=jsonb_build_object('base_sha',h.payload#>>'{data,evidence,baseSha}','commit_sha',h.payload#>>'{data,evidence,observedCommitSha}','branch','anima-work/'||a::text);
 IF coalesce(checkpoint->>'base_sha','') !~ '^[0-9a-f]{40}$' OR coalesce(checkpoint->>'commit_sha','') !~ '^[0-9a-f]{40}$' THEN RAISE EXCEPTION 'checkpoint_invalid' USING ERRCODE='55000'; END IF;
 spec:=jsonb_set(spec,'{limits,max_attempts}','1'::jsonb)||jsonb_build_object('base_sha',checkpoint->>'base_sha','resume_from_checkpoint',checkpoint,'human_resume',p_authorization);
 proposal:=jsonb_set(i.proposal,'{data,summary}',to_jsonb('Retomada sob nova autoridade humana limitada'::text));
 proposal:=jsonb_set(proposal,'{data,objective}',to_jsonb(
 'Plano corrigido sob nova autoridade humana. Inspecione a API REAL no checkpoint antes de editar: '||(p_authorization#>>'{diagnosis,apiPath}')||'. Os exports EXISTEM: '||(p_authorization#>'{diagnosis,exports}')::text||E'.\n'
 ||'Importe explicitamente os simbolos publicos usados. Prove o round-trip de serializacao e negativos pela API publica real; nao substitua as provas por outra API. Preserve o arquivo de implementacao. Corrija a sintaxe e o balanceamento dos blocos de testes; remova duplicatas e expectativas fora do contrato tipado.\n'
 ||'Altere somente '||(i.proposal#>>'{data,included_scope,0}')||'. Antes de replace_exact use READ atual; se nao conseguir fundamentar a ancora, solicite nova leitura antes de editar, sem aproximacao ou fuzzy. A causa textual do repair anterior nao e conhecida.\n'
 ||'Gates e requisitos de prova originais permanecem obrigatorios. Diagnostico: '||(p_authorization#>>'{diagnosis,reference}')));
 SELECT coalesce(max(recovery_sequence),0)+1 INTO seq FROM public.work_recovery_lineage WHERE original_work_item_id=i.id;
 envelope:=private.record_recovery_successor(u,i.id,seq,i.impact_level,i.capability,jsonb_build_object('execution_spec',spec),proposal,'human_authorized_resume: failure='||f.id||'; request='||(p_authorization->>'requestId'),(p_authorization->>'requestId')::uuid);
 INSERT INTO public.work_resume_authorizations(id,user_id,request_id,envelope_root_id,predecessor_id,failure_event_id,source_attempt_id,authority,previous_authorized,previous_consumed,additional_attempts,aggregate_ceiling,successor_id,lineage_id)
 VALUES(grant_id,u,(p_authorization->>'requestId')::uuid,root.id,i.id,f.id,a,p_authorization,r.predecessor_max_attempts,total,1,total+1,(envelope->>'successorWorkItemId')::uuid,(envelope->>'lineageId')::uuid);
 RETURN envelope||jsonb_build_object('authorizationId',grant_id,'additionalAttempts',1,'aggregateCeiling',total+1,'previousConsumed',total);
END $$;
REVOKE ALL ON FUNCTION public.authorize_work_resume(uuid,integer,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.authorize_work_resume(uuid,integer,uuid,jsonb) TO authenticated;

CREATE FUNCTION private.block_resume_authority_descendants() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(WITH RECURSIVE ancestors(id) AS(SELECT NEW.original_work_item_id UNION SELECT l.original_work_item_id FROM public.work_recovery_lineage l JOIN ancestors a ON l.successor_work_item_id=a.id)
 SELECT 1 FROM ancestors a JOIN public.work_resume_authorizations g ON g.successor_id=a.id) THEN RAISE EXCEPTION 'human_resume_no_further_recovery' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.block_resume_authority_descendants() FROM PUBLIC;
CREATE TRIGGER no_resume_authority_descendants BEFORE INSERT ON public.work_recovery_lineage FOR EACH ROW EXECUTE FUNCTION private.block_resume_authority_descendants();
