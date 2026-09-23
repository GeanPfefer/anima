# Review-correction: preservação semântica e handoff do successor

**Data:** 2026-09-22  
**Tipo:** prova real + desenvolvimento  
**Branch:** `dev`  
**HEAD inicial:** `d91fe6c`  
**HEAD final:** commit que contém este registro (consultar `git log -- this-file`)

## Objetivo

Fechar duas falhas reveladas pela prova real de self-development sem reescrever
histórico nem executar a unidade real: uma menção preservadora reabria arquivo do
checkpoint no `rework_scope`, e a UI continuava focalizando o predecessor após a
criação bem-sucedida do successor.

## Estado e evidência da prova

- Predecessor `a703e92f-ebbc-41ca-ace6-779a94c92c6c`: `changes_requested` v2,
  3/3 attempts históricas e nenhuma claim aberta.
- Checkpoint preservado: branch
  `anima-work/d014fe6e-267e-424e-9e79-ad2e6aaa80df`, commit
  `9a60f426c307c0c7c4085aea8702f4af5e9da245`.
- Successor `bc407a1b-2d35-4862-91ff-202f596e4d67`: `proposed` v1, 0/3,
  sem aprovação, classificação, claim ou execução.
- Lineage `407de64d-55f3-4c90-a781-d9a893965e43`, sequência 1. O registro e os
  eventos reais permaneceram append-only e intocados.

## Causas e correções

1. `deriveExplicitReworkScope` fazia matching de qualquer ocorrência de path no
   feedback. Como `levels.ts` aparecia numa frase de preservação, a mera menção
   era promovida indevidamente a autoridade de escrita.
2. `WorkProposalCard.mutate` tratava review-correction como mutação comum e, no
   sucesso, `reload()` buscava `/items/${item.id}` — sempre o predecessor.

O restante continua sendo derivado de fatos host-observados. Texto livre agora
só reabre arquivo tocado quando uma cláusula contém diretiva positiva de rework,
sem diretiva de preservação; basename ambíguo continua fail-closed. O handoff usa
o `successorWorkItemId` da resposta, chama a rota canônica de foco e carrega esse
ID com `no-store` antes de atualizar a apresentação. Recusa de derivação não
altera foco nem apresentação.

## Commits

- `c89beab` — `Preserve o checkpoint na correção de review`.
- Documentação canônica: commit que contém este registro.

## Provas e gates

- `review-correction-orchestration.test.ts`: 11/11 PASS.
- `WorkProposalCard.test.tsx`: 57/57 PASS.
- `ChatClient.test.tsx` + `ProjectWorkPanel.test.tsx`: 15/15 PASS.
- `npm.cmd run typecheck --workspace=apps/web`: PASS.
- `git diff --check`: PASS.
- Avisos conhecidos, não regressões: warnings `act(...)` antigos no teste do
  cartão e chaves duplicadas em fixtures do `ChatClient`; ambas as suítes passam.

## Invariantes e efeitos externos

Nenhum Work Item foi aprovado, classificado, claimed, autorizado ou executado;
nenhuma attempt foi consumida; nenhum compute pago, OpenAI, RunPod, browser,
push, PR, merge, deploy ou alteração de banco ocorreu. `origin/main`, `.worktrees/`,
`watch4-sensors.txt` e WIP preexistente foram preservados.

## Fronteira humana e retomada exata

`BLOCKED_BY_HUMAN_DECISION`: o successor v1 real tem envelope historicamente
incorreto e não deve ser editado silenciosamente. A revisão genérica v2 usa um
planner e não preserva por contrato a semântica especial de lineage/checkpoint.
Recomendação canônica: o humano rejeita o successor ainda `proposed`; depois,
aciona uma nova derivação no predecessor, que usará sequência nova e o contrato
corrigido. Parar antes dessas duas mutações.
