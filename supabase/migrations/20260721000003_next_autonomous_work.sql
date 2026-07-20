-- SUP-02: seleção determinística do próximo trabalho.
--
-- Política V0: aprovação mais antiga primeiro — exatamente a ordem já
-- projetada pela fila do SUP-01, sem juízo de valor escondido em heurística.
--
-- A seleção é um READ e não emite evento próprio: o efeito auditável é o
-- claim, que já registra `work_claimed`. Como a política é determinística
-- sobre um log append-only imutável, a decisão é sempre recomputável;
-- gravar um evento por consulta inundaria um log que não pode ser limpo.
--
-- Escolher executor, modelo ou esforço pertence à Fase F. A invariante de um
-- trabalho ativo por alvo é do SUP-03; `target_reference` já é projetado para
-- que essa filtragem seja acrescentada sem mudar este contrato.

CREATE FUNCTION public.next_autonomous_work()
RETURNS TABLE (
  work_item_id              uuid,
  approved_proposal_version integer,
  approval_seq              bigint,
  approved_at               timestamptz,
  capability                public.work_capability,
  target_reference          text,
  selection_policy          text,
  queue_size                bigint,
  runner_up_approval_seq    bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
BEGIN
  -- A fila já aplica autenticação, allowlist, elegibilidade e posse.
  RETURN QUERY
  WITH queue AS (SELECT * FROM public.autonomous_work_queue())
  SELECT
    head.work_item_id,
    head.approved_proposal_version,
    head.approval_seq,
    head.approved_at,
    head.capability,
    head.target_reference,
    'oldest_approval_first'::text,
    (SELECT count(*) FROM queue),
    -- Segundo colocado: explica por que este item e não o próximo.
    (SELECT runner_up.approval_seq FROM queue AS runner_up WHERE runner_up.queue_position = 2)
  FROM queue AS head
  WHERE head.queue_position = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.next_autonomous_work() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_autonomous_work() TO authenticated, service_role;

COMMENT ON FUNCTION public.next_autonomous_work() IS
  'Próximo trabalho elegível segundo a política determinística oldest_approval_first, com a razão da escolha (política, tamanho da fila e sequência do segundo colocado). Não emite evento: selecionar é leitura; o efeito auditável é o claim.';
