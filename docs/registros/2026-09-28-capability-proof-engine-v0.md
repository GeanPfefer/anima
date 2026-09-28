# 2026-09-28 — Capability Proof Engine V0: maturidade derivada de evidência real

- **Tipo:** desenvolvimento (core + read-model + UI mínima). US$ 0, sem provider, sem migração.
- **Branch:** `dev`. **HEAD inicial:** `a63cb35`. `main`/`origin/main` intactas (`99bec54`).
- **Durability congelada** nesta unidade (backup, encryption, restore, toolchain, recovery config,
  paid proof, Research Web runtime e provider: não tocados).
- **Arquitetura:** [`docs/arquitetura/capability-proof-engine.md`](../arquitetura/capability-proof-engine.md),
  seção "Proof Evaluation V0".

## Problema

O Capability Registry declara maturidades e `proofRefs`, mas a relação entre evidência (attempts,
Verifier, gates, runtime, provas vivas, registros) e a maturidade exibida no `/evolution` era
parcialmente manual. O motor V1/V1.1 ([registro](2026-09-18b-capability-proof-engine-v1-1.md)) já
derivava 6 capacidades do event log, mas:

1. não havia comparação formal declarado × derivado (a UI só mostrava os dois lados);
2. "sem regra" e "regra sem evidência" eram indistinguíveis;
3. provas fora do event log (Research Web, restore, settlement) existiam só como texto;
4. falha de gate era descartada (virava "zero evidência");
5. não havia critério concreto por degrau nem noção de degrau terminal.

**Decisão:** o pedido chamava a unidade de "V0", mas já existia um motor V1.1. Não se criou motor
paralelo: esta unidade é uma **camada de avaliação** sobre ele (nome no código: *Capability Proof
Evaluation V0*).

## Fase 0 — mapa (antes de editar)

| Situação | Capacidades |
|---|---|
| Derivadas de evidência estruturada (event log) | `agency.edit-file`, `agency.run-tests`, `agency.produce-change`, `agency.verify-change`, `governance.verifier`, `agency.supervised-self-development` |
| Evidência estruturada existente mas não conectada | `compute.external-provider` (`providerUsage`/`providerCallCount` na evidência do coder + prefixo estruturado `openai:` do backend) |
| Evidência só em docs, derivável sem interpretação subjetiva | `research.web.search/open/extract` (prova viva controlada), dimensões de `memory.durability` (restore V0/V0.1, histórico, config, toolchain), `compute.paid-settlement` (implementação + testes) |
| Puramente manuais | as outras 51 capacidades (maturidade + `proofRefs` escritos à mão) |

## Evidence model

Extensão mínima de `CapabilityEvidenceObservation` (compatível: campos opcionais):

- `evidenceClass` + nova classe `assisted_procedure` (procedimento humano/dev; preservada, nunca
  decide maturidade);
- `outcome: inconclusive` passa a carregar fatos parciais (executou, não concluiu);
- `source`: `canonical_event_log` (default) | `recorded_proof`;
- `environment`, `scope`: leitura humana;
- `freshness`: `durable` | `perishable` — modelado, **sem política** de expiração.

Mapeamento dos "kinds" candidatos do pedido para o que já existia: `implementation`/`test` →
`implementation`; `governed_attempt`/`verifier`/`live_runtime` → `verified_execution` com
`source: canonical_event_log`; `external_observation` controlada → `verified_execution` com
`source: recorded_proof`; `restore_proof`/processo humano → `assisted_procedure`; `failure` →
`inconclusive` ou `negative`; `regression` → conclusão temporal do engine (não classe);
`operational_use` → reprodução canônica; `human_acceptance` → já coberto pela decisão de revisão
em `supervised-self-development`.

## Maturity semantics

- **specified:** contrato suficiente para construir.
- **implemented:** código **da capacidade** exercitado. Primitiva de apoio =
  `implementation` + `inconclusive` (não promove).
- **proven:** ≥1 execução observada (canônica ou prova controlada registrada).
- **operational:** ≥2 ocasiões independentes de **uso real** (event log). Prova controlada
  repetida **não** conta (regra aplicada no engine).
- **autonomous:** exige `autonomous_operation`, que nenhum adapter produz; **não é destino
  universal** — `terminalMaturity` por regra (usado em `supervised-self-development` e
  `compute.paid-settlement`).

Enum de maturidade **não** mudou.

## Capabilities evaluated (12 regras)

| Capacidade | Fonte | Regra de promoção |
|---|---|---|
| 6 pilotos V1/V1.1 | event log | inalteradas (1 ocasião ⇒ proven; 2 ⇒ operational) |
| `compute.external-provider` **(novo adapter)** | event log | coder de provider externo (prefixo exato `openai:`) `succeeded` + uso reportado pelo provider ⇒ positiva; alcançado mas falhou, ou sem uso reportado ⇒ inconclusiva |
| `research.web.search` / `open` / `extract` | prova registrada | prova viva controlada ⇒ proven; teto proven |
| `memory.durability` | prova registrada | 3 procedimentos assistidos + 2 primitivas de apoio; nenhuma realiza a capacidade |
| `compute.paid-settlement` | prova registrada | implementação + testes ⇒ implemented; teto implemented (sem adapter de settlement real) |

`agency.run-tests`: gate terminal falho agora gera observação `inconclusive` (preservada, não
promove, não regride).

## Declared vs derived — histórico real

Leitura read-only via identidade residente (1343 eventos, US$ 0):

| Capacidade | Declarado | Derivado | Status | Fonte |
|---|---|---|---|---|
| `agency.edit-file` | operational | operational | aligned | derived (15 ocasiões) |
| `agency.run-tests` | operational | operational | aligned | derived (15 ocasiões; 20 inconclusivas preservadas) |
| `agency.produce-change` | proven | operational | **underclaimed** | derived (8) |
| `agency.verify-change` | proven | operational | **underclaimed** | derived (8) |
| `governance.verifier` | proven | operational | **underclaimed** | derived (12) |
| `agency.supervised-self-development` | proven | proven | aligned | derived (7 positivas, 5 negativas) |
| `compute.external-provider` | proven | operational | **underclaimed** | derived (21 positivas, 8 inconclusivas) |
| `research.web.search/open/extract` | proven | proven | aligned | hybrid |
| `compute.paid-settlement` | implemented | implemented | aligned | hybrid |
| `memory.durability` | projected | — | insufficient_evidence | manual |

Totais: 7 aligned · 4 underclaimed · 0 overclaimed · 1 insufficient_evidence · 51 not_evaluated.

## Discrepancies (reportadas, **não aplicadas**)

- `produce-change`, `verify-change`, `governance.verifier`: a régua de reprodução (≥2 ocasiões)
  já sustenta `operational`; o registry manteve `proven`. Decisão humana: promover, ou endurecer a
  régua de operacional para essas capacidades.
- `compute.external-provider`: 21 attempts governadas com resposta do provider. A auditoria de
  2026-09-16 rebaixou para `proven` por "uso raro e gated". Conflito conceitual real: reprodução ≠
  uso rotineiro? Fica para decisão humana; o motor só reporta.
- `memory.durability`: dimensões provadas como procedimento, capacidade sem prova — coerente com o
  declarado `projected`; o gap é o contrato Durable State.

## UI (`/evolution`)

No painel "Avaliação dinâmica": Declarado · Derivado, status/divergência, fonte da maturidade
(manual/derivada/híbrida), explicação, "O que falta" (critérios da regra) e "Evidência preservada"
(parcial/procedimento). As provas decisivas continuam da explicação V1. Nó do mapa continua
mostrando só o declarado. Sem redesenho. Verificação por testes (página exige login; não logado
pelo agente).

## Evolution V2.1 — itens incorporados e pendentes

Incorporados com base concreta: maturidade da capacidade ≠ do helper (primitiva = inconclusiva);
operacional exige uso real (prova controlada não reproduz); `autonomous` não universal
(`terminalMaturity`); evidência → maturidade explícita; Durability mostra dimensões sem virar
mega-capacidade.

**Pending (decisão conceitual):** `requires capability >= maturity` em objetivos; fronteira
semântica de `governance.authority` (operational?); dependência de `external-tool-boundary` em
authority; taxonomia de `research.web.navigate`; relação `compare → reuse-discovery`; atômica ×
composta; política de frescor; quais fundações terminam em `operational`
(ex.: `memory.persistence`); promover ou não os 4 subdeclarados.

## Provas / gates

- Core completo: **103 suítes / 2165 testes PASS** (inclui `capability-proof-evaluation.test.ts`,
  28 novos, e +1 teste de gate falho preservado).
- Web completo: **150 suítes / 1927 testes PASS** (focais evolution + read-model: 50).
- `npm run typecheck` (4 workspaces): **0 erros**. `git diff --check`: limpo.

## Limitações

- Evidência registrada é escrita à mão (com proveniência); o motor só a pondera.
- `observedAt` das provas registradas = instante do commit que as registrou.
- Frescor não aplicado; `autonomous_operation` ainda não derivado.
- `compute.external-provider` só vê o coder (planner pago não emite evidência de coder).
- 51 capacidades seguem manuais.

## Efeitos externos

Nenhum provider, authority, reserva ou gasto (US$ 0). Leitura read-only do Supabase local pela
identidade residente. Nenhuma migração. Scratch `apps/web/scripts/_session/capability-proof-readonly.ts`
fica fora do commit.

## Próximo ponto de retomada

Decisão humana sobre os 4 subdeclarados; depois conectar a próxima capacidade com sinal estruturado
(ex.: `governance.authority` via authorities consumidas, `memory.persistence` via uso real) ou
especificar o contrato Durable State.
