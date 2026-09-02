# 2026-09-02 — Prova viva do successor do PIN-02: rodou até o coder, barrada por RAM

**Tipo:** desenvolvimento (fix) + prova viva. **Branch:** `dev`. **HEAD inicial:** `77ccce3`.
**HEAD final:** `ad60d73`. Continua
[2026-09-02-retirada-approved-e-convergencia-pin02.md](2026-09-02-retirada-approved-e-convergencia-pin02.md).

## Objetivo

Executar a prova viva final do successor `5b8e371d` pelo fluxo autônomo real, deixando o
supervisor selecioná-lo naturalmente até `review`. Parar em `review + VERIFIED + 3/3 + 0 violações`.

## Barreira descoberta (pré-execução) e fix mínimo

O successor `5b8e371d` estava `approved` mas **NÃO elegível**: `autonomous_work_queue` vazia.
Causa: o gate de inteligência exige `work_intelligence_classified`, criado pela preparação
canônica `ensurePlannedProjectClassification`. Para um sucessor de correção (intent reduzido a
`execution_spec`), `sourceForClassification` recuperava só um `planner` suportado do ORIGINAL
via lineage — mas o PIN-02 tem `planner:operator_revision_after_local_planner_v1` (não suportado)
+ `canonical_provenance`. Logo a classificação falhava (`classification_policy_not_applicable`).

**Fix `ad60d73`** ([planned-project-classification.ts](../../apps/web/lib/work-orchestration/planned-project-classification.ts)):
o caminho de lineage passa a reconhecer também a `canonical_provenance` VÁLIDA do original
(retornando `canonical_backlog_v1`), espelhando a guarda do item direto. Sem bypass de PIN-02;
`operator_revision` continua não sendo planner suportado; **fail-closed** se nem planner
suportado nem proveniência canônica válida existir. +2 testes focados (positivo lineage-canônico;
negativo sem origem governada). `planned-project-classification` 10/10; typecheck web limpo;
`git diff --check` limpo. Commit atômico separado.

## Prova viva (autonomia on, Next parado, Ollama iniciado nesta sessão)

Recursos: Governor `permit` (pressão baixa, 7.67 GB livres de 17 GB). Ollama subido
(`ollama serve`); `qwen3-coder:latest` (18 GB) presente.

1. Classifiquei `5b8e371d` pela via canônica (`ensurePlannedProjectClassification` → ok, não replay).
2. Entrou em `autonomous_work_queue` e `next_autonomous_work` como ÚNICO elegível (os outros 3
   approved não estão classificados → fora da fila; sem risco de execução não intencional).
3. Resident Host in-process bounded (autonomia on) selecionou naturalmente `5b8e371d`:
   `work_intelligence_classified` → `work_routing_decided` → claim `726aade7` → attempt
   **`2685b72b`** → `execution_started` → **`execution_failed`**.

**Falha do coder:** `[ollama_transport_error] o modelo Ollama respondeu 500` (durationMs 37366 —
fase de CARGA do modelo). **Causa = barreira de HARDWARE conhecida:** qwen3-coder:latest (30B /
18 GB) não cabe em 16 GB de VRAM + ~7 GB de RAM livre → OOM/500. Fix = 32 GB ou burst on-demand
(ver `docs/registros/2026-08-23-*` e a caracterização da Goma). Evidência host-observed
`host_observed_coder_evidence_recorded` (`outcome:failed`, model qwen3-coder:latest) registrada
append-only. NÃO mascarada.

## Estado final e recovery

`5b8e371d` = **`failed`**, `current_work_retry_readiness` = **RETRY_READY** (attemptsUsed 1 /
maxAttempts 3, remaining 2, failureEventId `ed4941e4`). Falha `retryable:true`, classificada pela
recovery policy existente. **NÃO fabriquei retry** — `request_work_retry` é ato HUMANO (§12).
Worktree do attempt disposta; `dev` limpo; `origin/main`=`99bec54` intacta. Ollama ficou UP
(iniciado nesta sessão; sem modelo residente após o 500).

## Validação

- typecheck web LIMPO; `planned-project-classification` 10/10; `git diff --check` limpo.
- push fast-forward `77ccce3..ad60d73` para `origin/dev`; `origin/main` intacta.

## Próxima decisão humana exata

A convergência LÓGICA já está provada (Verifier v2 verified 3/3 no contrato real de `5b8e371d`,
sessão anterior). O único gap remanescente é a COMPUTE do coder neste hardware. Retomada:
**governed retry** (`request_work_retry`, humano) com compute suficiente — 32 GB, burst on-demand,
apps do usuário liberados, OU um coder menor (qwen2.5-coder:14b, que cabe melhor) — deixando o
Resident Host levar `5b8e371d` até `review` (esperado VERIFIED 3/3). Ao chegar a `review`, PARAR:
a decisão (aceitar / pedir novas correções) volta ao humano. PIN-03 permanece adiado.
