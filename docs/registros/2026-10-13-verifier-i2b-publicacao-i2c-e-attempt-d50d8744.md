# Verifier v4/I2b — publicação do I2c e attempt única `d50d8744` (FAILED) — 2026-10-13

Append-only. Complementa `2026-10-13-verifier-i2c-aceite-integracao-sync-e-proposta-i2b.md`.

## Publicação do I2c
Preflight: dev local `51a79198`, remoto `828f2d18`, ff, 1 commit, 0 merges, 10 arquivos, `diff --check` limpo, sem segredos, índice vazio. Push comum `51a79198:refs/heads/dev` (sem force). `origin/dev`=`51a79198`; `origin/main`=`99bec54e` intacta.

## Governança do I2b `e5d8730a-f64d-4135-a777-4ce29de3be66`
`work approve` (approved) → classificação humana seq 86507 (bounded/low/reversible/clear/normal). Contrato persistido == `command_i2b.json`; sem resume; base `51a79198`. Admissão RAM `permit`; Codex/WSL readiness `null` (OK; atenção: no Git Bash usar `MSYS_NO_PATHCONV=1`, senão `/home/...` vira caminho do Git e a readiness recusa com `single_item_codex_wsl_required`). Única recusa de orçamento: `user_attempt_budget_exhausted`.

## Lease E0
`21ab41f6-5fc4-4b19-9f12-9781dd4cfe3c`, 23:47:25Z→00:17:25Z, item+versão 1; admissão `human_supervised`, `bypassedUnattendedReason user_attempt_budget_exhausted`. Revogado logo após a attempt (`revoked_at` preenchido; 0 leases vigentes).

## Attempt única `d50d8744-7874-41f3-9d34-07ad6ac2f1d0`
`execute-one` 23:47:40Z→23:52:37Z (Codex 253 s). Eventos 86508–86518: routing, claimed, started, execution_started, checkpoint 86513, **execution_failed 86514** `[gate_failed]` no 1º gate (focado web, exit 1, 33 s), gate/coder/git evidence 86515–86517, claim liberada 86518. Item `failed`. Sem Verifier (sem handoff durável). Candidato: commit `389b76968af6c96613ccb259678ee00fc5912dd9` na branch `anima-work/d50d8744-…`, 4 arquivos (+221/−13), dentro do escopo. Sem retry/recovery.

## Causa raiz (revisão independente, worktree descartável removida)
A causa não ficou registrada (sem outputTail, a lacuna que o I2b-2 fecharia). Reproduzido: `worktree-executor.test.ts` não compila — TS2532 (`outputs[0]`/`outputs[1]` possivelmente undefined, noUncheckedIndexedAccess) nas linhas 1662, 1665, 1666 do teste do candidato. `worktree.test.ts` 82/82 PASS. Com `!` nessas 3 linhas (apenas na worktree descartável): `worktree-executor.test` 72/72 PASS e `tsc` web 0 erros. Ou seja, o defeito é só de tipagem do teste; a implementação é funcional.
Sonda com Jest real (captureJestReport do candidato, `@anima/core`): eligibility.test 105/105, verifier-opinion 26/26, host-observed-gate-evidence 52/52, gate-command-policy 15/15 ⇒ `testReport` ok; exit 0, comando original preservado, 0 diretórios temporários remanescentes; teste inexistente ⇒ exit 1, sem relatório; `withJestJsonReport` recusa caminho com espaço e `--json` duplicado. Arquivos com nomes de teste duplicados (acceptance-contract-lint.test) ou termos sensíveis (gate-test-report.test) ⇒ relatório omitido (`duplicate_test`/`sensitive_data`), conforme limitação conhecida do I2a (lacuna, nunca prova).

## Veredito
NÃO-GO para aceitar: o item está `failed` e o gate real não passou. Candidato recuperável por `recover-candidate` (sucessor proposed retomando o checkpoint) com correção das 3 linhas — ato humano separado. Nada aceito/integrado/publicado do I2b.
