# 2026-10-13 — Publicação de `dev` (Verifier v4 I1a+I1b) e planejamento do I2

Branch dev. Sem migration, nova attempt, aprovação/execução de I2, código de produção alterado, limpeza de WIPs/worktrees, force-push, API paga ou Host contínuo.

## Preflight
`dev` local = `3c7aab87…` (HEAD, índice vazio); remoto real (`ls-remote`) `origin/dev` = `1a18fc8e…`; `origin/dev` é ancestral de `dev`; exatamente 2 commits (`1f4b052e` I1a Core, `3c7aab87` I1b CLI), 0 merges, 13 arquivos (+420/−19) = os 9 do core + 4 do CLI; varredura de segredos nas linhas adicionadas: nenhuma ocorrência; `git diff --check` limpo; 0 claims válidas; 0 `in_progress` do residente; ledger 156; max seq 86465; sem hooks/processos concorrentes; status Git (220 linhas) preservado.

## Publicação
`git push origin 3c7aab878a508f9c3a99db9dd20983dd30562d56:refs/heads/dev` (comum, não forçado; executado só após reconfirmar `ls-remote dev == 1a18fc8e`): `1a18fc8..3c7aab8`, exit 0. `ls-remote` pós-push: `dev` = `3c7aab87…`; `main` = `99bec54e…` INALTERADA; nenhum outro ref/tag criado (84 refs, 40 tags, como antes do push exceto dev). Documentos untracked não incluídos. Status Git local idêntico ao anterior; `origin/dev` local = `dev` (ahead 0).

## Planejamento do I2
Plano `docs/planos/058-verifier-v4-i2-test-binding.md` (untracked): arquitetura `test_binding` (contrato `claim_kind:'test_binding'` + `binding`, captura jest `--json --outputFile` pelo host fora da worktree, `deriveGateTestReport` no padrão `deriveDifferentialBaseline`, `outputTail` preservado para gates falhos, vínculo de revisão por `diffSha256`, regras fail-closed para ausente/skipped/flaky/indeterminado, Verifier v5, lint), decomposição I2a (Core evidência) → I2b (host) / I2c (Core Verifier+lint, independentes) → I2d (CLI) → I2e opcional, riscos, aceites e próximo mandato. Premissa técnica validada: jest `--json --outputFile` preserva o exit code e entrega status por teste + `retryReasons` (13 KB para 37 testes). Nenhum item I2 criado.
