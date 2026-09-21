# 2026-09-21 — Prova eligible fim-a-fim + auditoria da cadeia de baseline diferencial

- **Data/tipo:** 2026-09-21 (2ª sessão do dia); auditoria + prova.
- **Objetivo:** implementar a fatia "executor produz baseline diferencial real" para
  destravar casos `eligible` na Readiness Calibration.
- **Branch:** `dev`. **HEAD inicial:** `38e8b6e`. **HEAD final:** `a163c5f`.
- **Executor:** Claude (Opus 4.8). Continuação de
  [2026-09-21-materializacao-autoimprovement-e-readiness-calibration.md](2026-09-21-materializacao-autoimprovement-e-readiness-calibration.md).

## Causa estrutural encontrada (correção de premissa)

A premissa da tarefa — "as execuções reais ainda não produzem o baseline diferencial"
— está **DESATUALIZADA**. A auditoria READ-ONLY comprovou que a cadeia inteira já está
implementada e wired ponta a ponta:

1. **Contrato:** `AutonomousValidationCriterion.targetPaths?`/`claimKind?`
   (`eligibility.ts`, parse fail-closed, `28e00f8`).
2. **Planner emite:** o schema e o system prompt do planner
   (`project-work-planner-shared.ts`) INSTRUEM o LLM a declarar `target_paths` e
   `claim_kind` por gate; validação fail-closed propaga (`b4791d9` + target_paths).
3. **Executor produz:** `worktree-executor.ts` (l. 311–378) restaura ao `base_sha`,
   roda o gate no base, captura `baseExitCode`/`targets`/`scopeVerification`, restaura
   de volta (fail-closed: falha de restore aborta antes do coder); anexa o baseline ao
   gate (l. 690–717) e emite `onChangeAuthorizationObserved` (l. 523). Commit
   `10229a5` "Produza baseline diferencial por gate".
4. **Threading:** `executor-selection.ts` → `autonomous-backlog-deps.ts` (l. 249–279)
   → `persistPostTurnHostObservations` → `persistHostObservedGateEvidence` com
   `changeAuthorization`.
5. **Readiness:** `buildHostObservedGateEvidence` computa `shadowReadinessDecisions`
   com a change-authorization.

Os focais que a tarefa pediu (baseline válido/ausente/falho/comparação/compat
antiga/fail-closed) **JÁ EXISTEM** em `worktree-executor.test.ts` (l. 175–248, 459–479).

**Portanto a causa dos 0 `eligible` NÃO é defeito de pipeline — é DADO histórico:**
as 9 attempts revisadas do histórico precedem toda a cadeia diferencial (construída em
2026-09-18/19); nenhuma execução nova rodou pelo pipeline completo desde então.

## Lacuna real encontrada e fechada

O que faltava era a **PROVA end-to-end** de que a saída REAL do executor alcança
`eligible`. Nenhum teste demonstrava isso; `gate-evidence.test.ts` (l. 42) até afirma o
contrário com fixtures não-elegíveis.

`a163c5f` — teste de integração no `worktree-executor.test.ts`: roda o `WorktreeExecutor`
real contra git real com um gate discriminating (base FALHA → resultado PASSA; target
`retry-gate.js` pré-existente e não alterado; correção em `src/added.ts`, dentro do
escopo AUTORIZADO e fora do gate target), captura `onGateObserved` +
`onChangeAuthorizationObserved` REAIS, constrói a MESMA evidência host-observada e
assere `shadowReadinessDecisions[0].disposition === 'eligible'`
(`discriminating_gate_candidate`, change-auth `verified`). **1ª prova de que uma
execução real PODE alcançar `eligible`.**

## Arquitetura escolhida para baseline (a que JÁ existe, ratificada)

Baseline REAL rodado no `base_sha` só para gates que declaram `targetPaths` (superfície
estrutural); gates antigos/amplos (typecheck/build/test global) ficam sem baseline e a
classificação cai em `inconclusive` — sem varredura ampla nem precisão inventada.
Independência host-observed preservada (o host roda cada gate; não reusa atestado).

## Custo adicional introduzido

ZERO em produção nesta sessão (só um teste). O custo do baseline em si (rodar o gate no
`base_sha`, ~dobra os gates com `targetPaths`) já existia. Reuso cross-attempt do
outcome-base foi CONSIDERADO e REJEITADO: quebraria a independência host-observed
(freshness) por economia — tradeoff não semântico. Mantido o re-run.

## Gates / provas

- `worktree-executor.test.ts`: 54/54 verde (53 + 1 novo). Typecheck web verde.
- Readiness Calibration read-only re-rodada (DB local real, 1168 eventos): **inalterada
  — 9 attempts, 0 `eligible`** (6 conservative_confirmed, 3 conservative_overruled).
  NÃO fabriquei `eligible`; o número reflete honestamente a ausência de attempt nova.

## Invariantes de segurança preservadas

- SEM push; SEM merge main (`99bec54` intacta); SEM compute pago; SEM cloud; SEM
  service_role; SEM `db reset`. Shadow/advisory intacto; enforcement automático
  permanece bloqueado. `Calibration != Enforcement`.

## Limitações restantes / próximo gargalo concreto

Para um `eligible` REAL no store, é preciso RODAR uma attempt nova pelo pipeline
completo, com um gate discriminating desenhado (npm test path-scoped, target
pré-existente). Isso está **BLOQUEADO** por:
- ciclo manual/supervisionado = ato HUMANO via UI (CLI omite start/submit);
- coder autônomo local = barreira de RAM (qwen3-coder 30B derrama; fix=32GB) OU
  OpenAI pago = não autorizado;
- self-mod estrutural nunca é autonomamente executável (fronteira ratificada).

Próximo gargalo concreto = **gerar a 1ª evidência `eligible` de produção** rodando um
work item `low`-impact canônico com gate discriminating pela via autônoma/supervisionada
(fronteira humana/infra), NÃO mais código de pipeline.
