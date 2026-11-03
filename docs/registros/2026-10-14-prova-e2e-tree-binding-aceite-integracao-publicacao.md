# Prova E2E de tree-binding — aceite, integração e publicação (2026-10-14)

Append-only. Sequência de `2026-10-14-prova-e2e-tree-binding-real-5f573801.md`.

- Preflight: item `5f573801` review v1; resultado `7f84bae8` ↔ attempt `08cc97e4` ↔ checkpoint `a7d0ca4d103077d865c93a532fbcf9ed591a2f85` (filho direto de `4060390b`, 0 merges, 2 arquivos); `a7d0ca4d^{tree}` = `628c96dfff091a0bb833485d72c763f9d78bb1dd` (igual a `worktreeTree.before/after` dos 4 gates e a `observedTreeSha`); parecer 86609 md5 `7e0fca325adbe72f58d90b60526b1d79` (v6 verified, `test_binding_satisfied` independent); 0 integrações/claims/leases; índice vazio; status de referência `anima-recovery/status-ref-e2e2.txt` (241 linhas).
- Aceite: seq **86611** `result_accepted`; item `completed`; parecer inalterado.
- Integração (clone `anima-integration-5f573801`, sem hardlinks, push desabilitado, HEAD destacado; wrapper `integ/integrate-5f573801.mjs`, guard `work-verifier-v6`; 0 guards falsos): **86612** `integration_effect_authorized` (auth `5f573801-c0de-4e00-8f21-5f57c0ffee01`), **86613** `integration_completed`; recibo `ff_only`, `effected`, `previousTargetSha` `4060390b`, `resultingTargetSha` `a7d0ca4d`, `mergeCommitSha null`.
- Sync: `refs/anima/integrated/5f573801`, `merge --ff-only`; dev=`a7d0ca4d` (árvore `628c96df…`); índice vazio; status idêntico.
- Verificações no principal: core typecheck 0 erros; core 122 suítes / 2876 testes PASS; web `tsc` 0 erros fora de `scripts/_session`; import nativo `VERIFIER_VERSION work-verifier-v6`; `diff --check` limpo; 0 segredos nas linhas adicionadas; replay 164 itens: 0 deriva, 0 erros, `5f573801` segue `verified`.
- Publicação: push comum `4060390..a7d0ca4` em `refs/heads/dev`; `origin/dev`=`a7d0ca4d`; `origin/main`=`99bec54e` intacta.
- Estado: ledger 156, último evento 86613, 0 claims/leases; 46 worktrees e WIPs preservados.
- Limitações abertas: I3c (CLI não exibe árvore/outputTail); sem negativo REAL de árvore nem falha real de gate com `outputTail`; baseline sem `worktreeTree` (I3d) e árvore ainda opcional (`acceptance_contract:3`); planner não emite `test_binding`; `acceptance_criterion_covered` do aceite substantivo sai `attested`; só jest; nomes de teste duplicados/sensíveis omitem o relatório; vínculo por árvore prova mesmo conteúdo, não correção semântica.
