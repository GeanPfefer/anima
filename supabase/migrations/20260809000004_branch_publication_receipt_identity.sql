-- Endurece a identidade mínima do receipt também para bancos que já aplicaram
-- a primeira versão da RPC. A aplicação valida a igualdade com o target
-- autorizado; esta constraint impede persistir identidades incompletas.
ALTER TABLE public.work_events
  ADD CONSTRAINT work_events_branch_publication_receipt_identity_check
  CHECK (
    event_type <> 'branch_published'
    OR (
      length(btrim(coalesce(payload->'data'->'receipt'->>'receiptId',''))) > 0
      AND length(btrim(coalesce(payload->'data'->'receipt'->>'providerId',''))) > 0
      AND length(btrim(coalesce(payload->'data'->'receipt'->>'repositoryId',''))) > 0
      AND length(btrim(coalesce(payload->'data'->'receipt'->>'remoteName',''))) > 0
      AND length(btrim(coalesce(payload->'data'->'receipt'->>'remoteBranch',''))) > 0
      AND length(btrim(coalesce(payload->'data'->'receipt'->>'baseBranch',''))) > 0
      AND (payload->'data'->'receipt'->>'commitSha') ~ '^[a-f0-9]{40}$'
      AND (payload->'data'->'receipt'->>'verifiedBaseSha') ~ '^[a-f0-9]{40}$'
    )
  );
