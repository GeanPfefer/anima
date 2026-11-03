# 2026-10-13 — Verifier I2c (Core): item `b972846e`, attempt `7293fdad` sob lease E0 — verified (v4 do host), em review

Branch dev, HEAD `828f2d18` inicial e final (= origin/dev após o push do I2a). Sem migration, retry, recovery, I2b, aceite/integração do I2c, push do candidato ou API paga. Planos: [058](../planos/058-verifier-v4-i2-test-binding.md), [059](../planos/059-execucao-supervisionada-sem-teto-global-de-attempts.md).

## Etapa 1 — Publicação do I2a
Preflight: dev local `828f2d18`, remoto real `3c7aab87`, ff puro, 1 commit (I2a, 0 merges), 5 arquivos, varredura de segredos nas linhas adicionadas: nenhuma, `diff --check` limpo, 0 claims, 0 leases, índice vazio. `git push origin 828f2d18:refs/heads/dev` (comum, não forçado, só após reconfirmar `ls-remote dev == 3c7aab87`): `3c7aab8..828f2d1`, exit 0. Pós-push: `dev` remoto = `828f2d18`; `main` = `99bec54e` INALTERADA; 84 refs/40 tags (sem novos); status Git idêntico; docs untracked não incluídos.

## Etapas 2 e 3 — Contrato, governança e preflight
`b972846e-2a98-459d-8440-9db38c82a821` v1, base `828f2d18…`, `acceptance_contract:2`, sem `resume_from_checkpoint`, 10 arquivos Core (eligibility, acceptance-contract-lint, work-verification, verifier-opinion, host-observed-gate-evidence + testes; todos em LF), 1 tentativa/35 min, codex-cli/default via WSL.
Escopo: `claim_kind:'test_binding'` + `binding{test_files, min_new_tests, bound_tests}` (parser fail-closed, só com `acceptance_contract:2`), 3 códigos de lint, Verifier v5 (`work-verifier-v5`) com 9 condições em ordem (evidência observada correlacionada → vínculo de revisão por igualdade do conjunto `changeAuthorization.changedFiles` × git observado → relatório presente → arquivos ligados → coerência com exit 0 → todos `passed` → sem retry → bound_tests → testes novos/removidos via baseline). Decisões de escopo: duplicatas de nome continuam = relatório ausente (ordinal fica para item separado); digest do diff fica para depois do I2b. Gates path-restritos (5 padrões `work-orchestration/<arquivo>`), typecheck core, suíte core + scope. Lint v4: 0 achados; elegibilidade 0 lacunas.
`work_proposed` 86485, `context_attached` 86486, `work_approved` 86487, classificação humana 86488. Preflight: HEAD==base==origin/dev, 10 arquivos limpos, permit/RAM 8,3 GB (52%), 0 claims/attempts, Codex WSL null, import nativo OK. Orçamento: `autonomous_unattended admitted=false reason=user_attempt_budget_exhausted` (6/6; próxima liberação `2026-10-14T03:28:50Z`) — ÚNICA recusa.

## Etapa 4 — Lease E0
Concedido por `anima work supervise` (identidade residente = dono do item; autorização humana no mandato): lease `5e6a8ad3-358b-43e4-b49c-dbbe8ef7bdb7`, 23:07:46Z → 23:37:46Z (1800 s), item+versão 1. Efeito observado: `mode human_supervised, admitted true, bypassedUnattendedReason user_attempt_budget_exhausted`; RAM, claim, contrato e provedor independentes. Nenhum contador, política ou variável alterado. Revogado por `work unsupervise` às 23:14:49Z (logo após o término da attempt); 0 leases vigentes.

## Etapa 5 — Attempt única `7293fdad-fce0-4d05-aa06-0a47f9888f57`
23:08:00Z–23:14:40Z (6 min 40 s; Codex 352 s), `execution_completed`, eventos 86489–86500, `work_started reason supervised_execution`, claim `befd6bd0` liberada `attempt_finished`, item **review** v1. Gates do host: focado passed 11,9 s; typecheck 4,3 s; suíte core 27,9 s. Verifier do host (código de HEAD = v4): **verified**, 14 checagens, 0 lacunas, 0 violações. Checkpoint `51a79198d6568f46d7013db68c2a57cb53b362e7` (filho único de `828f2d18`), branch `anima-work/7293fdad-fce0-4d05-aa06-0a47f9888f57`, 10 arquivos, +391/−13 (EOL preservado: numstat bruto = real, `git diff --check` limpo). NÃO integrado.

## Etapa 6 — Revisão independente (worktree em `.worktrees` no layout do host; removida, 0 junções, node_modules principal 742)
- Gates: focado 5 suítes/295; typecheck core limpo; core completo 120 suítes/**2823 PASS**; web `tsc` 0 erros (WorkClaimKind ampliado não quebrou consumidores); web `cli/` + `lib/ai/project-work-planner*` 15 suítes/346.
- Diff lido contra a especificação: parser, lint, `evaluateBinding` (9 condições na ordem; violações só `test_report_revision_mismatch` e `test_report_contradicts_gate`), aceite coberto só se provado (senão `acceptance_test_binding_unmet`), `human_review`/gate_assertion/scope inalterados, `VERIFIER_VERSION=work-verifier-v5`.
- Testes do candidato: positivo completo, cada código novo, atestação nunca substitui observação, rótulo/correlação, revisão com normalização de caixa/barras, relatório inválido omitido, gate terminal falho, relatório só em gate anterior, arquivo ausente, contradição exit 0 × failed, pending/skipped/todo/disabled, suíte focused/unknown, runtimeError, retry, boundTests, baseline ausente/arquivo existente/removido, coexistência com human_review, ordem de critérios.
- Meus testes extras (36, arquivo temporário, 36/36 PASS): 20 variações inválidas do parser (sem marcador, marcador 1, proof, command, binding ausente, globs, absoluto, `..`, duplicados, limites, bound_tests, claim_kind desconhecido), 8 casos de lint, legado intacto, versão v5, parecer v4 legível, elegibilidade com binding vacuous.
- **Dados reais:** vínculo de revisão validado em 51 itens com as duas evidências: 37 iguais; as 14 divergências são attempts antigas por RETOMADA (checkpoint-relativas, fora do V1); nas 7 attempts Single-Item V1 desta sessão 7/7 iguais ⇒ o binding é provável no fluxo atual.
- **Replay:** 158 itens/51 pareceres: **0 deriva**; nenhum achado de test_binding em dados reais; `d795e414` rejected; o I2c recomputa `verified` em v5.

## Ressalvas
1. Defensivo: `evaluateBinding` faz `files.find(...)!.tests` para `bound_tests`; seguro para specs vindos do parser (bound.file ∈ test_files), mas lançaria TypeError com critério montado à mão fora do parser.
2. Um critério `test_binding` não provado emite lacuna mesmo que o aceite esteja coberto por outra prova automática (veredito inconclusive): conservador, intencional.
3. Igualdade de conjuntos de arquivos não prova igualdade de conteúdo (digest do diff virá com o I2b).
4. Nenhuma evidência real tem `testReport` nem `baseline.testReport` até o I2b: o `test_binding` só poderá ser provado depois dele.
5. Policies shadow (`differential-evidence-policy`, `enforcement-readiness-policy`) tratam `test_binding` como `unsupported_claim_kind`: só telemetria, sem efeito.
6. O lease E0 não gera evento no ledger (só linha em `work_supervision_leases`; plano 059).

## Estado final
Item `review`; claim liberada; 0 claims válidas; 0 leases vigentes; ledger 156; max seq 86500; sem codex/node; HEAD/status Git idênticos (+docs untracked); 46 worktrees; origin/dev `828f2d18`, origin/main `99bec54e`; tentativas nas 24 h = 7 (6 autônomas + a supervisionada). GO/NO-GO aceite humano: **GO** (com ressalvas 1–4). Integração só após aceite, em clone dedicado.
