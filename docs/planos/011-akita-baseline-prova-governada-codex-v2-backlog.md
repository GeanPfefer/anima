# Backlog dedicado — prova governada com Codex CLI (v2, após o fix de coder evidence)

Documento de backlog canônico com UM único candidato, criado após a integração em `dev` do
commit `f518d0d` ("Corrija evidência do coder para backends CLI nativos"). O materializer
canônico lê só o documento apontado; este arquivo não altera o 009, o 010, o backlog do Modo
Autônomo V0 nem o do TPC.

Histórico factual preservado, sem mutação:

- AKT-01 (documento 009, work item `8cd2a4f1`, attempt `e337c72f`): FAIL pré-inferência. O
  executável do Codex CLI não foi encontrado (ENOENT) por erro de operador no
  `ANIMA_CODEX_CLI_PATH` de um script scratch; o Codex nunca foi lançado.
- AKT-02 (documento 010, work item `4b7d0a13`, attempt `8ee9ab5c`): o Codex executou, gate e
  escopo passaram e o Verifier deu `verified`, mas o item ficou BLOQUEADO em `in_progress`:
  `host_observed_coder_evidence_recorded` não foi persistido porque o backend declarava
  `placement: 'remote'` com `nodeId: null`, recusado por `buildHostObservedCoderEvidence`. O fix
  `f518d0d` remove essa observação inválida dos backends CLI nativos.

Este candidato (AKT-03) refaz a mesma tarefa como prova independente, com a base no `origin/dev`
que já contém o fix. Não recupera nem reinterpreta AKT-01/AKT-02.

## AKT — Prova governada com Codex CLI (v2)

### AKT-03 — Cobertura explícita de getEraForLevel para os níveis 5 e 30

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
