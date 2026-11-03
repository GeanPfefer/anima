# Backlog dedicado — primeira prova governada pós Akita Baseline

Documento de backlog canônico com UM único candidato, criado como infraestrutura da primeira
prova governada com o Codex CLI (`coder_backend: codex-cli`) após o Akita Baseline V1. O
materializer canônico lê só o documento apontado; este arquivo não altera o backlog do Modo
Autônomo V0 nem o do TPC.

O item anterior da prova (`bc4a66ab`) foi retirado antes da execução porque nasceu com um
planner id (`operator_supervisor_claude_v0`) sem proveniência canônica, origem não reconhecida
pela política de classificação. Este candidato reabre a tarefa pelo caminho canônico, com
proveniência derivada deste documento.

## AKT — Primeira prova governada com Codex CLI

### AKT-01 — Cobertura explícita de getEraForLevel para os níveis 5 e 30

- **Status:** not_started
- **Objetivo:** Adicionar em `packages/core/src/levels.test.ts` casos explícitos de `getEraForLevel`: nível 5 => `Despertar` e nível 30 => `Expansão`, sem remover nem alterar os casos existentes e sem nenhuma alteração de código de produção.
- **Dependências:** (nenhuma)
- **Escopo incluído:** packages/core/src/levels.test.ts
- **Fora de escopo:** packages/core/src/levels.ts, todo o restante do código de produção, apps/web, apps/mobile, packages/types, supabase, todo o restante do repositório
- **Critério de validação:** npm test --workspace=packages/core -- levels.test.ts
- **Tentativas:** max_attempts = 1 (prova experimental: sem retry nem sucessor); max_duration_minutes = 30
- **Verifier:** verifier_requirement = required_fail_closed
- **Aceite:** A execução altera somente `packages/core/src/levels.test.ts`.
- **Aceite:** A suíte focal de levels passa.

Nota de revisão humana: os aceites acima são os únicos claims machine-provable pelo Verifier
atual (contenção de escopo observada pelo host e gate focal verde). A existência e a correção
dos casos 5 => Despertar e 30 => Expansão, a preservação dos casos existentes e a
qualidade/legibilidade dos testes serão conferidas na REVIEW HUMANA e NÃO são claims
machine-proven. Um PASS do Verifier significa apenas gate focal verde + escopo contido.
