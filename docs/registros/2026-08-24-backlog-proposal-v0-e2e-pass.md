# Backlog Proposal V0 — materialização E2E

- **Data / tipo:** 2026-08-24 — prova viva pela UI real.
- **Branch:** `dev`.
- **HEAD de entrada:** `fb9fcc83783fdac39334c0dcea90ec3f9329f653`.
- **Resultado:** `BACKLOG_PROPOSAL_V0_E2E = PASS`.

A confirmação humana canônica foi enviada uma vez pela UI real e resolvida no
host antes do chat comum. A V2 `a76c5acf-3e6f-41d9-a8b4-170d51be2d13`, versão
2, passou de `awaiting_confirmation` para `materialized`; a V1
`9dc0b976-030b-4c77-8001-934544042814` permaneceu `changes_requested`. Nenhum
provider foi chamado.

A RPC transacional criou exatamente três itens `proposed`:

- `0cedae21-433d-4842-8fbd-9045c5128bcf` —
  `local-first-capacity-cost-policy`, sem dependências;
- `b2930e81-3f19-48f5-92ab-a27e10633896` —
  `paid-compute-human-gate`, depende do primeiro slice;
- `1257f22f-03dd-464c-bafb-d90744c9f92e` — `paid-compute-audit`, depende do
  segundo slice.

Cada `intent.backlog_provenance` preserva slice/dependências, proposta/versão 2,
decisão ratificada `1dedfd5f-0f19-4e8a-8ac5-fcc54a304fbb` versão 1 e mensagem
humana de confirmação `afd1b102-d157-44d9-ac93-6d651e7c6929`. A proposta tem
um único evento humano `materialization_confirmed` e um único evento do sistema
`materialized`.

O replay da mesma RPC, como a mesma identidade autenticada, com a mesma mensagem
e chave, retornou `action=replayed` e os mesmos três IDs. Contagens antes/depois
da materialização e após o replay: `work_items 60 → 63 → 63`, `work_events
601 → 607 → 607`, `work_focus 2 → 2 → 2`, approvals `48 → 48 → 48`,
`execution_started 41 → 41 → 41`, `work_started 43 → 43 → 43` e
`ai_conversations 202 → 203 → 203`. A única conversa nova é a mensagem humana;
nenhuma resposta de chat comum foi criada.

Cada item recebeu somente `work_proposed` e `context_attached`. Não houve
approval, autonomous authorization, claim, attempt, execution, Supervisor,
coder, cloud, PR, merge ou deploy. Uma primeira invocação local do comando de
replay falhou no parsing do shell antes de chegar ao banco; a chamada corrigida
foi a única execução da RPC de replay e não houve efeito intermediário.

**Fronteira humana:** os três itens permanecem apenas `proposed`. Aprovar ou
executar qualquer um deles exige nova decisão explícita.

