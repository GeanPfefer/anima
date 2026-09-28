# 2026-09-27f — Restauração da correlação de reservas `provider_api`

Complementa [`2026-09-27e-provider-api-cost-settlement-b1.md`](2026-09-27e-provider-api-cost-settlement-b1.md).
Regressão **preexistente**, descoberta durante o B1 — não causada por ele. Executor único: Claude.
Gasto: **US$0** (nenhuma chamada a provider, nenhuma authority/reserva real, nenhuma attempt paga).

## Estado git

- HEAD inicial `e0adff7` (B1), `origin/dev` `18578f0`; `main` = `origin/main` = `99bec54` intocada.
- WIP preservado: `.worktrees/`, `apps/web/scripts/_session/`, `watch4-sensors.txt`.

## Causa da regressão (comprovada, não hipótese)

- **Invariante** (introduzida em `20260904000000`): reserva `provider_api` (classe
  `provider_api:*` ou provider `openai`) exige attempt UUID (senão `22023`), work item `in_progress`
  (senão `work_item_not_executing`) e evento `execution_started` que amarre attempt ↔ work item ↔
  versão de proposta aprovada (senão `attempt_correlation_required`).
- **Onde se perdeu:** `20260910000001_paid_compute_budget_settlement.sql`. O `reserve` dela é,
  por diff, exatamente o corpo de `20260831000004` + a subtração de `settled` — isto é, derivado de
  um corpo **anterior** a `20260903000001` (role robusto) e a `20260904000000` (correlação). Perdeu
  as duas evoluções de uma vez.
- **Por que persistiu:** `20260910000003` corrigiu só o role robusto, copiando o corpo de
  `20260910000001`; a correlação nunca voltou. Nenhuma outra migration redefine o `reserve`.
- **Função viva antes da correção** = corpo de `20260904000000` − bloco de correlação + `settled`
  (diff do `pg_proc` contra a migration).
- **Impacto real:** nenhum observado. As 28 reservas `provider_api` do banco local (inclusive as 18
  posteriores a 2026-09-10) têm `execution_started` correlacionado; a admissão OpenAI continuou
  amarrada por autoridade por-item. Era perda de defesa em profundidade, não gasto indevido.

## Correção

Migration nova e aditiva `20260927000001_restore_provider_api_reservation_correlation.sql`:
`CREATE OR REPLACE` do `reserve` (mesma assinatura, GRANTs preservados) com o corpo vivo
(role robusto + `committed = reserved − voided − settled`) e o bloco de correlação **verbatim** de
`20260904000000`, no mesmo ponto. O diff contra a função viva é exclusivamente o bloco restaurado e
suas duas variáveis. Migrations históricas não foram editadas (já aplicadas; a nova funciona em
instalação limpa e em banco existente). `settle`/`void`/B1 intocados; tipos gerados inalterados.

Guarda nova `supabase/tests/paid_compute_reserve_combined_invariants.test.sql` (7 asserções): prende
no MESMO corpo o role vindo só do JSON `request.jwt.claims`, a correlação fail-closed e o excesso
`usage_priced` reabrindo o envelope — uma recompilação futura que perca qualquer uma falha aqui.

## Evidência

- **ANTES** (`paid_compute_provider_api_correlation`): 3/8 falhando — attempt não correlacionado,
  attempt não-UUID e item fora de execução eram **reservados**.
- **DEPOIS:** 8/8. Nenhuma expectativa de teste foi alterada.
- pgTAP paid compute (9 suítes, 114 asserções) PASS: correlação, guarda combinada, `usage_priced`,
  budget settlement, aggregate budget, jwt role source, node lifecycle, capability scope, hourly limit.
- B1 revalidado: core `provider-api-settlement` + `paid-compute*` 97/97; web focais
  (`provider-api-settlement`, `openai-paid-compute`, `paid-compute*`, `gpt-coder`, `coder-evidence`)
  8 suítes / 129 testes.
- Ledger: hash de todos os eventos idêntico antes/depois (`54b7476a…`, 78 eventos).
- `supabase gen types` idêntico ao commitado; `git diff --check` limpo.
- Suítes pgTAP vermelhas **fora** de paid compute, preexistentes e já registradas, não tocadas:
  `work_budget_local_vs_external` e `budget_blocked_human_resume` (registro 2026-09-05),
  `compute_routing_decision` (assinatura mudou em `20260910000000`; registro 2026-09-25d).

## Checkpoint — pipeline de compute pago (`provider_api`)

| Etapa | Implementado | Provado/testado | Operacional | Lacuna conhecida |
|---|---|---|---|---|
| 1. Authority/admission | sim | sim (TS + pgTAP grant) | sim (provas pagas reais até 2026-09-27) | autoridade por-item expira; concessão é ato humano |
| 2. Reservation | sim | sim (correlação 8/8 + guarda) | sim (28 reservas reais) | correlação ausente no banco de 2026-09-10 a 2026-09-27 (restaurada; aplicada só no banco local) |
| 3. Provider execution | sim | sim (mocks) | sim (attempts pagas reais) | falhas de capacidade do agente não são do pipeline |
| 4. Usage observation | sim | sim | parcial | tokens reais já observados; a cobertura de chamadas (`reported/unreportedCallCount`) nunca rodou numa attempt real |
| 5. Pricing resolution | sim (contrato + resolver) | sim (só fixtures) | **não** | **catálogo real de preços ausente** |
| 6. Settlement | sim (core + RPC + ligação) | sim (TS + pgTAP) | **não** | depende de 5; nunca executado ao vivo |
| 7. Reconciliation | parcial | parcial | **não** para `provider_api` | 12 reservas históricas seguem `cost_unknown` por política; razão do unknown não persistida; sem ferramenta humana para `requires_human_reconciliation` |

Settlement real **não** é operacional enquanto o catálogo de preços oficial não existir.

## Fronteira humana e retomada

- Catálogo real de preços (`ANIMA_PROVIDER_PRICING_CATALOG`) — decisão humana, não iniciada.
- Nenhuma attempt paga foi feita para provar as etapas 4–6 ao vivo; isso exige novo mandato.
