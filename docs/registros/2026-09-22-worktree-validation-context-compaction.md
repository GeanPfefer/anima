# Paridade de validação da worktree e compactação do contexto EXEC

**Data:** 2026-09-22  
**Tipo:** desenvolvimento + prova determinística  
**Branch:** `dev`  
**HEAD de partida:** `5525a56`  
**Commit local:** o commit que introduz este registro e o hardening (sem push)

## Objetivo

Preparar a infraestrutura para a próxima prova consciente do self-dev sem executar a terceira attempt: corrigir a indisponibilidade de `ts-jest` dentro do coder e avaliar o overflow `6884 > 6656` sem aumentar limites cegamente.

## Causa da indisponibilidade de dependências

O repositório principal possui `node_modules/ts-jest` e `node_modules/jest`; `packages/core` usa hoisting e não possui `node_modules` próprio. `GitWorktree.linkNodeModules()` já recriava corretamente, por junction, o layout físico da raiz e dos workspaces sem instalar dependências.

A ordem estava errada. `executor-selection.ts` configurava `linkNodeModules: true`, mas `WorktreeExecutorAdapter` chamava `linkNodeModules()` somente depois de `backend.edit()`. O Harness V3 executa `npm test` dentro de `backend.edit()`. Logo:

1. coder executava na worktree sem junction e Jest não resolvia o preset `ts-jest`;
2. somente depois do submit do coder o host ligaria dependências e rodaria o gate final;
3. no retry interno a junction era novamente removida antes de devolver controle ao coder.

É uma falha geral de paridade coder/host, não específica de `levels.ts`, Jest ou instalação.

## Correção

- A preparação canônica (`linkNodeModules` + `prepareValidation`) ocorre antes de cada `backend.edit()`, inclusive retries.
- A preparação continua sendo refeita antes dos gates autoritativos, pois edits podem invalidar artefatos gerados.
- Junctions continuam removidas antes de restore/clean/dispose e antes de realimentar o próximo turno; a volta seguinte as recria explicitamente.
- Nenhum `npm install`, rede, dependência nova ou autoridade adicional foi introduzido.

## Context budget

O crescimento observado foi parcialmente saudável: o modelo recebeu sucessivas falhas reais, tentou o gate focal, uma alternativa ampla, uma instalação corretamente recusada, repetiu o gate e tentou typecheck. A causa primária dessa recuperação era o ambiente sem dependências.

Havia também acumulação desnecessária. Cada observação EXEC renderizada era anexada a `servedBlocks` e reemitida integralmente para sempre; cada stdout e stderr podia carregar até 8.000 caracteres. O último typecheck grande somou-se a todos os comandos anteriores e levou o prompt a 6.884 tokens, 228 acima do budget.

A correção compacta o corpo de observações EXEC antigas antes de anexar a nova. O prompt preserva comando, exit, duração e indicação de compactação das anteriores, além do stdout/stderr integral da observação corrente. Leituras e âncoras permanecem intactas porque autorizam edits. O transcript host-observed preserva as observações completas dentro de seus limites de persistência. `num_ctx`, output reserve e guards de truncation permanecem inalterados.

## Regressões e provas

- `worktree-executor.test.ts`: self-validation `npm test` dentro do backend exige `node_modules` visível na primeira volta e no repair.
- `ollama-coder.test.ts`: duas saídas EXEC enormes provam que a anterior vira resumo, a corrente permanece disponível e o fluxo conclui.
- Suíte focal completa do executor: 54/54 PASS.
- Suíte focal completa do coder Ollama: 72/72 PASS.
- Typecheck `apps/web`: PASS.
- Worktree sintética destacada em `5525a56`, com junction apenas para o `node_modules` físico: `npm test --workspace=packages/core -- src/levels.test.ts` — 10/10 PASS. A worktree e a junction foram removidas após a prova.

## Segurança e efeitos externos

- Nenhuma attempt, retry, claim, reconciliação, Work Item ou resultado histórico foi alterado.
- `packages/core/src/levels.ts` e `levels.test.ts` não foram alterados.
- Zero OpenAI, RunPod, compute pago, browser, push, PR, merge, deploy ou `db reset`.
- Nenhuma dependência foi instalada.
- Worktrees históricas e WIP preexistente foram preservados.

## Próximo ponto exato

Após revisão humana, executar deliberadamente a terceira attempt do mesmo Work Item — e somente ela — com Ollama local disponível. Observar se o coder completa TEST→DIFF→SUBMIT e parar em `review` ou no terminal explícito, sem aceitar nem integrar automaticamente.
