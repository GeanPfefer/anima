-- ADR-002: fato externo granular, posterior à branch publicada e anterior a
-- qualquer merge/integrated. Só o vocabulário aqui (ALTER TYPE ADD VALUE não pode
-- ser usado na mesma transação que o adiciona), como em branch_publication_vocabulary.
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'review_request_created';
