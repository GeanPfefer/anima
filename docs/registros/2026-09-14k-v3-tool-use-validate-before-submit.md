# 2026-09-14k — V3 tool-use e validate-before-submit

Data: 2026-09-14

## Objetivo e limites

Investigar por que a attempt `3a367223` não usou SEARCH/GLOB/TEST/GIT e fortalecer o
Coding Harness V3 localmente. Nenhuma nova attempt, authority, OpenAI ou RunPod foi
usada; `origin/main` não foi tocada.

## Auditoria da trajetória real

A evidence persistida reconstrói 10 rodadas: READs nos quatro arquivos materiais nas
rodadas 0–4; READ de `openai-actual-cost-settlement.ts` e arquivos relacionados na
rodada 8; sete edits na rodada 10, aplicados em `post-turn-observation.ts` e
`autonomous-backlog-deps.ts`; término `returned` por esgotamento do laço. Foram 17
READs, zero SEARCH/GLOB/EXEC/GIT e nenhum submit explícito.

As tools estavam efetivamente no system prompt desde a primeira chamada: SEARCH/GLOB,
EXEC/TEST, Git read-only e submit eram anunciados com exemplos genéricos. Porém:

1. `request.validationCriteria` não era propagado ao `CoderEditRequest`; o modelo não
   recebeu os comandos focais reais;
2. investigação e pós-edit compartilhavam o mesmo teto; editar na rodada final levava
   à conclusão implícita sem nova oportunidade de TEST/diff;
3. havia orientação genérica, mas nenhuma fronteira que recusasse submit sem validação
   e self-review.

Classificação: capability A disponível; wiring A defeituoso para validation commands e
budget pós-edit; descrição B insuficientemente concreta; escolha C do modelo por não
usar as tools opcionais. A falha final foi possibilitada principalmente por A+B.

## Mudanças

- `CoderEditRequest.validationCommands` transporta labels e comandos estruturados já
  parseados/autorizados pelo host; não amplia a command policy.
- `WorktreeExecutorAdapter` converte os gates permitidos em program/args e injeta-os no
  runtime compartilhado.
- O prompt lista comandos concretos e adiciona contract discovery geral: SEARCH pelo
  tipo/enum/RPC/function/field, READ da definição real e rastreamento da origem factual;
  nenhum `provider_confirmed` ou detalhe do settlement foi hardcoded.
- Para tarefas com validation commands e edits, submit exige uma validação focal com
  exit0 e `git diff` após o edit mais recente. Exit1 bloqueia submit e volta como
  observação recuperável; novo edit invalida ambas as provas.
- Submit prematuro recebe feedback bounded. O budget pós-edit adiciona espaço para
  EDIT/EXEC/submit após esgotar READ/SEARCH/GLOB; não há mais conclusão implícita
  inválida. Sem validation command, o comportamento retrocompatível permanece.
- A instrução de reparo de schema agora enumera todas as ações realmente disponíveis.

Arquivos de implementação/teste alterados nesta fatia (sobre o WIP V3 existente):

- `apps/web/lib/work-orchestration/coder-backend.ts`;
- `apps/web/lib/work-orchestration/worktree-executor.ts`;
- `apps/web/lib/work-orchestration/worktree-executor.test.ts`;
- `apps/web/lib/work-orchestration/ollama-coder.ts`;
- `apps/web/lib/work-orchestration/ollama-coder.test.ts`.

## Provas

- Core focal das três fatias: 3 suites / 18 testes PASS.
- Web regressão V3 e adjacentes: 8 suites / 308 testes PASS.
- Testes novos provam: submit recusado sem teste; exit1→edit→exit0; nova edição invalida
  prova; SEARCH→READ→EDIT; comandos concretos no prompt; contract discovery sem valor
  hardcoded; diff obrigatório; task sem validation command compatível; OpenAI herda o
  mesmo runtime compartilhado; fixture comportamental `7143d697` não pode concluir no
  fim do budget sem gate/diff.
- Typecheck core PASS.
- Typecheck web não ficou globalmente verde por erros preexistentes e fora desta fatia
  em scripts operacionais (`confirm-correction-prepaid-readonly.ts`,
  `create-seq5-recovery-successor.ts`, `revoke-d05bcab0-authority.ts`). Nenhum erro foi
  reportado nos arquivos desta mudança pelas suítes ts-jest.

## Estado final

- Branch `dev`; HEAD permaneceu `b14a32c1d7ca1d361f1a3c1519e2fbec351a0669`;
  mudanças seguem como WIP sem commit, preservando o trabalho existente.
- `origin/main` permaneceu `99bec54e3ab42bfe882a8686cd1385d8058b916e`.
- Benchmark settlement continua congelado; item `7e0a75cf` permanece terminal e não foi
  reaberto; authority/reservations não foram mutadas.
- Readiness: a fundação tool-use/validate-before-submit está verde nos testes focais e
  regressões V3. Antes de novo benchmark pago, decisão humana deve criar successor e
  authority novos e aceitar separadamente o typecheck web global bloqueado por WIP
  operacional preexistente ou corrigir esses scripts em escopo próprio.
- Razão da parada: objetivo local concluído até a fundação verde; nenhuma nova execução
  paga autorizada.
