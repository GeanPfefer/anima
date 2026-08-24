# Backlog Proposal V0

- **Data / tipo:** 2026-08-24 — desenvolvimento e prova local determinística.
- **Branch / HEAD inicial:** `dev` / `1b4672153c0ab2a7a744faf35f093293a5197811`.
- **Objetivo:** decisão ratificada → proposta de backlog → confirmação humana → itens `proposed`.
- **Resultado:** `BACKLOG_PROPOSAL_V0_LOCAL = PASS`.

## Entrega

Criados domínio puro de slices/validação/conversa, boundary provider-agnostic com
portos injetáveis e substrate persistente versionado. A implementação reutiliza
os contratos de decisão e trabalho existentes; não cria planner ou backlog
paralelos. Quatro migrations append-only entregam tabelas/eventos/view/RLS/RPCs,
projeção de estado, replay estrito e constraint integral dos slices.

A materialização ocorre em uma única transação. Na fixture local, dois slices
causais (`node-inventory` e `local-first-routing`) viraram dois itens `proposed`;
o segundo preservou dependência do primeiro. O rollback do pgTAP removeu toda a
fixture. Nenhum item real foi criado.

## Provas e invariantes

- Core pertinente: 46 testes, incluindo governança de decisão e materialização canônica.
- Web pertinente: 33 testes, incluindo chat, replay de decisão e materializer canônico.
- pgTAP: 31/31, com duas identidades, RLS, revisão, versão antiga, atomicidade,
  idempotência, provenance, dependência e execution spec inválido.
- Typecheck: cinco workspaces.
- Build Next: 56 páginas, com dev parado.
- `git diff --check`: PASS.

Sem egress, provider, browser automation, `service_role` no fluxo, reset de banco,
approval, auto-authorization, claim, attempt, Supervisor, coder, PR, merge ou
deploy. `origin/main`, `.worktrees/`, configuração local e segredos preservados.

## Limites e retomada

A integração conversacional está provada por fixtures/doubles, não por UI real.
O planner técnico real não foi chamado; futura E2E que precise provider exige
autorização de egress própria. Próximo ponto exato: prova E2E manual da UI com
decisão controlada, proposta, revisão opcional, confirmação e auditoria de que
somente itens `proposed` surgem. Parar antes de approval/execution.
