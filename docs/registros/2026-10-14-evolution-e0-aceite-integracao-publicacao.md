# Evolution × E-0 — attempt, aceite, integração governada e publicação (2026-10-14)

Append-only, sanitizado. Sequência de [a prova E-0](2026-10-14-e0-restauracao-isolada-comprovada.md) e [da limpeza](2026-10-14-e0-limpeza-concluida.md). Sem segredos nem conteúdo privado.

## Item e execução
- Item `f77f7cc7-8244-4ebc-ae78-859b62c15927` (planner `human_explicit_independent_proposal`), base `26275347`, `acceptance_contract:2`, 1 tentativa / 35 min, Codex CLI via WSL (assinatura; sem authority paga). Escopo: 4 arquivos (`capability-proof-recorded.ts`, `capability-registry.ts`, `capability-proof-evaluation.test.ts`, `EvolutionClient.test.tsx` só a contagem 3→6, ampliação decidida por humano).
- Eventos: proposed 86766, context 86767, approved 86768, classificação humana (bounded/low/reversible/clear/normal) 86769. Lease E0 `c0fa8dec…` 20:35:35Z–revogado 20:39:04Z (venceria 21:05:35Z) para superar `user_attempt_budget_exhausted`; resource admission `permit` verificado antes. Attempt `4105b074-c572-40ac-9a81-4ef75bb8f09d` 20:35:40Z–20:39:02Z (Codex 146 s): checkpoint 86775, `result_submitted` 86776 (`0e8dff7a…`), evidências do host 86777–86779, parecer 86780, claim liberada 86781.
- Lease: o orçamento só é reavaliado em `execution_started` e em cada checkpoint (`interrupt_work_on_budget`); um lease vencido no meio de uma attempt > ~29 min a interromperia com checkpoint salvo. Não ocorreu. Risco conhecido do plano 059, sem renovação nem extensão.
- Verifier `work-verifier-v6` **verified** (19 checagens, 0 lacunas, 0 violações; 6 independentes, 13 atestadas; `test_binding_satisfied` independente); md5 do payload `8ed5730959f97007a98d3b5114790534`, inalterado após aceite e integração.

## Revisão independente (antes do aceite)
Candidato `f8dbfeccff40af7fb7abd608741cbab79697c67a`, filho único de `26275347`, 0 merges, 4 arquivos, +113/−4, `diff --check` limpo. Em worktree descartável: core 123 suítes / 2904 testes, focado 87, web EvolutionClient 2 suítes / 57, typecheck core e web 0 erros. Conteúdo: 3 observações `assisted_procedure` positivas (`e0-local-encrypted-backup-v1`, `e0-isolated-restore-v1`, `e0-restart-recovery-v1`), `meaning`/`advancement` e history `proof_added` de 2026-10-14; `memory.durability` segue `projected`/`insufficient_evidence`/`derivedMaturity null`; sem observações `inconclusive`.

## Aceite e integração
- `work accept` único: `result_accepted` **86782**, item `completed` v1, resultado `0e8dff7a-b357-4688-8d46-cf0a9c7f28fe`.
- Clone dedicado `anima-integration-f77f7cc7` (sem hardlinks, push desabilitado, HEAD destacado em `26275347`); wrapper de integração governada em modo inspeção: **22/22 guards**; depois `--execute` único: `integration_effect_authorized` **86783** (auth `f77f7cc7-c0de-4e00-8f21-f77f7ffee001`) e `integration_completed` **86784**; receipt `ff_only`, `effected`, `previousTargetSha` `26275347`, `resultingTargetSha` `f8dbfecc`, `mergeCommitSha null`; Trusted System Writer.
- Sync local: `refs/anima/integrated/f77f7cc7` e `git merge --ff-only`; índice vazio; `git status` idêntico (10 WIPs tracked + 261 untracked); sem sobreposição com os arquivos do escopo. Pós-sync no principal: core 123 suítes / 2904 PASS; EvolutionClient 57 PASS; typecheck core 0 erros; web 85 erros, todos em `apps/web/scripts/_session` (untracked, preexistentes), 0 fora; 0 linhas adicionadas parecidas com segredo.

## Publicação
Push comum (sem force) de `f8dbfecc` para `refs/heads/dev`: `f7c629a..f8dbfec`; histórico publicado inclui o commit documental `26275347` e o candidato `f8dbfecc`. `origin/dev` = `dev` = `f8dbfeccff40af7fb7abd608741cbab79697c67a` (0/0); `origin/main` = `99bec54e3ab42bfe882a8686cd1385d8058b916e` intacta.

## Estado final
Supabase residente healthy, StartedAt `18:12:31Z`, 0 restarts, 156 migrations, seq 86784, 0 claims e 0 leases vigentes. Nenhuma migration, nenhuma nova attempt ou lease, nenhuma limpeza de worktrees/branches/WIPs. Este registro e os dois anteriores desta cadeia de E-0 (limpeza e prova já commitados em `26275347`; este arquivo não) permanecem sem commit/push.

## Limites
O E-0 comprova um procedimento humano supervisionado, local, em uma ocasião. Não comprova backup automático, recuperação fora da goma nem autonomia do Anima; a Evolution deve continuar mostrando `memory.durability` como Projetada com Evidência insuficiente e 6 procedimentos preservados.

## Próximo ponto
Abrir `/evolution` (dev server `npm run dev:web`) e verificar a capacidade "Durabilidade do progresso". Este registro ainda precisa de commit humano.
