# Primeira prova E2E de test_binding — aceite, integração e publicação (2026-10-14)

Append-only. Sequência de `2026-10-14-test-binding-primeira-prova-e2e-42053b69.md`.

- Preflight: item `42053b69` review v1; resultado `a6be616d` ↔ attempt `589d4a34` ↔ checkpoint `64270c814abb6bd2ad162be241f9461c9e74c829` (1 commit sobre `c7a55716`, 0 merges, 2 arquivos do escopo); parecer 86552 md5 `8420ffb2369a4dfca2a8faa702b78687` (v5 verified, `test_binding_satisfied` independent); 3 testes novos passed sem retry/skip/pending; 0 integrações, 0 claims/leases; índice vazio; status de referência salvo (`anima-recovery/status-ref-e2e.txt`).
- Aceite: seq **86554** `result_accepted`; item `completed`; md5 do parecer inalterado.
- Integração governada (clone `anima-recovery/anima-integration-42053b69`, sem hardlinks, push desabilitado, HEAD destacado em `c7a55716`; wrapper `integ/integrate-42053b69.mjs`, guard Verifier v5; 0 guards falsos): **86555** `integration_effect_authorized` (auth `42053b69-c0de-4e00-8f21-4205c0ffee01`), **86556** `integration_completed`; recibo `ff_only`, `effected`, `previousTargetSha` `c7a55716`, `resultingTargetSha` `64270c81`, `mergeCommitSha null`.
- Sync local: `refs/anima/integrated/42053b69`, `merge --ff-only`; dev=`64270c81`; índice vazio; status idêntico.
- Verificações: jest (teste novo + selectable) 52/52; tsc web 0 erros fora de `_session`; sem segredos; `diff --check` limpo; 0 merges. Mutação fail-to-pass (feita no mesmo commit antes do aceite): 3/3 testes falham com a produção da base e passam com a correção.
- Publicação: push comum `c7a5571..64270c8` em `refs/heads/dev`; `origin/dev`=`64270c81`; `origin/main`=`99bec54e` intacta.
- Estado: ledger 156 migrations, último evento 86556, 0 claims/leases; WIPs/worktrees (46)/branches preservados.
- Limitações abertas: vínculo teste↔revisão por conjunto de arquivos (sem digest de diff/outputTail); planner não emite `test_binding`; `acceptance_criterion_covered` do aceite substantivo sai `attested` (embora `test_binding_satisfied` seja independent); ordinal para nomes duplicados; só jest; 1 prova real.
