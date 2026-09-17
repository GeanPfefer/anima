# Seleção autônoma de Work Item no chat Dev

- **Data/tipo:** 2026-09-09 — desenvolvimento e reconciliação de prova.
- **Objetivo:** impedir que um mandato explícito de self-development devolva ao
  humano a escolha entre predecessores históricos `failed`.
- **Branch:** `dev`.
- **HEAD inicial/final:** `d783a5d` / `d783a5d` (sessão ainda sem commit).
- **WIP preservado:** a árvore já estava 24 commits à frente de `origin/dev` e
  continha mudanças externas de provider/chat, CLI, RunPod, migrations e docs;
  nenhuma delas foi revertida. `origin/main` permaneceu intocado.

## Causa e mudança

A rota de chat tratava o mandato como drill-down e executava
`resolveProjectItemReference` sobre somente `id/state/capability/updated_at`.
Com vários `failed`, pedia ID antes de consultar aprovação vigente,
classificação, dependências, claims, alvo ou lineage.

Foi criado `resolveAutonomousWorkSelection`, que reutiliza
`projectAutonomousQueue` e `selectNextAutonomousWork`. A camada web lê o backlog
autônomo existente e `work_recovery_lineage`, resolve predecessores apenas para
fins de reconciliação e responde com `selected`, `none_eligible` ou
`human_decision_required`. A política segue `oldest_approval_first`; lineage não
promove elegibilidade. O caminho só existe em Dev com mandato explícito e é
read-only/provider-neutral. Logs sanitizados registram IDs considerados,
eliminações, motivos, seleção, política e fronteira humana.

## Provas

- Core focal: 7 suítes, 112 testes verdes (eligibility, intelligence, queue,
  selection, backlog, recovery successor e a nova regressão).
- Web focal: 3 suítes, 20 testes verdes (detector/render, rota e leitura do backlog).
- Typecheck `packages/core`: verde.
- Typecheck `apps/web`: bloqueado somente pelo erro externo preexistente em
  `autonomous-backlog-deps.ts:198` (`null` não atribuível a `string`); o arquivo
  não foi tocado, conforme a fronteira explícita da tarefa.
- Banco local: Supabase ativo. A consulta read-only confirmou que
  `ce90eb14-810d-4125-833c-4c7b35666855` possui successors de sequências 1 e 2;
  o mais recente continua por lineage até `8a2515d8-6967-463e-af2a-fd5d2b5e42a1`,
  hoje `approved` v2. A RPC de fila chamada sem sessão recusou corretamente por
  autenticação; nenhuma mutação foi feita.

## Invariantes e efeitos externos

- Nenhum navegador foi aberto; a validação final da UI permanece humana.
- Nenhum claim, attempt, evento, item, approval, execução, provider externo,
  segredo, push, PR, merge, deploy ou integração foi criado.
- Não houve alteração de schema nem migration.
- Chat normal sem mandato autônomo preserva a ambiguidade conservadora.
- Próxima retomada exata: executar a prova manual no chat Dev com GPT usando o
  mandato real e confirmar a resposta contra a fila RLS da conta autenticada.
