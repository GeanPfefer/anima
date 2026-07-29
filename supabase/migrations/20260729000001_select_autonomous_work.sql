-- UX-01: seleção explícita e fail-closed de um trabalho aprovado pelo cartão.
-- A fronteira continua sendo autonomous_work_queue(): autenticação, allowlist,
-- elegibilidade, aprovação vigente, posse e ocupação de alvo não são duplicadas.

CREATE FUNCTION public.select_autonomous_work(
  p_work_item_id uuid,
  p_expected_proposal_version integer
)
RETURNS TABLE (
  work_item_id uuid, approved_proposal_version integer, approval_seq bigint,
  approved_at timestamptz, capability public.work_capability,
  target_reference text, selection_policy text, queue_size bigint,
  runner_up_approval_seq bigint, skipped_occupied_targets bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
#variable_conflict use_column
BEGIN
  IF p_work_item_id IS NULL OR p_expected_proposal_version IS NULL THEN
    RAISE EXCEPTION 'work item and expected proposal version are required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH queue AS (SELECT * FROM public.autonomous_work_queue()),
       free AS (SELECT * FROM queue WHERE NOT queue.target_occupied),
       selected AS (
         SELECT * FROM free
         WHERE free.work_item_id = p_work_item_id
           AND free.approved_proposal_version = p_expected_proposal_version
       )
  SELECT chosen.work_item_id, chosen.approved_proposal_version,
    chosen.approval_seq, chosen.approved_at, chosen.capability,
    chosen.target_reference, 'explicit_card_selection'::text,
    (SELECT count(*) FROM queue),
    (SELECT runner_up.approval_seq FROM free AS runner_up
      WHERE runner_up.work_item_id <> chosen.work_item_id
      ORDER BY runner_up.queue_position LIMIT 1),
    (SELECT count(*) FROM queue AS occupied WHERE occupied.target_occupied)
  FROM selected AS chosen;
END;
$$;

REVOKE ALL ON FUNCTION public.select_autonomous_work(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_autonomous_work(uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.select_autonomous_work(uuid, integer) IS
  'Seleciona somente o trabalho e a versão explicitamente acionados pelo usuário, desde que ainda pertençam à fila autônoma canônica e o alvo esteja livre. Nunca substitui o alvo solicitado por outro item.';
