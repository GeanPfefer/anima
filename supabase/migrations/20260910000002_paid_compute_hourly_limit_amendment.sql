-- Emenda estreita: somente eleva o teto horário de uma authority RunPod por capacidade para
-- USD 1.00. Preserva todos os demais campos e o ledger ligado ao mesmo authorization_id.
CREATE TABLE public.paid_compute_authorization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id uuid NOT NULL REFERENCES public.paid_compute_authorizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type='hourly_limit_raised_to_usd_1'),
  previous_capability_scope jsonb NOT NULL,
  next_capability_scope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paid_compute_authorization_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY paid_compute_authorization_events_select_own ON public.paid_compute_authorization_events
  FOR SELECT TO authenticated USING (user_id=auth.uid());
REVOKE ALL ON public.paid_compute_authorization_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.paid_compute_authorization_events TO authenticated,service_role;

CREATE FUNCTION public.raise_paid_compute_hourly_limit_to_usd_1(authorization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v_user uuid:=auth.uid();
  v_role text:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  v_auth public.paid_compute_authorizations;
  v_next jsonb;
  v_event_id uuid;
BEGIN
  IF v_user IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'human authenticated user required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_auth FROM public.paid_compute_authorizations a WHERE a.id=authorization_id AND a.user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'authorization not found' USING ERRCODE='P0002'; END IF;
  IF v_auth.revoked_at IS NOT NULL OR now() NOT BETWEEN v_auth.valid_from AND v_auth.valid_until
    OR v_auth.provider_id<>'runpod' OR v_auth.resource_class IS NOT NULL OR v_auth.capability_scope IS NULL
    OR v_auth.max_cost_currency<>'USD' OR v_auth.max_cost_amount<>1.5 OR v_auth.max_duration_ms<>1800000
    OR v_auth.capability_scope->>'maxNodes'<>'1' THEN
    RAISE EXCEPTION 'authority invariants do not match the approved amendment' USING ERRCODE='55000';
  END IF;
  IF v_auth.capability_scope#>>'{maxHourlyPrice,currency}'<>'USD' THEN RAISE EXCEPTION 'hourly currency must be USD' USING ERRCODE='22023'; END IF;
  IF (v_auth.capability_scope#>>'{maxHourlyPrice,amount}')::numeric>1 THEN RAISE EXCEPTION 'hourly ceiling already exceeds approved limit' USING ERRCODE='55000'; END IF;
  v_next:=jsonb_set(v_auth.capability_scope,'{maxHourlyPrice}','{"currency":"USD","amount":1}'::jsonb,false);
  IF v_next IS NOT DISTINCT FROM v_auth.capability_scope THEN RETURN jsonb_build_object('action','unchanged','authorization_id',v_auth.id); END IF;
  INSERT INTO public.paid_compute_authorization_events(authorization_id,user_id,event_type,previous_capability_scope,next_capability_scope)
  VALUES(v_auth.id,v_user,'hourly_limit_raised_to_usd_1',v_auth.capability_scope,v_next) RETURNING id INTO v_event_id;
  UPDATE public.paid_compute_authorizations SET capability_scope=v_next WHERE id=v_auth.id;
  RETURN jsonb_build_object('action','amended','authorization_id',v_auth.id,'event_id',v_event_id);
END;
$$;
REVOKE ALL ON FUNCTION public.raise_paid_compute_hourly_limit_to_usd_1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.raise_paid_compute_hourly_limit_to_usd_1(uuid) TO authenticated;
