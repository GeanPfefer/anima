-- Trusted System Evidence Boundary V0 (2026-09-29) — a fronteira temporal só vale se a ESCRITA
-- dos fatos reservados ao sistema for exclusiva a partir dela.
--
-- Achado (reconciliação pós Produce-Change Evidence Projection V0): a migração
-- 20260928000003 restringiu as CINCO RPCs de sistema ao papel `anima_system_writer`, mas a
-- TABELA `public.work_events` ainda aceita INSERT/UPDATE direto de `service_role` (grant padrão
-- do Supabase). Com a chave service_role, alguém gravaria `host_observed_*_recorded` /
-- `verifier_opinion_recorded` / `integration_completed` com `author=system` e `created_at`
-- arbitrário — ou moveria o `created_at` de um fato legado para depois da fronteira. Uma
-- fronteira temporal sem exclusividade de escrita não é fronteira de confiança.
--
-- Esta unidade (reusa `private.trusted_system_writer_owner()`, sem arquitetura nova):
--   1. guard BEFORE INSERT/UPDATE em work_events para os CINCO fatos reservados:
--      (a) escrita direta na tabela por papel efetivo que NÃO seja operador (service_role,
--          authenticated, anon, o próprio anima_system_writer…) é recusada — o fato só entra
--          por uma função SECURITY DEFINER do operador (as RPCs do writer);
--      (b) em sessão que não é de operador (todo tráfego de API: PostgREST tem session_user =
--          authenticator), mesmo dentro de função definer, exige o writer registrado ATIVO
--          DO DONO do item e author=system; `created_at` é carimbado pelo servidor;
--      (c) fato reservado é imutável (UPDATE recusado fora de sessão de operador).
--      "Operador" = superuser ou DONO de public.work_events (no Supabase, `postgres`, que NÃO é
--      superuser mas é dono e pode desabilitar/remover o trigger): raiz de confiança
--      (migrações, pgTAP, psql direto). Não há como o banco se defender do dono da tabela.
--   2. registro de writer com `created_at` carimbado pelo servidor e imutável; revogação
--      irreversível; writer não troca de dono.
--   3. `public.trusted_system_evidence_since()`: fronteira do DONO chamador, derivada de fatos
--      persistidos (nunca de configuração): greatest(ativação deste guard, registro mais
--      antigo de writer ATIVO do dono). Sem writer ativo ⇒ NULL ⇒ nada é system_proven.
--
-- Monotonicidade: nenhum caminho não-operador antecipa a fronteira (created_at carimbado e
-- imutável; ativação gravada uma vez). Revogar/remover writer só a ADIA ou a anula —
-- direção conservadora (rebaixa, nunca promove).

-- ─── Ativação do guard (instante a partir do qual a exclusividade vale) ────────────────────
CREATE TABLE private.trusted_system_evidence_guard (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  activated_at timestamptz NOT NULL DEFAULT now(),
  version      integer NOT NULL DEFAULT 1
);
REVOKE ALL ON TABLE private.trusted_system_evidence_guard FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO private.trusted_system_evidence_guard DEFAULT VALUES;
COMMENT ON TABLE private.trusted_system_evidence_guard IS
  'Instante em que o guard de fatos reservados ao sistema passou a valer. Piso da fronteira trusted_system_evidence_since.';

-- SECURITY INVOKER de propósito: `current_user` é o papel que escreve (service_role numa
-- escrita direta; o dono `postgres` dentro de uma RPC definer). `session_user` não muda com
-- SET ROLE nem com SECURITY DEFINER. Só pg_catalog é consultado antes da recusa (a).
CREATE OR REPLACE FUNCTION private.guard_trusted_system_fact()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  v_reserved constant text[] := ARRAY[
    'host_observed_evidence_recorded', 'host_observed_gate_evidence_recorded',
    'host_observed_coder_evidence_recorded', 'verifier_opinion_recorded', 'integration_completed'];
  v_table_owner oid := (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID);
  v_current_operator boolean := EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolname = current_user AND (r.rolsuper OR r.oid = v_table_owner));
  v_session_operator boolean := EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolname = session_user AND (r.rolsuper OR r.oid = v_table_owner));
  v_owner uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.event_type::text = ANY (v_reserved) OR NEW.event_type::text = ANY (v_reserved))
       AND NOT (v_current_operator AND v_session_operator) THEN
      RAISE EXCEPTION 'trusted system fact is immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (NEW.event_type::text = ANY (v_reserved)) THEN RETURN NEW; END IF;
  IF NOT v_current_operator THEN
    RAISE EXCEPTION 'trusted system writer required' USING ERRCODE = '42501';
  END IF;
  IF v_session_operator THEN RETURN NEW; END IF;
  v_owner := private.trusted_system_writer_owner();
  IF v_owner IS NULL OR NEW.author IS DISTINCT FROM 'system'
     OR NOT EXISTS (SELECT 1 FROM public.work_items i WHERE i.id = NEW.work_item_id AND i.user_id = v_owner) THEN
    RAISE EXCEPTION 'trusted system writer required' USING ERRCODE = '42501';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_trusted_system_fact() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_trusted_system_fact
  BEFORE INSERT OR UPDATE ON public.work_events
  FOR EACH ROW EXECUTE FUNCTION private.guard_trusted_system_fact();

-- ─── Registro do writer: created_at carimbado e imutável ──────────────────────────────────
CREATE OR REPLACE FUNCTION private.stamp_trusted_system_writer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSIF NEW.writer_user_id IS DISTINCT FROM OLD.writer_user_id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'trusted system writer registration is append-only (only revocation)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.stamp_trusted_system_writer() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER stamp_trusted_system_writer
  BEFORE INSERT OR UPDATE ON private.trusted_system_writers
  FOR EACH ROW EXECUTE FUNCTION private.stamp_trusted_system_writer();

-- ─── Fronteira do dono chamador ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trusted_system_evidence_since()
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT greatest(
    (SELECT g.activated_at FROM private.trusted_system_evidence_guard g),
    (SELECT min(w.created_at) FROM private.trusted_system_writers w
      WHERE w.owner_user_id = auth.uid() AND w.revoked_at IS NULL))
  WHERE auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM private.trusted_system_writers w
      WHERE w.owner_user_id = auth.uid() AND w.revoked_at IS NULL);
$$;
REVOKE ALL ON FUNCTION public.trusted_system_evidence_since() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trusted_system_evidence_since() TO authenticated;
COMMENT ON FUNCTION public.trusted_system_evidence_since() IS
  'Fronteira de evidência system_proven do dono chamador: greatest(ativação do guard, registro mais antigo de writer ativo). NULL sem writer ativo.';
