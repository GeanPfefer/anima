# Chat Dev — admissão e progresso canônicos

- **Data/tipo:** 2026-09-09 — desenvolvimento e reconciliação.
- **Objetivo:** ligar seleção autônoma explícita ao caminho canônico de execução e
  tornar seu progresso persistido visível até review ou bloqueio.
- **Branch/HEAD:** `dev`, HEAD inicial/final
  `d783a5dc495da692eb7097f7c7252bb5ba074e51` (sessão sem commit).
- **Git remoto reconciliado:** `origin/dev` em `4ab99acf...`; `origin/main` em
  `99bec54e...`, sem checkout, merge, push ou alteração de `main`.

## Mudança

- O detector distingue consulta de mandato explícito de execução; chat normal e
  consulta continuam conservadores.
- A execução usa `request_autonomous_execution`, igual ao cartão. A RPC revalida
  versão/aprovação/fila e somente registra o sinal para o Resident Host.
- Uma perda de elegibilidade é reconciliada antes da resposta e não executa estado
  stale; outras recusas viram fronteira humana estruturada.
- A UI abre o item selecionado e consulta `/items/:id` a cada 5 s. Cada resposta
  substitui a projeção anterior; polling para em review, decisão humana ou terminal.
- O cartão mostra espera de admissão, attempt/provider/model/checkpoint existentes,
  bloqueio persistido e `Review — aguardando decisão humana`.

## Reconciliação e provas

- Supabase local saudável. O item real `8a2515d8...` permaneceu `approved v2`,
  sem claim e sem `execution_started`/attempt; a authority RunPod nova segue ativa
  e item-scoped, enquanto a anterior continua revogada.
- Core focal: 3 suítes, 99 testes verdes (seleção, apresentação e execução).
- Web focal: 5 suítes, 81 testes verdes. Warnings React conhecidos da fixture
  `u1` e de updates assíncronos permanecem flakes de teste, não falhas.
- Typecheck web continua bloqueado exclusivamente pelo WIP externo conhecido em
  `autonomous-backlog-deps.ts:198` (`null` não atribuível a `string`).

## Segurança e efeitos externos

- Nenhum navegador foi aberto. Nenhuma execução real foi disparada nesta sessão.
- Zero claim, attempt, worktree, coder, provider call, Pod, accept, integração,
  merge, publish ou deploy causados por este patch.
- O provider selecionado no chat não concede compute ao executor; roteamento e
  paid authority do fluxo canônico permanecem independentes.
- Próximo ponto: prova humana na UI com Dev + GPT e o mandato real; observar o
  cartão até review ou o blocker canônico de cotação, sem contornar a authority.
