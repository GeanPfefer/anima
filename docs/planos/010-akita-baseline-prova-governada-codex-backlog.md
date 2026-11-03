# Backlog dedicado — prova governada com Codex CLI (segunda tentativa honesta)

Documento de backlog canônico com UM único candidato, criado após o Akita Baseline V1. O
materializer canônico lê só o documento apontado; este arquivo não altera o 009, o backlog do
Modo Autônomo V0 nem o do TPC.

Histórico factual preservado: o candidato AKT-01 (documento 009, work item `8cd2a4f1`) foi
aprovado, classificado e admitido, mas sua única attempt (`e337c72f`) falhou ANTES de qualquer
inferência: o executável do Codex CLI não foi encontrado (ENOENT) por erro de operador no
`ANIMA_CODEX_CLI_PATH` de um script scratch. O Codex nunca foi lançado. O budget de 1 attempt
foi consumido e nenhum mecanismo canônico concede +1 ao mesmo item sem criar successor; por
decisão humana, a tarefa é refeita como um novo candidato (AKT-02), sem recuperar nem reinterpretar o AKT-01.

## AKT — Prova governada com Codex CLI

### AKT-02 — Cobertura explícita de getEraForLevel para os níveis 5 e 30

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
