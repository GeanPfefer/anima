-- ============================================================
-- Carimbo canônico de contrato no estado residente (work_events)
-- ============================================================
--
-- FECHA O RESÍDUO CROSS-LINEAGE da classe do incidente 51929.
--
-- O guard read-your-writes (`guardCanonicalResidentWrite`, commit 2a5316e) já
-- impede uma linha de persistir um formato que ela própria não lê. Falta o caso
-- ENTRE LINHAS: a linha A escreve um formato/versão que a linha B, mais antiga,
-- não conhece — hoje B interpreta como corrupção (`event_history_invalid`).
--
-- Para o leitor DISTINGUIR "versão que não conheço" de "payload corrompido", ele
-- precisa observar a IDENTIDADE SEMÂNTICA do contrato ANTES de tentar o projector
-- específico. Este é o carimbo: `payload.canonical_contract = { id, version }`.
--
-- POR QUE NO ENVELOPE E NÃO EM COLUNAS. work_events já tem um envelope genérico e
-- contrato-agnóstico (`payload.schema_version` + `payload.data`, com CHECK). O
-- carimbo é irmão de `schema_version` — mesmo nível genérico, observável antes de
-- `payload.data.evidence`. Colunas próprias exigiriam regenerar `database.ts`, mas
-- o schema local diverge do `database.ts` commitado (tabelas/funcs paid_compute
-- WIP não commitadas); regenerar contaminaria a mudança. Envelope é o menor lugar
-- genérico E compatível. O carimbo representa SEMÂNTICA DO CONTRATO — nunca SHA de
-- commit, branch ou identidade efêmera de código.
--
-- POR QUE UM TRIGGER. Todos os writers canônicos (5 sites de INSERT em RPCs) já
-- passam por `INSERT INTO public.work_events`. Um único BEFORE INSERT é o boundary
-- central: carimba todo evento canônico, de qualquer RPC, sem reescrever cada uma.
--
-- AUTORIDADE. O servidor decide id+version a partir do `event_type` (mapa 1:1) e
-- fixa a versão canônica atual (1). O cliente NÃO pode declarar versão arbitrária:
-- o trigger sobrescreve o carimbo. Introduzir uma versão nova é, por construção,
-- mudar este trigger (migration) + o registry do core — a superfície única de
-- reconciliação.
--
-- COMPATIBILIDADE LEGADA. Eventos anteriores a esta migration não têm carimbo. O
-- reader os trata como legado e infere versão 1 a partir do `event_type` (a única
-- versão que já existiu de cada um dos 4 contratos) — inferência determinística,
-- sem backfill que invente versão. Nada é reescrito no histórico.

CREATE FUNCTION private.stamp_canonical_resident_contract()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_contract_id text;
BEGIN
  -- Mapa 1:1 event_type -> identidade semântica do contrato canônico.
  v_contract_id := CASE NEW.event_type
    WHEN 'host_observed_evidence_recorded'       THEN 'host_observed_evidence'
    WHEN 'host_observed_gate_evidence_recorded'  THEN 'host_observed_gate_evidence'
    WHEN 'host_observed_coder_evidence_recorded' THEN 'host_observed_coder_evidence'
    WHEN 'verifier_opinion_recorded'             THEN 'verifier_opinion'
    ELSE NULL
  END;

  -- Só contratos canônicos são carimbados; demais eventos ficam intactos.
  IF v_contract_id IS NOT NULL THEN
    -- Carimbo AUTORITATIVO: sobrescreve qualquer valor vindo do cliente. Versão
    -- canônica atual = 1 para os quatro contratos. Um contrato que evoluir de forma
    -- incompatível troca a versão aqui (e no registry do core), nunca no cliente.
    NEW.payload := jsonb_set(
      NEW.payload,
      '{canonical_contract}',
      jsonb_build_object('id', v_contract_id, 'version', 1),
      true
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.stamp_canonical_resident_contract() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER stamp_canonical_resident_contract_before_insert
  BEFORE INSERT ON public.work_events
  FOR EACH ROW
  EXECUTE FUNCTION private.stamp_canonical_resident_contract();

-- Defense-in-depth: quando o carimbo está presente, exige forma bem-definida
-- (objeto com id textual não-vazio + version inteiro >= 1). Ausência é permitida
-- (legado), então esta constraint valida as linhas históricas sem quebrá-las.
ALTER TABLE public.work_events
  ADD CONSTRAINT work_events_canonical_contract_shape CHECK (
    payload -> 'canonical_contract' IS NULL
    OR (
      jsonb_typeof(payload -> 'canonical_contract') = 'object'
      AND jsonb_typeof(payload -> 'canonical_contract' -> 'id') = 'string'
      AND length(payload -> 'canonical_contract' ->> 'id') > 0
      AND jsonb_typeof(payload -> 'canonical_contract' -> 'version') = 'number'
      AND (payload -> 'canonical_contract' ->> 'version')::numeric = trunc((payload -> 'canonical_contract' ->> 'version')::numeric)
      AND (payload -> 'canonical_contract' ->> 'version')::numeric >= 1
    )
  );

COMMENT ON FUNCTION private.stamp_canonical_resident_contract() IS
  'BEFORE INSERT em work_events: carimba payload.canonical_contract = {id, version} para os quatro contratos canônicos do estado residente (host_observed_evidence/gate/coder + verifier_opinion), derivando o id do event_type e fixando a versão canônica atual (1). Autoritativo: sobrescreve o cliente. Fecha o resíduo cross-lineage do incidente 51929 permitindo ao reader distinguir versão futura de payload corrompido. Ver docs/arquitetura/protecao-contrato-canonico-estado-residente.md.';
