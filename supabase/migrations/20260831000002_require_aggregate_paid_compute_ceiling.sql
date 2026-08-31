-- Compatibilidade consciente: autorizações históricas sem teto continuam visíveis e revogáveis,
-- mas a admissão as recusa. Novas autorizações exigem teto agregado positivo.
CREATE OR REPLACE FUNCTION public.grant_paid_compute_authorization(
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
    OR max_cost_currency IS NULL OR btrim(max_cost_currency)='' OR max_cost_amount IS NULL OR max_cost_amount<=0 THEN
    RAISE EXCEPTION 'aggregate paid compute ceiling required' USING ERRCODE='22023';
  END IF;
  IF work_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.work_items w WHERE w.id=work_item_id AND w.user_id=v_user) THEN
    RAISE EXCEPTION 'work item not found' USING ERRCODE='P0002';
  END IF;
  INSERT INTO public.paid_compute_authorizations(user_id,provider_id,node_id,resource_class,work_item_id,
    max_duration_ms,max_cost_currency,max_cost_amount,valid_from,valid_until)
  VALUES(v_user,btrim(provider_id),NULLIF(btrim(node_id),''),NULLIF(btrim(resource_class),''),work_item_id,
    max_duration_ms,upper(btrim(max_cost_currency)),max_cost_amount,valid_from,valid_until)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('action','granted','authorization_id',v_id);
END;
$$;
