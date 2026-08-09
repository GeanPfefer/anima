-- ADR-002: fato externo granular, posterior à autorização e anterior a qualquer PR.
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'branch_published';
