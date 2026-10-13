# Single-Item Governed Execution V0

Estado: preparação local implementada; **execução bloqueada**, sem prova viva.

## Mandato e superfície

`anima work execute-one <UUID> --version <N> [--json]` aceita apenas UUID e versão
inteira positiva explícitos. Reutiliza `runProjectBacklogHostTurn`, driver e
Supervisor. Uma invocação tem no máximo um ciclo/uma volta; não lê foco para
escolher item, não cai na fila global, não aprova, não concede supervisão, não
aceita resultado e não integra código. SIGINT/SIGTERM propagam cancelamento.

O read-model consulta o item escolhido e suas dependências `completed` (inertes).
A classificação deve estar preparada previamente para a versão aprovada.
Estado/versão são conferidos na projeção, antes da volta e novamente no
Supervisor. Seleção SQL continua em `select_autonomous_work(UUID, versão)`,
read-only; ocupação do alvo e outras autoridades continuam canônicas.

## Mapa de efeitos e fronteira

| Etapa existente | Global | Single-item V0 |
|---|---|---|
| Arranque, paid lease reconciler, wake/materialização | Resident Host | Não inicia o Resident Host |
| Classificação pós-aprovação | Até três candidatos por volta | Não chama; exige classificação vigente |
| `reconcile_supervised_work` e re-verificação de pendências | Todos os itens do owner | Omitidas; nenhuma recuperação implícita |
| `readmit_budget_blocked_work`, `readmit_budget_interrupted_work` | Todos os itens do owner | Omitidas; bloqueados recusados |
| Seleção | FIFO ou pedido explícito | Só UUID/versão; sem fallback |
| Compute routing, cloud, budget/event writes pré-attempt | Contrato do candidato | Barreira antes de qualquer escrita |
| Claims/attempts/observações/settlement | Supervisor existente | Não iniciados: primitiva SQL insuficiente |

A reconciliação/readmissão foi omitida, **não reimplementada em TypeScript**.
Isso evita reproduzir regras SQL e afirmações falsas de isolamento transacional.
O comportamento global e o fluxo de programação sob claim não foram substituídos.

## Bloqueio SQL comprovado por inspeção

`20260721000004_target_exclusivity.sql` define `acquire_work_claim` com lock
consultivo do alvo, mas pode liberar um claim **vencido de outro item** no mesmo
alvo, escrevendo `work_claim_released` nesse outro item. Filtrar o backlog ou
checar claims antes da RPC não fecha a corrida entre leitura e lock.

`start_commanded_work_attempt`/`private.begin_work_attempt`, definidos em
`20260721000001_work_claims.sql` e `20260721000005_commanded_target_exclusivity.sql`,
não liberam claims alheios. Porém o trigger `private.enforce_autonomous_work_budget`
(`20260905000000_budget_blocked_human_resume.sql`) aplica enforcement atômico
apenas a `execution_started` com `claim_id`. O início comandado não satisfaz essa
fronteira; usá-lo aqui enfraqueceria orçamento e contabilização canônicos.

Por isso o adapter e o Supervisor recusam com
`single_item_atomic_claim_unavailable` **antes de compute/event writes/claim/attempt**.
Não existe flag para desabilitar a recusa. Testes não provam execução operacional.

## Próximo contrato necessário (não implementado)

Uma operação SQL de aquisição estritamente por item/versão, sob o mesmo lock de
alvo, que recuse claims alheios inclusive vencidos, sem liberá-los nem gravar
seus eventos. Deve preservar aprovação/classificação/allowlist, exclusividade,
replay, `claim_id` e orçamento atômico do início existente. Exige migration e
provas SQL de concorrência; **fora da autorização desta sessão**.

Só depois desse contrato conectar o modo single-item à aquisição scoped,
remover a barreira após seus gates e provar uma attempt governada separadamente.
Não basta trocar a RPC ou habilitar o início comandado.

## Procedimento futuro

Hoje `execute-one` recusa; não aprovar INV-11 para tentar contornar a barreira.
Após implementação/revisão do contrato SQL e nova autorização humana:

```powershell
Set-Location G:\anima
npm.cmd run anima -- work show INV-11 --json
npm.cmd run anima -- work evidence INV-11 --json
npm.cmd run anima -- budget status INV-11 --json
# aprovação e classificação são atos explícitos, separados da execução
npm.cmd run anima -- work approve INV-11 --json
npm.cmd run anima -- work prepare-autonomous INV-11 --json
npm.cmd run anima -- work execute-one aa6b3d64-1e0b-414d-984d-5264b9c89968 --version 1 --json
npm.cmd run anima -- work show INV-11 --json
npm.cmd run anima -- work evidence INV-11 --json
npm.cmd run anima -- work investigation INV-11 --json
```

Revalidar v1/snapshot/zero attempts, fila, Host parado, transporte WSL e login
ChatGPT antes de qualquer autorização. Não usar `work supervise` como isolamento:
o comando atual chama readmissão global. Acompanhar em outro terminal por `show`;
parar em review/terminal. Em erro/timeout/saída ambígua, consultar o estado e
resultado, sem retry automático ou segundo `execute-one`.

## Limitações

O isolamento de work items não é confinamento absoluto de filesystem/processos.
Worktree descartável, sandbox do executor e provas host-observed continuam
contratos distintos; WSL read-only não confina leitura à worktree. Leitura de
ocupação/dependências e orçamento pode observar outros itens do mesmo owner por
RLS, mas não concede autoridade de escrita sobre eles. Sem prova de banco nesta
sessão, não se afirma que migrations residentes correspondem ao SQL versionado.


## Incremento V1 — composição SQL e gate de liberação (2026-10-08)

Este adendo atualiza o estado sem substituir o histórico V0 acima. A migration
`20261008000000_single_item_work_claim.sql` foi escrita, NÃO aplicada.
`acquire_single_item_work_claim(UUID, versão, claim, owner, lease)` autentica e
valida allowlist, bloqueia o item do owner, deriva o alvo e obtém o MESMO
`pg_advisory_xact_lock(work_target:owner:target)`. Recusa qualquer claim aberto
alheio no alvo, inclusive vencido, sem bloquear/atualizar sua linha ou eventos;
delega a aquisição canônica antes de terminar a transação. Os locks são
transacionais/reentrantes; a RPC global, seus índices e triggers não foram alterados.
Replay e substituição auditável do claim PRÓPRIO continuam canônicos.

Supervisor prepara seleção da RPC pelo mandato e mantém o início sob claim;
classificação/routing e orçamento no `execution_started` não foram substituídos.
A aquisição e o início continuam transações separadas: recusa do início desfaz
estado/eventos/associação da attempt, mas não a aquisição anterior. O host libera
somente seu claim com `released_without_attempt`; cancelamento após aquisição
faz a mesma liberação e não inicia attempt. Crash/liberação falha não autoriza retry.

V1 admite contrato explícito `ollama` local ou `codex-cli`, sem Router, paid API,
node remoto ou provisionamento on-demand. Preferência `provider_api` recusa mesmo
com Router ligado. Checkpoint declarado (inclusive inválido), histórico de attempt
ou fonte de retomada impede reinício; existência de attempt usa consulta própria,
não apenas janela dos últimos 40 eventos. Manutenção/classificação globais continuam
omitidas e UUID/versão são conferidos pelas mesmas camadas V0 e pela aquisição SQL.

`singleItemSqlBoundaryRefusal()` mantém **incondicionalmente** a recusa
`single_item_atomic_claim_unavailable` em produção antes de eventos/compute/claims.
Não há chave de ambiente ou parâmetro para habilitar. Doubles Jest simulam o gate
aprovado só para exercitar a integração preparada, sem carregar banco ou executor
real. A existência da migration/assinatura TypeScript não concede autoridade.

Primitiva e concorrência ainda NÃO comprovadas em PostgreSQL. Tipos receberam uma
assinatura provisória anotada; regeneração factual depende do schema descartável.
Ver [protocolo e critérios](../../supabase/tests/single_item_concurrency.md).
Uma espera em advisory lock não prova sozinha visibilidade atual da função STABLE
de orçamento; duas sessões devem demonstrar recusa da segunda admissão.

Nenhuma aplicação de migration, banco descartável/residente, aprovação/attempt,
Resident Host ou provider real nesta etapa. Liberação do gate, destino de schema
e prova INV-11 permanecem fronteiras humanas separadas.


## Adendo V1 — fronteiras reforçadas em 08/10/2026

O contrato histórico que aceitava codex-cli foi estreitado: sem comprovação de
assinatura/autenticação neste caminho, recusar
`single_item_codex_authentication_unproved` no core, adapter e Supervisor. A prova
SQL não fornece essa comprovação. Por ora somente ollama explícito local pode
passar esse predicado, e o gate SQL incondicional ainda impede execução.

Supervisor e adapter consultam diretamente execution_started por UUID, fora da
janela dos últimos 40 eventos. Erro, ausência de resposta verificável ou existência
de qualquer attempt recusa `single_item_resumption_unproved` antes de orçamento
ou escritas. As fontes new_execution não autorizam reinício. O fluxo global não
recebe essa restrição nova.

A migration scoped proposta revoga EXECUTE de service_role também, removendo a
concessão default explícita além de PUBLIC/anon. Somente authenticated recebe novo
GRANT. pgTAP passa a conferir privilégios efetivos; herança de roles/RLS exige
banco real e falha nesses checks impede liberação. Não foram alterados defaults,
RPC global, triggers ou quotas.

O teste de lock preparado usa alvo inédito e mede ausência antes da RPC e presença
após seu retorno na mesma transação. O runner mede transactionid de A em same_item,
chave de advisory work_target em same_target/mixed_global e chave
user-budget em budget, além de blocker PID. Comparações incluem ledger de
concessões. São instrumentos preparados, não observações PostgreSQL desta sessão.

Preflight estático valida declarações de metadata; não coleta Docker, não comprova
isolamento operacional e não concede execução. O [protocolo atualizado](../../supabase/tests/single_item_concurrency.md)
exige observação real e autorização específica antes de schema/fixtures/provas.
Deadlock pela diferença de ordem claim→item→alvo no início versus item→alvo na
aquisição, visibilidade STABLE e encerramento real de backends permanecem pendentes.
A [divergência histórica de orçamento](../registros/2026-10-08-divergencia-orcamento-local-externo.md)
fica fora desta correção. Nada libera INV-11, Host, banco residente ou compute pago.

## Atualização 2026-10-13 — gate após a promoção

As migrations scoped foram promovidas ao residente ([registro](../registros/2026-10-13-single-item-promocao-residente.md)).
A recusa `single_item_atomic_claim_unavailable` deixou de ser incondicional e passou a ser um gate
fail-closed (`singleItemSqlBoundaryRefusal(client)`): ele chama `acquire_single_item_work_claim` com
argumentos deliberadamente inválidos e só libera se o banco responder exatamente
`22023 invalid claim request` (RPC presente, assinatura e EXECUTE corretos, usuário autenticado e
na allowlist). Qualquer outra resposta — RPC ausente (PGRST202), permissão negada, sem sessão, fora
da allowlist, sucesso inesperado, erro de rede — mantém a recusa antes de orçamento, claim,
compute e escritas. Não há env, flag ou parâmetro que o desligue. O gate não vê o corpo das funções
nem o ledger: a versão instalada depende da promoção registrada. O gate é pré-condição, não
autorização: a primeira attempt real continua exigindo decisão humana específica.
