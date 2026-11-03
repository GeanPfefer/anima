# 2026-10-13 — Verifier v4 I1: item `bc27103e` e primeira attempt (failed por limitação do worktree)

Tipo: self-dev governado (plano 056, incremento I1). Branch dev, HEAD `1a18fc8e` inicial e final; sem commit, push, migration, Host contínuo, recovery,
integração ou API paga. Arquivo do plano: `docs/planos/056-verifier-v4-contratos-de-aceite-verificaveis.md` (untracked).

## Item e governança
- `bc27103e-a07c-401d-8a43-67865da3860c` v1, planner `human_explicit_independent_proposal`, base `1a18fc8e…`, `execution_spec.acceptance_contract: 2`,
  sem `resume_from_checkpoint`, 13 arquivos no escopo, 1 tentativa / 45 min, codex-cli/default (WSL, `ANIMA_CODEX_*` só no processo).
- Aceites (`expectedEffects`): 3 afirmações de gate (`gate_assertion`: testes core, testes CLI, typecheck core) + 1 de escopo. Comportamentos substantivos
  ficaram no objetivo e na revisão humana (o Verifier v3 não os prova — é exatamente o que o I1 resolve).
- `work_proposed` 86398 → `work_approved` 86400 → `work_intelligence_classified` 86401 (humana: bounded/low/reversible/clear/normal).
- Preflight PASS: HEAD==base, ledger 156, 0 claims válidas, 0 `in_progress` da identidade residente, item 0/1, orçamento admitido, RAM 6,1 GB, sem codex órfão.

## Attempt (única) `410523ee-a93b-4476-ab07-2236a14c2384`
06:00:16Z–06:09:25Z (9 min 9 s), exit 0 do CLI, `lastOutcome: execution_failed`. Eventos 86402–86412. Codex WSL: sucesso (514 s), checkpoint `84b34ece498cd497c6d1f69f56675370d865a439`
na branch `anima-work/410523ee-…` (13 arquivos, +336/−16, exatamente o escopo). Gates do host: core **passed** (11 s); CLI **failed** (exit 1, 21 s);
typecheck e escopo não chegaram a rodar (gate_failed interrompe). Item **`failed`** (não retryable), claim `15070c3e` liberada `attempt_finished`, sem Verifier opinion.

## Causa da falha do gate CLI — limitação do worktree, não do candidato
4 testes de `cli/app.test.ts` disparam processo Node nativo (entrypoint da CLI). No worktree o `node_modules` é junção para o checkout principal, então
`@anima/core` resolve para `G:\anima\packages\core` (sem o novo export `lintItemAcceptanceContract`): `SyntaxError: ... does not provide an export named
'lintItemAcceptanceContract'`. Jest mapeia o core para o `src` do worktree e não vê o problema. Base no mesmo tipo de worktree: 57/57; candidato com
`@anima/*` apontando para o próprio worktree: **61/61**. Conclusão: uma mudança que adiciona export ao core consumido pelo CLI nativo não pode passar o gate CLI no mesmo
item/worktree; precisa de decomposição (core primeiro, integrado e sincronizado em dev; CLI depois) ou de correção do harness (fora do escopo).

## Revisão independente do candidato (worktree temporária minha, removida; junções desfeitas antes; node_modules principal intacto 742)
- Implementação confere com a especificação: lint puro (7 códigos), `human_review` pendente (severity ok, attested), `no_automated_acceptance_proof` só com `human_review` declarado,
  `humanReview.pending` no relatório e no parecer (opcional, fail-closed), `VERIFIER_VERSION=work-verifier-v4`, marcador `acceptance_contract` só `2`, lint na elegibilidade só com marcador,
  CLI `humanReviewPending`/`contractLint` + render.
- Core: `tsc` limpo; jest completo **119 suítes / 2648 testes PASS**. Web: `tsc` 0 erros no candidato; `cli/app cli/render` 61/61 (com resolução correta).
- **Replay histórico** (recomputo com código da base v3 vs candidato v4 sobre os eventos de 153 itens do residente; 47 com parecer recomputável): **0 deriva** em veredito, achados e contagens;
  `humanReview` vazio em todos; `d795e414` continua `rejected`; histórico persistido v3 segue legível; nenhum parecer reescrito.
- Observação: o `verified` com pendências humanas é intencional (plano 056); em lane obrigatória, só ao menos um aceite com prova automática permite `verified`.

## Estado final
Item `failed`; branch `anima-work/410523ee-…` (1 commit sobre `1a18fc8e`, ff) NÃO integrada; main checkout intacto (status idêntico); ledger 156; max seq 86412; 0 claims válidas; sem codex órfão;
46 worktrees (as 2 temporárias removidas). `failed` não permite `work accept`; qualquer aproveitamento do candidato é decisão humana (recovery de candidato ou decomposição).

## Decisões humanas pendentes
(a) aproveitar o candidato `84b34ece` (revisado, 0 deriva) por recovery/integração governada de candidato, ou (b) decompor: I1a = core (lint, human_review, v4, parecer) e I1b = CLI em item
seguinte sobre dev já com o core. Não reexecutar `bc27103e`. GO/NO-GO do I2: **NO-GO** até resolver o destino do I1.
