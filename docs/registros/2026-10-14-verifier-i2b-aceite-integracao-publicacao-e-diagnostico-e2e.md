# Verifier v4/I2b-r — aceite, integração governada, publicação e diagnóstico E2E (2026-10-14)

Append-only. Sequência de `2026-10-14-verifier-i2b-sucessor-46b23286.md`.

- Preflight: item `46b23286` review v1; resultado `d7f46fc5` ↔ attempt `ef2b4b9b` ↔ checkpoint `c7a55716e2212a99d3cb8f14c3e200f2a9b727bb` (1 commit sobre `51a79198`, 0 merges, 4 arquivos do escopo); parecer 86533 md5 `bfba9abe0f7c222bd8bb2dd5c6297ab8` (v5 verified); claims/leases 0; índice vazio; sem WIP sobreposto.
- Aceite: seq **86535** `result_accepted` (resultado `d7f46fc5`); item `completed`; md5 do parecer inalterado.
- Integração (clone dedicado `anima-recovery/anima-integration-46b23286`, sem hardlinks, push desabilitado, HEAD destacado em `51a79198`; wrapper `integ/integrate-46b23286.mjs`, guard de Verifier = `work-verifier-v5`; inspeção sem guard falso): **86536** `integration_effect_authorized` (auth `46b23286-c0de-4e00-8f21-46b2c0ffee01`), **86537** `integration_completed`; recibo `ff_only`, `effected`, `previousTargetSha` `51a79198`, `resultingTargetSha` `c7a55716`, `mergeCommitSha null`.
- Sync: `refs/anima/integrated/46b23286`, `git merge --ff-only`; HEAD=`c7a55716`; índice vazio; status idêntico ao anterior.
- Verificações no checkout principal: web focados + gate-evidence + executor-selection 9 suítes / 243 testes PASS; `tsc` web 0 erros fora de `scripts/_session`; core typecheck limpo; sem segredos nas linhas adicionadas; 0 merges.
- Publicação: push comum `c7a55716:refs/heads/dev` (`51a7919..c7a5571`); `origin/dev`=`c7a55716`, `origin/main`=`99bec54e` intacta.

## Diagnóstico read-only da 1ª prova substantiva E2E de test_binding
Provado: (1) SQL `is_valid_host_gate_evidence/outcomes` tolera chaves extras (testReport/baseline) — sem migration; (2) com Jest real o host produz `testReport` com caminhos relativos à raiz (`packages/core/src/...`), build → `guardCanonicalResidentWrite('host_observed_gate_evidence')` ok e `claimKind:'test_binding'` preservado; (3) `executor` passa `claimKind` e testReport/baseline.testReport; (4) Verifier v5 cobre as 9 condições em testes unitários (I2c); (5) renderers do CLI não mapeiam códigos de achado (exibição genérica).
Impedimentos/ressalvas (nenhum bloqueia uma prova por contrato escrito por humano, nenhuma alteração de Core/Host/CLI é obrigatória):
1. O planner NÃO emite `test_binding` (`project-work-planner-shared.ts` só aceita gate_assertion|substantive): o contrato deve ser escrito por humano (create.mjs).
2. Vínculo teste↔revisão = igualdade de conjuntos de arquivos (sem digest de diff/outputTail: itens futuros de Core).
3. Nomes de teste duplicados ou com termos sensíveis ⇒ relatório omitido ⇒ lacuna (a prova deve usar arquivo com nomes únicos, ex.: arquivo de teste novo).
4. Arquivo de teste novo: baseline sai com exit≠0 sem relatório; `existedAtBase=false` ⇒ todos os testes são novos (Verifier condição i). Arquivo existente exige baseline.testReport (idem captura no base).
5. Orçamento: 9 attempts nas últimas 24 h; nova attempt exige lease E0 com mandato (ou esperar a janela).
6. Contrato: `acceptance_contract:2`, critério `proof:gate`, `claim_kind:test_binding`, `command` jest path-restrito, `target_paths` ⊇ `binding.test_files` (exatos), `min_new_tests ≥ 1`; negativos esperados: remover/skip do teste, relatório ausente, arquivo fora do escopo.
Não realizado: nova attempt, lease, migration, limpeza.
