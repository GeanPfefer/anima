# Stall visual pós-coder da attempt 8748b9c4

**Data:** 2026-09-22  
**Tipo:** prova + desenvolvimento  
**Branch:** `dev`  
**HEAD inicial:** `5e3e4b3b298fbb03c4d2843ef95d1ba4172204b7`  
**Commit local:** o commit que introduz este registro e a correção do card (sem push)

## Objetivo

Preservar e diagnosticar a attempt autônoma real `8748b9c4-37b4-4ec2-8208-d8deb95d1c54`, observada na UI como `in_progress` sem checkpoint, e corrigir a classe estrutural da falha sem retry, nova attempt ou alteração do Work Item alvo.

## Evidência real preservada

- Work Item `a703e92f-ebbc-41ca-ace6-779a94c92c6c`, proposta v2.
- `execution_started` seq `54457`, às `2026-09-22 00:25:48.417506Z`.
- `execution_failed` seq `54458`, às `00:26:46.599941Z`: `[ollama_context_budget_exceeded] prompt estimado em 6884 tokens excede o orçamento de input 6656 (num_ctx 8192)`.
- Claim `0569bb2d-4a0e-40d3-9251-0666babe6ba6`, liberada às `00:26:46.626077Z` com `attempt_finished` (seq `54459`).
- Evidência do coder seq `54460`: duração host-observed `51.658 ms`, outcome `failed`, transcript preservado. O coder leu `levels.ts`, aplicou uma edição isolada, executou o gate focal (falhou por `ts-jest` ausente), tentou comandos alternativos governados e foi recusado ao pedir `npm install`; a próxima composição do prompt excedeu o budget antes de nova chamada.
- A branch `anima-work/8748b9c4-37b4-4ec2-8208-d8deb95d1c54` existe e aponta para a base autorizada `aabe73a`; o worktree temporário foi descartado após a restauração fail-closed. Não houve commit/checkpoint durável da edição.

## Causa raiz comprovada

A attempt não stallou. O `WorktreeExecutorAdapter` materializou o worktree antes de `backend.edit()`, recebeu e executou o protocolo Ollama, capturou a exceção tipada, restaurou a árvore e emitiu um terminal `execution_failed`; o Supervisor persistiu o terminal e liberou a claim.

O stall foi visual. `WorkProposalCard` já implementava polling canônico opt-in de 5 s e parada em terminal, mas os cards renderizados por `ChatClient` junto às mensagens nunca recebiam `trackAutonomousProgress`. Só o card do `ProjectWorkPanel` recebia a prop. A apresentação da mensagem, portanto, ficava congelada no snapshot obtido logo após a admissão/início, enquanto o cronômetro e os probes de Ollama do `WorkExecutionCard` continuavam atualizando localmente.

## Mudança

- [`ChatClient.tsx`](../../apps/web/app/(app)/chat/_components/ChatClient.tsx): ativa o acompanhamento para o item explicitamente rastreado ou para execução autônoma projetada como `running`, tanto em cards de origem quanto de histórico.
- [`ChatClient.test.tsx`](../../apps/web/app/(app)/chat/_components/ChatClient.test.tsx): regressão hidrata um card `in_progress`, entrega uma projeção `failed` na leitura seguinte e exige a transição visual terminal.
- Estado vivo atualizado no PRD e neste plano.

## Provas

- `npx.cmd jest --runInBand --runTestsByPath 'app/(app)/chat/_components/ChatClient.test.tsx'` — PASS, 13/13.
- `npm.cmd run typecheck --workspace=apps/web` — PASS.
- Uma invocação anterior com filtro incompatível no Windows iniciou acidentalmente uma suíte web ampla; foi interrompida. Antes da interrupção houve uma falha flake preexistente no caso concorrente de `worktree-executor.test.ts` (`Expected result, Received error`), enquanto vários outros arquivos passaram. Não é resultado da mudança do card e não foi usado como gate.

## Invariantes e efeitos externos

- Attempt real, item, claims, eventos, branch e transcript foram somente lidos; nenhuma reconciliação foi executada.
- Nenhuma terceira attempt, retry, cancelamento, pausa, aceite, integração ou edição de `levels.ts`/`levels.test.ts`.
- Nenhum OpenAI, RunPod, compute pago, navegador, push, PR, merge, deploy ou `db reset`.
- `origin/main` permaneceu em `99bec54e3ab42bfe882a8686cd1385d8058b916e`; `origin/dev` em `8fe56d49f6a1da032912080e4993720ed91dfcc9`.
- Todo WIP e todos os worktrees existentes foram preservados.

## Próximo ponto exato

Investigar a preparação de dependências da worktree e o crescimento do context budget por reprodução determinística, sem consumir a terceira attempt. A attempt histórica permanece intocada até decisão humana posterior.
