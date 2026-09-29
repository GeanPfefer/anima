-- Mandated Verifier is monotonic across proposal revisions (2026-09-29).
--
-- As duas RPCs de revisão (`revise_work_proposal`, `request_work_proposal_revision`)
-- substituem `work_items.intent` INTEIRO pelo intent enviado pelo chamador. O host
-- reconstrói o `execution_spec` a cada replanejamento e só o materializer canônico grava
-- `verifier_requirement`; assim, revisar um lane mandatado podia rebaixá-lo em silêncio
-- para advisory (`private.work_item_requires_verifier` = false).
--
-- Regra: uma atualização de `intent` nunca remove o mandato. Se o intent anterior exige
-- Verifier, o novo também precisa exigir — caso contrário a escrita é recusada (fail-closed).
-- Não há rebaixamento previsto; o predicado é o mesmo espelho de `readVerifierRequirement`.

CREATE OR REPLACE FUNCTION private.guard_verifier_requirement_monotonic()
-- SECURITY DEFINER com search_path fixo: o predicado vive em `private`; qualquer papel que
-- atualize o intent (RPC definer ou escrita direta) passa pela mesma checagem.
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF private.work_item_requires_verifier(OLD.intent) AND NOT private.work_item_requires_verifier(NEW.intent) THEN
    RAISE EXCEPTION 'mandated verifier requirement cannot be removed by a proposal revision'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_verifier_requirement_monotonic() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS work_items_verifier_requirement_monotonic ON public.work_items;
CREATE TRIGGER work_items_verifier_requirement_monotonic
  BEFORE UPDATE OF intent ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION private.guard_verifier_requirement_monotonic();

COMMENT ON FUNCTION private.guard_verifier_requirement_monotonic() IS
  'Mandated Verifier monotônico: recusa (42501) qualquer UPDATE de work_items.intent que remova um verifier_requirement obrigatório.';
