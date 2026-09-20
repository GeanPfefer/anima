# Precedência semântica da intenção no Chat Dev

- **Data/tipo:** 2026-09-19 — desenvolvimento e prova local.
- **Objetivo:** restaurar o caminho `interpretWorkRequest → Project Work Planner
  → createProposal` para solicitações novas sem quebrar comandos sobre Work Items.
- **Branch:** `dev`.
- **HEAD inicial:** `8eb00a8e9cacf526dcb382993e682ff0532017de`.
- **HEAD final:** commit único desta sessão, identificável pelo assunto
  `Roteie novas solicitações Dev antes de handlers de itens existentes`.

## Mudanças e decisões

- O Chat Dev passou a classificar uma vez, sem efeitos, a intenção como nova
  solicitação, referência/comando existente, fila autônoma, consulta ou conversa.
- `new_work_request` vence handlers incompatíveis, reutiliza a interpretação pura
  e recebe o `sourceMessageId` real somente apó a mensagem ser persistida.
- Ordinal não é mais referência global: requer substantivo de trabalho ou uma
  referência conversacional inteira sobre itens apresentados.
- Mandato autônomo exige verbo positivo; negação anterior ao verbo na mesma
  oração remove autoridade conservadoramente.
- `corrigir` agora materializa `request_kind: change`, coerente com a capability
  `programming` já reconhecida.

## Provas

- Core focal: 3 suítes, 87 testes verdes.
- Web focal: 5 suítes, 68 testes verdes.
- As duas mensagens reais do incidente estão cobertas integralmente e resultam
  em `new_work_request` com `programming/change`.
- Typecheck `packages/core`: PASS.
- Typecheck `apps/web`: PASS.
- Reexecução web focal: 5 suítes, 68 testes verdes.
- `git diff --check`: PASS (apenas avisos de conversão LF/CRLF do ambiente).

## Limites e invariantes

- Nenhum Work Item, approval, attempt, banco ou serviço foi criado/executado.
- Nenhum provider/compute pago, Claude, navegador, push, merge ou efeito externo.
- `origin/main` não foi tocada; WIP pré-existente foi preservado.
- Itens completed/cancelled continuam consultáveis por ID/referência contextual
  real, mas não participam do roteamento de uma solicitação nova.

## Retomada

O próximo passo permitido é uma prova humana posterior pela UI do Chat Dev. O
experimento funcional de `getEraForLevel` não foi criado nem executado nesta sessão.
