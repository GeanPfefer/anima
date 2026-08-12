# 2026-08-12 — Proveniência correta do cancelamento originado pelo executor

- **Tipo:** desenvolvimento e prova (migration + pgTAP).
- **Branch:** `claude/integration-application-layer`.
- **HEAD inicial da sessão:** `3c9ac70`. **HEAD após este recorte:** `e3ef7aa`
  (docs em commit seguinte).
- **Objetivo:** fechar o fio deixado aberto pelo
  [registro do transporte](2026-08-11-investigacao-cancelamento-transporte.md):
  a autoria do terminal `cancelled` do executor, gravada como `user`.

## Continuidade da sessão anterior

Retomada forense do estado real: a correção de transporte `3c9ac70` já estava
commitada; a documentação pendente (PRD + Plano 002 + registro do transporte) foi
ratificada e commitada em `1a17f83` com gates verdes (rota supervisor-turn 6/6,
typecheck 5). `.env.local` e `.claude/settings.local.json` são gitignored e
ficaram fora dos commits; `.worktrees/` preservado; `origin/main` `973ef46`
intacta.

## Causa raiz (comprovada no código)

`record_commanded_work_terminal` e `finish_work_execution` gravavam o terminal
`cancelled` com `author=user`. Rastreada a origem, a imprecisão é estrutural e
não do transporte:

1. ambas as RPCs só registram terminais de `origin=executor` — a primeira valida
   `origin='executor'`; a segunda projeta o desfecho do `BoundedWorkExecutor`;
2. o `cancelled` do executor nasce **exclusivamente** de `signal.aborted` nos
   adaptadores (`worktree-executor.ts`, `local-runner.ts`, core `executor.ts`);
   não existe outra causa;
3. o cancelamento humano explícito tem caminho próprio e auditável
   (`request_work_control` → `apply_work_control_at_checkpoint`), que grava
   `work_cancelled` com `author=user` e `reason=cancelled_by_user`.

Portanto atribuir `user` ao cancelamento do executor confundia duas
proveniências distintas num log append-only. `reason=execution_cancelled` já
estava correta; o defeito era apenas a autoria.

## Alcance após 3c9ac70

O terminal está **dormante** no caminho vivo: a rota passa um
`AbortController().signal` que nunca aborta, então o executor não emite
`cancelled`; e `finish_work_execution` não tem chamador em código de aplicação
(fronteira F8 preservada, não fiada). A projeção (`presentation.ts`) já distingue
os dois cancelamentos pelo `control_request_event_seq`, não pela autoria. Ainda
assim a autoria é um fato permanente e auditável e a fronteira do Marco 003 exige
separá-los — corrige-se o contrato, não só o caminho.

## Mudança

Migration incremental `supabase/migrations/20260812000000_executor_cancelled_provenance.sql`:
`CREATE OR REPLACE` de ambas as funções trocando **apenas** a autoria do
cancelado para `executor`. `record_commanded_work_terminal` reproduz a definição
vigente (`20260726000003`, terminal após checkpoints) com a lógica de sequência
preservada; `finish_work_execution` reproduz a definição única
(`20260715000004`). Sem alteração de assinatura, estado alcançado ou tipos
gerados; GRANTs/COMMENTs preservados pelo `CREATE OR REPLACE`.

- **Commit:** `e3ef7aa` — Atribua ao executor a autoria do cancelamento do executor.

## Bug encontrado e corrigido durante o próprio recorte

A primeira versão da migration reproduziu a definição **original**
(`20260720000000`) de `record_commanded_work_terminal`, revertendo sem querer a
lógica de sequência-após-checkpoint introduzida em `20260726000003`. A suíte
pgTAP acusou fail-closed (`terminal signal correlation mismatch` para
`sequence>1`) em 4 arquivos de retomada/reconciliação. Corrigido rebaseando o
corpo na definição vigente; lição: `CREATE OR REPLACE` deve partir da **última**
definição da função, não da migration que a criou.

## Provas e gates (números exatos)

- **pgTAP:** `supabase test db` — **29 arquivos / 730 testes PASS**. Novo
  `executor_cancelled_provenance.test.sql` (5/5: item→`cancelled`,
  `author=executor`, `reason=execution_cancelled`, `origin=executor`,
  idempotência) e `work_execution.test.sql` estendido para **24** com a asserção
  de autoria do cancelamento. Regressão de checkpoint/retomada/reconciliação
  intacta (prova de que a lógica de sequência foi preservada).
- **typecheck:** 5 workspaces PASS.
- **core (Jest):** 31 suites / 687 testes PASS (mudança é SQL-only; suítes com
  fakes não tocam a RPC real — confirmação de não-regressão).

## Invariantes de segurança preservadas

- Proveniência correta: cancelamento humano (`user`/`cancelled_by_user`) separado
  do cancelamento do executor (`executor`/`execution_cancelled`).
- Migration incremental, não reescreve migration ratificada; idempotência das
  RPCs preservada; sem novo tipo/coluna/enum, sem regeneração de tipos.
- `origin/main` `973ef46` intacta.

## Efeitos externos — explicitamente não realizados

Nenhum push, PR, merge, alteração de `main`, `supabase db reset`, deploy,
publicação de branch, aceite de resultado ou `integrated`. Apenas commits locais
e migration aplicada ao banco local (`migration up` + `CREATE OR REPLACE`
idempotente para sincronizar a definição corrigida).

## Ambiente local

Docker Desktop e Supabase local foram iniciados para rodar o pgTAP (estavam
desligados no início da sessão). Ficam **ligados** ao final desta anotação, salvo
encerramento no fecho da sessão.

## Próximo ponto exato de retomada

O fio de proveniência de cancelamento está fechado. Itens de fronteira **humana**
pendentes no backlog: ratificação de UX-00 e UX-03 (checkpoints humanos, não
executáveis por agente). Investigação em aberto e explicitamente não iniciada
aqui: `ollama_read_round_limit` (separar protocolo, três rodadas, prompt e
capacidade do modelo antes de tocar qualquer contrato) — ver registro do
transporte.
