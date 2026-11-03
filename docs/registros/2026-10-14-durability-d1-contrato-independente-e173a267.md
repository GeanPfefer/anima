# 2026-10-14 — Durability D1: contrato independente e173a267 (PROPOSED)

Registro append-only. Antecedentes: `2026-10-14-durability-d1-attempt-05d54bb2.md`, `2026-10-14-durability-d1-sucessor-61607ca5.md`, planos 068–070. US$0. Nenhum dado real do ANIMA lido; sem dump, backup, restore, migration, classificação, aprovação, attempt ou lease.

## Decisões
- O recovery `fad07a1f-c03b-4211-a42c-c353a1572694` (criado por `work recover-candidate` sobre 61607ca5, checkpoint f3cb77a) **não será executado**: (1) `autonomous-backlog-deps.ts` recusa `resume_from_checkpoint` no Single-Item V1 (`single_item_resumption_unproved`); (2) nenhum código entrega `candidate_recovery.corrections` ao prompt do Codex. Permanece `proposed`, sem attempt. Guards do Single-Item V1 **não** foram alterados.
- Novo item **independente** `e173a267-aa49-4c59-80eb-1aa85f172cd9` (v1, `proposed`), base `b6d2dda4550496ec8f5230d73488f014bc95d26c`, `acceptance_contract:2`, `max_attempts:1`, 40 min, sem `resume_from_checkpoint`, sem recovery, mesmo escopo de seis arquivos e mesmos três critérios (test_binding `min_new_tests:5`, typecheck web, escopo). Mensagem fonte `cfb454de-c664-49ed-bb47-68a3b9d54d6a`; eventos 86751–86752.

## Reaproveitamento de f3cb77a
Não há modo permitido de expor o commit ao executor: a worktree do Codex (WSL) tem `.git` com `gitdir: G:/anima/...` (caminho Windows) e o prompt proíbe ler fora da worktree. O commit é **só referência de leitura do supervisor**; fica em `historical_references` (`reference_commit_not_accessible_to_executor`). O executor recebe a especificação compacta do plano 070 (a mesma de 61607ca5) e os dois defeitos como **CORREÇÕES OBRIGATÓRIAS** no objetivo.

## Correções explícitas no objetivo
1. Fixture: `binary` é reservada no PostgreSQL; coluna bytea = `blob_col`; lista de outros reservados a evitar.
2. Formato LF × autocrlf: função pura `crlf_violation(data, autocrlf)` (CRLF puro só aceito com autocrlf true/input; CR solto, mistura ou CRLF sem autocrlf = violação), com testes unitários puros; mínimo de métodos subiu de 18 para 20.

## Medições (sem attempt)
- Instrução final do Codex (pipeline do host, item persistido): **17365** caracteres (limite 24000; margem exigida ≤21600 → folga 4235); objetivo 11780. `blob_col` e `autocrlf` presentes.
- `lintItemAcceptanceContract` v2: sem achados. Elegibilidade autônoma: elegível, sem lacunas. `singleItemContractRefusal` = null. `singleItemCodexRefusal` (env WSL só no processo) = null. Allowlist dos gates: true,true.
- Estado: dev = origin/dev = b6d2dda; main = 99bec54; 156 migrations; seq 86752; 0 claims e 0 leases vigentes; claim stale de julho inalterada.

## Fronteiras humanas / próximo ponto
Classificação, aprovação, lease E0 (cota 24 h ~21:03Z), `execute-one` e `work accept` continuam atos humanos separados, sem mandato até aqui. Antes: RAM livre ≥ ~25%, Docker ativo, env `ANIMA_CODEX_WSL_*` definido em PowerShell.
