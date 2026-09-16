-- Autoridade temporária de execução human-supervised.
-- Não zera nem altera consumo: preserva a decisão unattended e só torna efetiva
-- a presença humana item/version-scoped enquanto o lease estiver vigente.

CREATE TABLE public.work_supervision_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id),
  proposal_version integer NOT NULL CHECK (proposal_version > 0),
  request_id uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > issued_at),
  UNIQUE (user_id, request_id)
);
ALTER TABLE public.work_supervision_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_supervision_select_own ON public.work_supervision_leases
  FOR SELECT TO authenticated USING (user_id=auth.uid());
REVOKE INSERT,UPDATE,DELETE ON public.work_supervision_leases FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.work_supervision_leases TO authenticated;

CREATE FUNCTION private.active_work_supervision(p_user_id uuid,p_work_item_id uuid,p_observed_at timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('leaseId',l.id,'issuedAt',l.issued_at,'expiresAt',l.expires_at)
  FROM public.work_supervision_leases l JOIN public.work_items i ON i.id=l.work_item_id
  WHERE l.user_id=p_user_id AND l.work_item_id=p_work_item_id
    AND l.proposal_version=i.proposal_version AND l.revoked_at IS NULL AND l.expires_at>p_observed_at
  ORDER BY l.expires_at DESC,l.issued_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.active_work_supervision(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.active_work_supervision(uuid,uuid,timestamptz) TO service_role;

-- Congela a decisão bounded vigente (inclusive recovery unitário) como fonte
-- explícita do que valeria sem acompanhamento.
ALTER FUNCTION private.autonomous_work_budget_decision(uuid,uuid,timestamptz)
  RENAME TO unattended_work_budget_decision;

CREATE FUNCTION private.autonomous_work_budget_decision(p_user_id uuid,p_work_item_id uuid,p_observed_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE v_unattended jsonb; v_supervision jsonb; v_reason text;
BEGIN
  v_unattended:=private.unattended_work_budget_decision(p_user_id,p_work_item_id,p_observed_at);
  IF v_unattended IS NULL THEN RETURN NULL; END IF;
  v_supervision:=private.active_work_supervision(p_user_id,p_work_item_id,p_observed_at);
  v_reason:=v_unattended->>'reason';
  RETURN v_unattended || jsonb_build_object(
    'policyVersion','autonomous-work-budget-v1-supervision',
    'mode',CASE WHEN v_supervision IS NULL THEN 'autonomous_unattended' ELSE 'human_supervised' END,
    'supervised',v_supervision IS NOT NULL,
    'supervision',v_supervision,
    'unattendedAdmitted',(v_unattended->>'admitted')::boolean,
    'unattendedReason',v_reason,
    'admitted',(v_unattended->>'admitted')::boolean OR v_supervision IS NOT NULL,
    'reason',CASE WHEN v_supervision IS NOT NULL THEN NULL ELSE v_reason END,
    'bypassedUnattendedReason',CASE WHEN v_supervision IS NOT NULL THEN v_reason END);
END $$;
REVOKE ALL ON FUNCTION private.autonomous_work_budget_decision(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.autonomous_work_budget_decision(uuid,uuid,timestamptz) TO service_role;

CREATE FUNCTION public.grant_work_supervision(p_work_item_id uuid,p_expected_proposal_version integer,p_request_id uuid,p_ttl_seconds integer DEFAULT 1800)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_uid uuid:=auth.uid(); v_item public.work_items%ROWTYPE; v_lease public.work_supervision_leases%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_ttl_seconds<60 OR p_ttl_seconds>3600 THEN RAISE EXCEPTION 'invalid supervision lease' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_item FROM public.work_items WHERE id=p_work_item_id AND user_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002'; END IF;
  IF v_item.proposal_version<>p_expected_proposal_version THEN RAISE EXCEPTION 'proposal version conflict' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_lease FROM public.work_supervision_leases WHERE user_id=v_uid AND request_id=p_request_id;
  IF FOUND THEN
    IF v_lease.work_item_id<>p_work_item_id OR v_lease.proposal_version<>p_expected_proposal_version OR extract(epoch FROM v_lease.expires_at-v_lease.issued_at)::integer<>p_ttl_seconds
      THEN RAISE EXCEPTION 'supervision request conflict' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('leaseId',v_lease.id,'workItemId',v_lease.work_item_id,'proposalVersion',v_lease.proposal_version,'issuedAt',v_lease.issued_at,'expiresAt',v_lease.expires_at,'replayed',true);
  END IF;
  INSERT INTO public.work_supervision_leases(user_id,work_item_id,proposal_version,request_id,expires_at)
  VALUES(v_uid,p_work_item_id,p_expected_proposal_version,p_request_id,now()+make_interval(secs=>p_ttl_seconds)) RETURNING * INTO v_lease;
  RETURN jsonb_build_object('leaseId',v_lease.id,'workItemId',v_lease.work_item_id,'proposalVersion',v_lease.proposal_version,'issuedAt',v_lease.issued_at,'expiresAt',v_lease.expires_at,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.grant_work_supervision(uuid,integer,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.grant_work_supervision(uuid,integer,uuid,integer) TO authenticated;

CREATE FUNCTION public.revoke_work_supervision(p_work_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_uid uuid:=auth.uid(); v_count integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  UPDATE public.work_supervision_leases SET revoked_at=now()
   WHERE user_id=v_uid AND work_item_id=p_work_item_id AND revoked_at IS NULL AND expires_at>now();
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN jsonb_build_object('workItemId',p_work_item_id,'revoked',v_count,'replayed',v_count=0);
END $$;
REVOKE ALL ON FUNCTION public.revoke_work_supervision(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revoke_work_supervision(uuid) TO authenticated;

COMMENT ON TABLE public.work_supervision_leases IS 'Autoridade humana temporária, owner/item/proposal-scoped. Não concede compute pago, escopo, concorrência ou integração.';
