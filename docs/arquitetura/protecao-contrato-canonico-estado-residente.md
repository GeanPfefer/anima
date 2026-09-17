# Proteção de contrato canônico do estado residente

> Fundação implementada (linha `dev`). Fecha a classe conhecida do incidente 51929
> com DUAS camadas: read-your-writes (escrita) + carimbo de contrato (leitura). O
> resíduo restante é temporal, registrado em "Limite e próxima decisão".

## Causa estrutural modelada

Um **formato canônico persistível** é aquele cuja evidência, gravada no log
append-only `work_events` (o **estado residente**), é REPROJETADA depois pelo
Capability Proof Engine / Evolution. Cada formato tem **dois lados** que precisam
concordar: um **produtor** que o escreve e um **leitor** (a linha autoritativa)
que reprojeta de volta.

O incidente **51929** (`host_observed_coder_evidence_recorded`,
`0c3e2c6d-652f-49ae-a1e1-53d60bc63e61`) nasceu da divergência entre esses lados
**entre linhas de código**: a linha snapshot/Harness V3 persistiu transcripts do
coder com `runtimeEvents` (formato novo), e a linha `dev` posterior não carregava
mais o reader. `validCoderTranscripts` rejeitava a chave extra → projector `null`
→ Evolution `semantic_projection_rejected` → leitura inteira quebra.

Combinação perigosa = código divergente + novo contrato persistível + escrita no
estado residente **sem reconciliação/isolamento**. O objetivo é enforcement
técnico num ponto central, não dependência de documentação/memória.

## Duas camadas de proteção (uma superfície central)

O núcleo é o registry `packages/core/.../canonical-resident-contract.ts`, que
enumera os quatro contratos persistidos (gate/coder/git observados pelo host +
parecer do Verifier) e é a única superfície de reconciliação.

### Camada 1 — read-your-writes (lado de ESCRITA, dentro de uma linha)

`guardCanonicalResidentWrite(contractId, payload)` sintetiza o evento **como o
leitor o verá** (a partir da própria correlação da carga e do carimbo) e o
reprojeta pela régua do read-model. Recusa **fail-closed** contrato não registrado
ou carga que a linha atual não reprojeta. Invocada nos quatro sinks antes da RPC.
Impede uma linha de poluir o estado residente com o que ela mesma não lê.

### Camada 2 — carimbo de contrato (lado de LEITURA, ENTRE linhas)

Todo evento canônico carrega `payload.canonical_contract = { id, version }`,
carimbado **autoritativamente** por um trigger `BEFORE INSERT` em `work_events`
(migration `20260917000000`). O leitor observa a IDENTIDADE SEMÂNTICA do contrato
**antes** do projector específico e `classifyCanonicalResidentEvent` distingue:

| Situação | Classificação | Reação do read-model |
|---|---|---|
| contrato + versão legíveis, payload projeta | `readable` | participa da projeção |
| evento fora dos contratos canônicos | `not_canonical` | segue semântica atual |
| `id` carimbado desconhecido | `unsupported_contract` | `canonical_contract_incompatibility` |
| versão fora das legíveis (futura) | `unsupported_contract_version` | `canonical_contract_incompatibility` |
| contrato+versão conhecidos, payload corrompido | `invalid_payload` | `event_history_invalid` |

Assim uma linha mais antiga que encontra uma **versão futura** reporta
INCOMPATIBILIDADE (reconciliação), com issue diagnóstica própria no Evolution, em
vez de "histórico corrompido" — e nunca deriva assessment incorreto.

## Onde o carimbo vive, e por quê (não em colunas)

`work_events` já tem um envelope genérico e contrato-agnóstico
(`payload.schema_version` + `payload.data`, com CHECK). O carimbo é **irmão de
`schema_version`** — mesmo nível genérico, observável antes de `payload.data`.

Colunas próprias foram consideradas e **rejeitadas por incompatibilidade**: o
`packages/types/src/database.ts` commitado está atrás do schema local (tabelas/
funcs `paid_compute_*` WIP não commitadas); regenerá-lo para pegar colunas novas
contaminaria a mudança com esse WIP. O envelope é o **menor lugar genérico E
compatível**, e não exige regenerar tipos (o carimbo é `Json`).

Um **trigger** (não 4 reescritas de RPC) é o boundary central: os cinco sites de
`INSERT INTO public.work_events` das RPCs canônicas passam por ele. O carimbo
representa **semântica do contrato** — nunca SHA de commit, branch ou identidade
efêmera de código.

## Autoridade e compatibilidade legada

- **Autoridade:** o trigger deriva `id` do `event_type` (mapa 1:1) e fixa a versão
  canônica atual (1). Sobrescreve qualquer valor do cliente ⇒ o writer não declara
  versão arbitrária. Introduzir uma versão nova é mudar o trigger (migration) + o
  `writeVersion`/`readableVersions` do registry — a superfície única de reconciliação.
- **Legado:** eventos anteriores à migration não têm carimbo. O reader os infere
  como versão 1 a partir do `event_type` — determinístico, pois cada contrato só
  teve a versão 1 (`LEGACY_CANONICAL_CONTRACT_VERSION`). Sem backfill que invente
  versão; nada é reescrito no histórico. Uma CHECK lenient valida a forma do
  carimbo **quando presente**, permitindo a ausência (legado).

## Como o 51929-equivalente passa a ser bloqueado

- **Lado de escrita:** uma linha não persiste um formato que ela própria não lê.
- **Entre linhas:** um evento de versão/contrato que a linha atual não reconhece é
  classificado como INCOMPATIBILIDADE explícita (reconciliação), nunca corrupção —
  o read-model dá um diagnóstico próprio e não deriva assessment errado.
- **Dentro de uma linha (build/CI):** escrita e leitura compartilham a régua do
  registry; um writer sem reader (ou vice-versa) falha no teste.

## Provas

- Core: `canonical-resident-contract.test.ts` (guard + `classifyCanonicalResidentEvent`
  A/B/C/D/E + carimbo malformado + autoridade da versão).
- Web: `capability-assessment-read.test.ts` (versão futura → `canonical_contract_incompatibility`;
  contractId desconhecido → idem; versão atual carimbada → aceita; legado sem carimbo → aceito).
- pgTAP: `canonical_resident_contract_stamp.test.sql` (writer real carimbado; carimbo
  autoritativo sobrescreve valor forjado; não-canônico não é carimbado; CHECK recusa malformado).

## Limite e próxima decisão

O carimbo fecha a classe conhecida, mas tem uma **limitação temporal honesta**:
branches que **antecedem** a introdução do stamping não ganham retroativamente a
capacidade de classificar versões futuras — para elas, um evento de versão futura
ainda cairia no caminho legado/`invalid_payload`. A proteção vale para linhas a
partir desta migration.

O **namespace isolado (opção A)** — um tipo/namespace de evento que o reader
canônico ignora por construção, para formatos experimentais ainda não reconciliados
— permanece **FUTURO/escape hatch**, não implementado aqui. Introduzi-lo é nova
decisão humana (migration + checkpoint).

## Referências

- Incidente e regressão permanente: commit `4f0c745`; reconciliação `dd5936f`.
- Camada 1 (guard): commit `2a5316e`. Camada 2 (carimbo): migration `20260917000000`.
- Read-model: `apps/web/lib/evolution/capability-assessment-read.ts`.
- Contratos: `packages/core/src/work-orchestration/{canonical-resident-contract,host-observed-*,verifier-opinion,coder-transcript}.ts`.
