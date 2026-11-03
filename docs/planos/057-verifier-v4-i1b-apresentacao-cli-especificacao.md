# 057 — Verifier v4 I1b (apresentação no CLI): ESPECIFAÇÃO — item NÃO criado

Status: especificação (2026-10-13). Depende do I1a (item `8e24f4a8-b715-44cd-a9f0-e712c3f938b2`, plano 056 seção I1) **integrado e sincronizado em `dev`**.
O item I1b só pode ser criado depois disso, com `base_sha` = commit de `dev` que contém o I1a. Criar antes seria uma dependência informal de código não integrado.

## Pré-condições (todas verificáveis)
1. `integration_completed` do I1a no ledger e `dev` local contendo o commit integrado (ff-only, clone dedicado conforme precedente `d795e414`).
2. `lintItemAcceptanceContract`, `humanReview` em `WorkVerificationReport` e `VERIFIER_VERSION='work-verifier-v4'` presentes no `HEAD` do checkout principal
   (é de lá que o processo Node nativo resolve `@anima/core`; ver "Risco de harness").
3. `base_sha` explícito = esse `HEAD`; índice limpo nos arquivos do escopo; ledger 156; 0 claims válidas.

## Escopo mínimo (4 arquivos, todos em `apps/web/cli/`)
`app.ts`, `app.test.ts`, `render.ts`, `render.test.ts`. Sem arquivos do core. Sem migration.

## Requisitos
- `WorkEvidencePayload` ganha `humanReviewPending` (lista de aceites pendentes de revisão humana; vazia quando não há) e `contractLint` (`{mode:'v2'|'legacy', findings:[{code, subject|null, detail}]}`),
  calculados com `lintItemAcceptanceContract` e `presentation.verification.humanReview.pending`.
- `AcceptanceCriterionCoverage.proof` e o mapeamento de prova por aceite aceitam `'human_review'`; `proofLabel` mostra `human_review`.
- `render.ts`: seção `Revisão humana pendente` apenas quando a lista não é vazia; seção `Contrato de aceite (<mode>)` apenas quando há achados. Nenhum comando novo, nenhuma escrita.
- Sem alterar o significado dos campos existentes do payload (somente adições).
- Testes: payload com/sem pendências, com/sem achados, modo legacy sem achados bloqueantes, render com e sem seções, e os testes nativos de processo filho existentes continuam passando.

## Aceites (verificáveis pelo Verifier v3 disponível: gate_assertion + scope)
1. "As validações declaradas dos testes do CLI passam." — `npm test --workspace=apps/web -- cli/app cli/render` (inclui os testes de processo filho nativo).
2. "A suíte de testes do web para o CLI e work-orchestration passa." — opcional; sujeito a flakes de carga (git real); preferir só o gate 1.
3. "Somente os arquivos aprovados foram alterados." — `scope`.
O typecheck do web NÃO é gate (base sem erros no worktree, mas o `tsc` depende da resolução de `@anima/core`; verificação fica com o supervisor).

## Risco de harness e controles
- No worktree do host o `node_modules` é junção para o checkout principal, então o processo Node nativo dos testes `cli/app.test.ts` resolve `@anima/core` para `G:\anima\packages\core`.
  Por isso o I1a precisa estar integrado e sincronizado no checkout principal ANTES do I1b (controle: pré-condição 2, verificada por import nativo `lintItemAcceptanceContract` no preflight).
- Preflight adicional obrigatório do I1b: `node --experimental-transform-types ... -e "import('@anima/core').then(m=>process.exit(typeof m.lintItemAcceptanceContract==='function'?0:1))"` a partir de `apps/web` no checkout principal.
- Não usar `resume_from_checkpoint`; o checkpoint `84b34ece` (parte CLI) é só referência de leitura.

## Orçamento e executor
`codex-cli/default` via WSL (env só no processo), `worktree`, 1 tentativa, 30 min, `workspace_read` + `workspace_write_isolated`.
Classificação humana (bounded/low/reversible/clear/normal) e aprovação humana somente em etapa posterior.

## Evidência reaproveitável
Candidato `84b34ece` (CLI): `apps/web/cli/{app,app.test,render,render.test}.ts` revisados (61/61 com resolução correta). Registro `docs/registros/2026-10-13-verifier-v4-i1-attempt-bc27103e.md`.
