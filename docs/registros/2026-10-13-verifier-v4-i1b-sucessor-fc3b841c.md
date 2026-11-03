# 2026-10-13 — Verifier v4 I1b (CLI), sucessor `fc3b841c`: attempt `e6af51bd` — verified (Verifier v4), em review

Branch dev, HEAD `1f4b052e` inicial e final. Sem commit, push, migration, Host contínuo, retry, recovery, aceite ou integração; sem API paga. Sucede [582b1f22 (failed)](2026-10-13-verifier-v4-i1b-attempt-582b1f22.md).

## Contrato e governança
`fc3b841c-1532-4252-8e21-957b2169f440` v1, base `1f4b052e…`, `acceptance_contract:2`, sem `resume_from_checkpoint`, 4 arquivos de `apps/web/cli`, 1 tentativa/30 min, codex-cli/default via WSL (env só no processo). Referências históricas só informativas (`supersedes_failed_work_item_id` 582b1f22; checkpoint `277473ec` só leitura, `checkpoint_reused:false`).
Gates corrigidos (padrões jest confirmados com `jest --listTests`): `cli/app cli/render` (2 suítes) e `cli/` (8 suítes, 160 testes, 26 s; o padrão `cli` do item anterior casava 15 suítes), + escopo. Lint v4 do I1a: 0 achados; elegibilidade 0 lacunas; ambos os comandos na allowlist.
`work_proposed` 86447, `context_attached` 86448, `work_approved` 86449, classificação humana 86450 (bounded/low/reversible/clear/normal).
Preflight PASS: HEAD==base, 4 arquivos limpos, ledger 156, 0 claims/attempts, permit/RAM 9,6 GB (61%), orçamento 0/1 (autônomo 2062 s ≥ 1800 s), import nativo do Core v4 OK, Codex WSL readiness null, sem codex/node.

## Attempt única `e6af51bd-84a5-44ad-a3fc-a365132c1f9c`
21:48:02Z–21:51:27Z (3 min 25 s; Codex 153 s), `execution_completed`, eventos 86451–86462, claim `6bac7f31` liberada `attempt_finished`, item **review** v1. Gates do host: focado passed (22,6 s); `cli/` passed (26,8 s).
**Primeiro parecer vivo `work-verifier-v4`: verified** (12 checagens, 0 lacunas, 0 violações, 5 independentes; 3 aceites cobertos: 2 gate_assertion + escopo; `humanReview` ausente, como esperado).
Checkpoint `3c7aab878a508f9c3a99db9dd20983dd30562d56` (filho único de `1f4b052e`) na branch `anima-work/e6af51bd-84a5-44ad-a3fc-a365132c1f9c`: 4 arquivos, +168/−9 (app.ts +22/−?, app.test +94, render.ts +12, render.test +49). NÃO integrado.

## Revisão independente (worktree temporária em `.worktrees`, layout exato do host; removida, junções desfeitas por Directory.Delete, node_modules principal 742)
- Gate 1: 2 suítes/70 testes PASS. Gate 2 (`cli/`): 8 suítes/173 PASS. Suíte ampla antiga (`cli`, 15 suítes): 307 PASS. Web `tsc`: 0 erros.
- Diff lido: payload de `work evidence` ganha `humanReviewPending` e `contractLint {mode, findings[{code, subject|null, detail}]}` (só adições); `proof` aceita `'human_review'` em `AcceptanceCriterionCoverage`/`acceptanceProofKinds`; `proofLabel` e seções "Revisão humana pendente"/"Contrato de aceite (<mode>)" só quando não vazias. Testes cobrem `human_review` (3 ocorrências em cada arquivo de teste).
- Sonda de compatibilidade (`runWorkEvidence` + `renderHuman` em TODOS os 156 itens, base × candidato): **0 itens com campo antigo alterado**; saída humana idêntica em todos os itens sem conteúdo novo; payload novo válido em 156/156; modos: 4 v2 / 152 legacy; `fc3b841c`: review, v2, 0 achados, aceites [covered gate, covered gate, covered scope], Verifier live verified.
- `human_review` não é tratado como prova automática: semântica no Core (I1a, inalterado); o CLI só rotula/exibe.

## Limitações e riscos
- Ruído consultivo: 146 de 156 itens (todos legados) passam a exibir "Contrato de aceite (legacy)" com achados (ex.: `d795e414`: `covers_unknown_acceptance`, 3× `acceptance_without_possible_proof`, `no_automated_proof`) — correto mas verboso; poderia ser suprimido/colapsado para legacy num incremento futuro.
- Nenhum item real tem `human_review` ainda: `humanReviewPending` real nunca foi não vazio em dados vivos (coberto só por testes unitários).
- Sem teste ponta a ponta do CLI nativo com `work evidence` (existem testes nativos de entrypoint, que passam).

## Estado final
Item `review` v1; 0 claims válidas; max seq 86462; ledger 156; sem codex/node; HEAD/status Git idênticos (+ docs untracked); 46 worktrees; origin/dev `1a18fc8e`, origin/main `99bec54e` inalterados; dev local 1 commit à frente de origin/dev.
GO/NO-GO aceite humano: **GO** (Verifier v4 verified + revisão independente sem defeitos). Integração só após aceite, em clone dedicado (procedimento do I1a), depois sincronização local; publicação separada.
