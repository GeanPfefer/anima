-- Etapa 2A — revisão dirigida: alinhar latest_work_checkpoint à guarda de
-- allowlist das demais RPCs de orquestração.
--
-- `record_work_checkpoint`, `autonomous_work_queue`, `next_autonomous_work` e
-- `reconcile_supervised_work` exigem `auth.uid()` + allowlist. `latest_work_checkpoint`
-- validava só autenticação e posse — sem vazamento (posse já protege o dado),
-- mas assimétrico com o padrão. Esta correção adiciona a guarda de allowlist,
-- mantendo tudo o mais idêntico. Migration append-only via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.latest_work_checkpoint(p_work_item_id uuid, p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
STABLE
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_data    jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.work_orchestration_allowlist a WHERE a.user_id=v_user_id) THEN
    RAISE EXCEPTION 'work orchestration is not enabled' USING ERRCODE='42501';
  END IF;
  -- Item inexistente ou de outro usuário: ausência tipada, sem vazar existência.
  IF NOT EXISTS (SELECT 1 FROM public.work_items i WHERE i.id=p_work_item_id AND i.user_id=v_user_id) THEN
    RETURN NULL;
  END IF;
  SELECT e.payload -> 'data' INTO v_data FROM public.work_events e
  WHERE e.work_item_id=p_work_item_id AND e.event_type='checkpoint_recorded'
    AND e.payload->'data'->>'attempt_id'=p_attempt_id::text
  ORDER BY (e.payload->'data'->>'signal_sequence')::integer DESC LIMIT 1;
  RETURN v_data; -- NULL quando não há checkpoint
END;
$$;

COMMENT ON FUNCTION public.latest_work_checkpoint(uuid, uuid) IS
  'Etapa 2A: reconstrói o último checkpoint válido de uma tentativa (maior signal_sequence) apenas por fato persistido. Exige auth.uid() + allowlist como as demais RPCs de orquestração. Preserva o histórico, não consome, não inicia tentativa, não altera estado, não decide elegibilidade e não chama planWorkResumption. Retorna NULL quando não há checkpoint ou o item não é do usuário (ausência tipada).';
