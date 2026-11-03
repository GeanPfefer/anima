# 2026-10-13 — Verifier v4 I1b (CLI): item `582b1f22` e attempt `64be3608` — failed por gate amplo demais (flake sob carga)

Branch dev, HEAD `1f4b052e` inicial e final (dev local; origin/dev `1a18fc8e`). Sem commit, push, migration, Host contínuo, retry, recovery, integração ou API paga. Continua [I1a](2026-10-13-verifier-v4-i1a-aceite-integracao-sync.md) e o [plano 057](../planos/057-verifier-v4-i1b-apresentacao-cli-especificacao.md).

## Item e governança
`582b1f22-557f-4016-9c96-e00b19af1ccc` v1: base `1f4b052e…`, `acceptance_contract:2`, sem `resume_from_checkpoint`, 4 arquivos (`apps/web/cli/{app,app.test,render,render.test}.ts`), 1 tentativa/30 min, codex-cli/default via WSL (env só no processo).
Aceites: 2 `gate_assertion` (testes focados `cli/app cli/render`; suíte do CLI `npm test --workspace=apps/web -- cli`) + escopo. Elegibilidade com lint v2 ativo (primeiro item sob o lint do I1a): 0 lacunas. `work_proposed` 86432, `context_attached` 86433, `work_approved` 86434, classificação humana 86435 (bounded/low/reversible/clear/normal).
Preflight PASS: HEAD==base, 4 arquivos limpos, ledger 156, 0 claims, 0 attempts, `readResourceAdmission`=permit (RAM 7,1 GB), orçamento admitido (autônomo 2330 s), import nativo do Core v4 OK, Codex WSL readiness null, sem codex/node.

## Attempt única `64be3608-7c4f-491a-99f5-18c22996b2c8`
21:27:22Z–21:31:51Z (4 min 29 s; Codex 155 s). Eventos 86436–86446. Codex: sucesso; checkpoint `277473ec4cab47eadaf627f241413be7e161e5cd` (filho de `1f4b052e`; 4 arquivos, +179/−7) na branch `anima-work/64be3608-…` (NÃO integrada).
Gates do host: `cli/app cli/render` **passed** (44,6 s); suíte `cli` **failed** exit 1 (64,6 s) ⇒ `[gate_failed]`, item **failed** (não retryable), claim `d4ab3b70` liberada `attempt_finished`, sem parecer do Verifier (não há result_submitted). Saída do gate não é persistida (só exitCode).

## Diagnóstico da falha do gate
- O padrão `cli` do gate (jest `testPathPattern`, regex em caminho absoluto) NÃO é só `apps/web/cli`: casa **15 suítes**, incluindo `app/(app)/evolution/_components/EvolutionClient.test.tsx` ("Client"), `lib/work-orchestration/codex-cli-coder*.test.ts` (git real) e `native-cli-coder*.test.ts` — suítes sabidamente sensíveis a carga/timeout. ERRO DE DESENHO DO CONTRATO (meu): deveria ser `cli/`.
- Reprodução independente do candidato no layout exato do host (worktree em `G:\anima\.worktrees\…\tree`, junções para o principal, cwd = raiz, `npm.cmd test --workspace=apps/web -- cli`): **307/307 PASS** em 110 s; base no mesmo layout 294/294 (135 s); terceira rodada do candidato 307/307 em 43 s. Falha NÃO reproduzida ⇒ flake de carga/ambiente nas suítes amplas; causa exata da falha do host indeterminada (saída não persistida).

## Revisão do candidato (diff lido; testes acima)
`app.ts`: `humanReviewPending` e `contractLint {mode, findings[{code, subject|null, detail}]}` no payload de `work evidence` (somente adições), `proof` com `'human_review'` em `AcceptanceCriterionCoverage` e `acceptanceProofKinds`; `render.ts`: `proofLabel` com human_review e seções "Revisão humana pendente" / "Contrato de aceite (<mode>)" só quando não vazias; testes +152 linhas (app.test +108, render.test +44). Escopo exato de 4 arquivos. Sem regressão observada (294 testes originais intactos + 13 novos). Ressalvas: seções entram antes do bloco de investigação; contratos legados com achados passam a exibir "Contrato de aceite (legacy)" (advisory, intencional); `tsc` do web não foi rodado separadamente (ts-jest tipa os arquivos).

## Estado final
Item `failed`; branch `anima-work/64be3608-…` e checkpoint `277473ec` preservados, não integrados; max seq 86446; ledger 156; 0 claims válidas; sem codex/node; worktrees 46 (3 temporárias minhas removidas: junções por Directory.Delete; node_modules principal 742); WIPs/status Git idênticos; origin/dev e origin/main inalterados.

## Decisão e próximo passo
GO/NO-GO aceite humano: **NO-GO** (item failed não permite `work accept`; o candidato é tecnicamente bom mas não está em `review`). Recomendado: sucessor independente (novo item, base `1f4b052e`, mesmos 4 arquivos, checkpoint `277473ec` só leitura) com gates corrigidos: `cli/app cli/render` + `cli/` (restrito ao diretório) + escopo. Sem recovery oficial (resume_from_checkpoint recusado pelo V1).
