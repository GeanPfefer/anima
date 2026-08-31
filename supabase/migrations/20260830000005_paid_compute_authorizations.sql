CREATE TABLE public.paid_compute_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id text NOT NULL CHECK (btrim(provider_id)<>''),
  node_id text,
  resource_class text,
  work_item_id uuid REFERENCES public.work_items(id) ON DELETE CASCADE,
  max_duration_ms bigint NOT NULL CHECK (max_duration_ms>0),
  max_cost_currency text,
  max_cost_amount numeric CHECK (max_cost_amount>=0),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL CHECK (valid_until>valid_from),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((max_cost_currency IS NULL)=(max_cost_amount IS NULL))
);

ALTER TABLE public.paid_compute_authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY paid_compute_authorizations_select_own ON public.paid_compute_authorizations
  FOR SELECT TO authenticated USING (user_id=auth.uid());
REVOKE ALL ON public.paid_compute_authorizations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.paid_compute_authorizations TO authenticated, service_role;

CREATE FUNCTION public.grant_paid_compute_authorization(
  provider_id text, node_id text, resource_class text, work_item_id uuid,
  max_duration_ms bigint, max_cost_currency text, max_cost_amount numeric,
  valid_from timestamptz, valid_until timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user uuid:=auth.uid(); v_role text:=current_setting('request.jwt.claim.role',true); v_id uuid;
BEGIN
  IF v_user IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'human authenticated user required' USING ERRCODE='42501';
  END IF;
  IF provider_id IS NULL OR btrim(provider_id)='' OR max_duration_ms IS NULL OR max_duration_ms<=0
    OR valid_from IS NULL OR valid_until IS NULL OR valid_until<=valid_from
    OR ((max_cost_currency IS NULL)<>(max_cost_amount IS NULL)) OR max_cost_amount<0 THEN
    RAISE EXCEPTION 'invalid paid compute authorization' USING ERRCODE='22023';
  END IF;
  IF work_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.work_items w WHERE w.id=work_item_id AND w.user_id=v_user) THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002';
  END IF;
  INSERT INTO public.paid_compute_authorizations(user_id,provider_id,node_id,resource_class,work_item_id,
    max_duration_ms,max_cost_currency,max_cost_amount,valid_from,valid_until)
  VALUES(v_user,btrim(provider_id),NULLIF(btrim(node_id),''),NULLIF(btrim(resource_class),''),work_item_id,
    max_duration_ms,NULLIF(btrim(max_cost_currency),''),max_cost_amount,valid_from,valid_until)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('action','granted','authorization_id',v_id);
END;
$$;

CREATE FUNCTION public.revoke_paid_compute_authorization(authorization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_user uuid:=auth.uid(); v_role text:=current_setting('request.jwt.claim.role',true); v_row public.paid_compute_authorizations;
BEGIN
  IF v_user IS NULL OR v_role IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'human authenticated user required' USING ERRCODE='42501';
  END IF;
  UPDATE public.paid_compute_authorizations SET revoked_at=COALESCE(revoked_at,now())
  WHERE id=authorization_id AND user_id=v_user RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'authorization not found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('action','revoked','authorization_id',v_row.id,'revoked_at',v_row.revoked_at);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_paid_compute_authorization(text,text,text,uuid,bigint,text,numeric,timestamptz,timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.grant_paid_compute_authorization(text,text,text,uuid,bigint,text,numeric,timestamptz,timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.revoke_paid_compute_authorization(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_paid_compute_authorization(uuid) TO authenticated;
