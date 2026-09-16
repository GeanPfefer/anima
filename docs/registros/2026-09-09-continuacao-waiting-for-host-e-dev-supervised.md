# Continuação — waiting_for_host, dedupe do Resident Host e comando Dev composto

- **Data/tipo:** 2026-09-09 — continuação do WIP parcial do Codex (finalização + testes).
- **Objetivo:** fechar honestamente o lifecycle local web → Resident Host → Supervisor,
  distinguindo "admitido" de "rodando", sem criar segundo executor nem duplicar attempt.
- **Branch/HEAD:** `dev`, HEAD `d783a5dc495da692eb7097f7c7252bb5ba074e51` (sessão SEM commit;
  push permanece retido por decisão humana, conforme snapshot durável).
- **Git remoto:** `origin/main` INTACTA; nenhum checkout/merge/push/reset/stash destrutivo.
  WIP externo (RunPod/compute/CLI) preservado integralmente.

## Estado herdado (WIP do Codex, reconciliado)

- Núcleo: `projectAutonomousAdmission` + fase `waiting_for_host` derivadas do evento
  `work_approved`/`autonomous_execution_request` persistido (nunca de timer do front).
- UI: `WorkProposalCard` faz polling canônico (5 s) quando `trackAutonomousProgress`,
  parando em review/decisão/terminal; `ChatClient`/`ProjectWorkPanel` abrem o item pelo
  header `X-Anima-Autonomous-Work`.
- Rota `/api/ai/chat`: mandato explícito de execução delega à mesma admission RPC do cartão
  (`request_autonomous_execution`); consulta segue read-only; recusa/stale viram fronteira.
- Comando composto `npm run dev:supervised` (`tools/dev-supervised.mjs`) sobe Web + Resident Host.

## Correções de finalização (o patch NÃO estava completo)

1. **Texto do cartão incoerente com o teste.** O ramo "selecionado, sem admissão persistida"
   dizia "Selecionado; aguardando persistência da admissão." enquanto o teste do painel exigia
   "Aguardando admissão da execução pelo Resident Host." Alinhado o cartão ao contrato.
2. **Regressão gramatical do WIP.** O ramo `completed` sem resultado verificável passara a
   "não puderam ser verificad**os**" (concorda errado com "evidências"), quebrando teste
   pré-existente. Revertido para "verificad**as**".
3. **Honestidade do texto do chat (Parte 1).** O sufixo de admissão afirmava "Acompanharei os
   eventos… até review" como se já executasse. Reescrito para dizer explicitamente que a
   execução **ainda não está em curso**, que só avança quando o Resident Host consumir a
   solicitação (`npm run dev:supervised`) e que, sem início de execução, o cartão mostra
   "Aguardando Resident Host". Mantido dentro do bloco read-only (o guarda de rota que proíbe
   `claim|coder|startExecution|supervisor` nesse trecho continua verde).

## Dedupe (Parte 3) — confirmado por design e por teste, sem alterar histórico

- O Resident Host (`in-process-host-turn.ts`) lê os `work_approved` com autoridade de execução
  e escolhe **um** item por volta (o primeiro sem `execution_started` posterior, e então `break`).
  Um único `execution_started` (seq > ambos os pedidos) marca as **duas** requests como
  consumidas. A exclusividade da attempt continua no claim canônico dentro de `runHostTurn`.
- Nenhum evento append-only foi apagado; as duas admissões (seq 51570/51571) do item real
  `8a2515d8…` permanecem intactas.

## Testes adicionados (nenhum símbolo novo tinha cobertura antes)

- `packages/core/.../presentation.test.ts` (+8): admissão projetada, fase `waiting_for_host`,
  duas requests ⇒ uma admissão, versão anterior não conta, execução anula admissão (fail-safe).
- `apps/web/lib/resident-host/in-process-host-turn.test.ts` (+3): admissão pendente vira
  `requestedWorkItemId`; duas requests ⇒ um único item/volta; com `execution_started` nenhuma
  é reentregue.
- `apps/web/.../WorkProposalCard.test.tsx` (+3): "Aguardando Resident Host" + `dev:supervised`
  sem afirmar execução; polling canônico que **para em review**; sem `trackAutonomousProgress`
  não há polling.
- `apps/web/lib/resident-host/dev-supervised-command.test.ts` (novo): wiring do `dev:supervised`
  (existe, reusa `dev:web` + `local-host`, stdio herdado, encerramento por sinal).

## Provas

- Núcleo focal: `presentation` + `autonomous-chat-selection` + `autonomous-selection` +
  `autonomous-queue` = 4 suítes / 138 testes verdes. `typecheck` do core: exit 0.
- Web focal (caminho tipado): `ProjectWorkPanel`, `ChatClient`, `WorkProposalCard`,
  `autonomous-work-selection`, `project-item-drilldown-route`, `dev-supervised-command`,
  `openai-interactive-admission` = 7 suítes / 90 testes verdes.
- `in-process-host-turn.test.ts`: 11/11 verdes em execução **transpile-only** (harness de config
  isolado no scratchpad; nada commitado). O caminho tipado da suíte segue bloqueado
  EXCLUSIVAMENTE pelo WIP externo conhecido `autonomous-backlog-deps.ts:198`
  (`p_attempt_id: null` contra o tipo `string` regerado em `packages/types/src/database.ts`,
  do arco RunPod/Compute Router) — fora do escopo desta tarefa; não tocado.
- `npm run typecheck` (web): **um único** erro, o mesmo `autonomous-backlog-deps.ts:198`.
  Nenhum novo erro de tipo introduzido.
- `dev:supervised`: contrato verificado por harness node (spawn fake): sobe os dois com stdio
  herdado; SIGINT/SIGTERM derrubam o par; crash (exit≠0) vira `exitCode` e derruba o par; stop
  idempotente; saída 0 não marca erro.
- `git diff --check`: limpo (só avisos CRLF).

## Segurança e efeitos externos

- Nenhum navegador aberto (validação visual manual é do usuário).
- Zero execução real disparada: nenhum claim, attempt, worktree, coder, chamada de provider,
  Pod, accept, integração, merge, publish ou deploy. Resident Host NÃO foi iniciado por mim.
- Zero OpenAI/Anthropic e zero compute pago fora das authorities existentes. A authority RunPod
  item-scoped de `8a2515d8…` NÃO foi tocada.
- Sem commit: o patch fica como WIP coerente para revisão humana, junto do WIP externo, sem
  esconder nada (push retido por decisão humana).

## Próximo ponto (humano)

- Subir o ambiente com `npm run dev:supervised` e, no chat Dev, dar o mandato real ao item
  `8a2515d8…`. Observar o cartão: "Aguardando Resident Host" enquanto o host estiver ausente;
  ao consumir, claim → execução → review. Se o item chegar à admissão de compute e o A40 estiver
  disponível, um Pod pago pode nascer DENTRO da authority vigente — não contornar nem recriar
  authority.
