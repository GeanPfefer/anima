# 2026-10-13 — Integração do gate Single-Item com a RPC scoped promovida

Tipo: desenvolvimento e prova. Continua o [registro da promoção](2026-10-13-single-item-promocao-residente.md)
(commit db75ce0). Branch dev. Sem push, sem Host, sem attempt, sem API paga, sem migration nova e sem
escrita no residente.

## Diagnóstico

`single_item_atomic_claim_unavailable` era uma função (`singleItemSqlBoundaryRefusal`) que devolvia a recusa
**constante**, chamada em dois pontos: `runSupervisorTurn` (antes do orçamento e do claim) e
`buildProjectBacklogCycleDeps.runTurn` (antes de compute, escritas e Supervisor). `workClaimRpc` já escolhia
`acquire_single_item_work_claim`. Nos dois pontos a sonda usa o **mesmo `client` autenticado** que depois
adquire o claim e inicia a attempt, portanto representa a identidade real do fluxo. Essa identidade
(`ANIMA_RESIDENT_EMAIL`, via GoTrue; nunca `service_role`) é o dono do item `b5f8178a` e está na allowlist
(verificado sem imprimir credenciais).

## Mudança

`single-item-sql-boundary.ts`: o gate passou a ser assíncrono e fail-closed. Faz uma **sonda sem efeitos**
chamando a RPC scoped com argumentos deliberadamente inválidos (item nil inexistente, owner em branco,
`lease_seconds=0`) e só libera com a resposta exata `22023 invalid claim request`. Qualquer outra resposta,
erro, rejeição ou exceção devolve o mesmo código `single_item_atomic_claim_unavailable`. Não há env, flag ou
parâmetro de bypass. Na RPC instalada a validação de entrada ocorre depois de `auth.uid()` e da allowlist e
antes de qualquer leitura de item, lock ou escrita; mesmo um corpo incompatível não escreveria nada, pois o
item nil não existe. O gate não substitui a autoridade do banco (posse, elegibilidade, orçamento, concorrência).

## Prova pelo caminho real PostgREST (descartável restaurado do residente promovido)

PostgREST v14.12 real contra o banco descartável, com segredo JWT próprio e aleatório do ambiente de teste
(nenhuma credencial administrativa ou do residente; JWTs `authenticated` e `anon` assinados com esse segredo),
cliente `PostgrestClient` (o mesmo `rpc` encapsulado pelo `supabase-js`) e o módulo do gate compilado:

| Identidade | Resposta crua da sonda | Gate |
|---|---|---|
| allowlistada (dono do item) | HTTP 400, `22023`, `invalid claim request` | **libera** |
| autenticada sem autoridade | HTTP 403, `42501`, `work orchestration is not enabled` | recusa |
| `anon` | HTTP 401, `42501`, `permission denied for function` | recusa |
| sem token | HTTP 401, `42501`, `permission denied for function` | recusa |

Contagens de claims, eventos, itens e attempts e hashes de itens e claims idênticos antes e depois da sonda
(165 / 2848 / 187 / 165). Isso fecha o risco aberto no registro anterior sobre o mapeamento de `code` e
`message` do PostgREST. Regressão de aquisição e orçamento pelo mesmo caminho: `autonomous_work_budget_status`
responde 200 para o dono e `null` para quem não é; claim scoped real recusado a `anon` (401) e a quem não tem
autoridade (403); aceito ao dono (200); replay idêntico (200); outro `claim_id` no mesmo item recusa `55000`;
release próprio `released_without_attempt` (200); com posse alheia aberta no mesmo alvo o scoped recusa
`55000 single_item_foreign_claim_open`; nenhuma attempt iniciada. O início da attempt com roteamento continua
coberto pelo pgTAP 55/55 do registro anterior. Evidências no diretório de recuperação
(`gate-integration-*`).

## Escopo do commit e o que ficou de fora (bloqueio real)

No HEAD (db75ce0) `supervisor.ts` e `autonomous-backlog-deps.ts` têm **zero** código Single-Item: o V1 inteiro
(`singleItem`, contrato em `packages/core`, adapters, CLI) é WIP não versionado em dezenas de arquivos.
Por isso os hunks dos consumidores não existem isolados em relação ao HEAD e não podem ser commitados sem
incorporar esse WIP, o que não foi autorizado. Foi commitado somente o conjunto que **compila e passa sozinho
sobre o HEAD limpo** (verificado em snapshot do HEAD com apenas estes arquivos: jest 16/16 e `tsc` 0 erros):

- `apps/web/lib/work-orchestration/single-item-sql-boundary.ts` e `.test.ts` (módulo do gate e seus testes);
- `packages/types/src/database.ts` (somente a entrada tipada de `acquire_single_item_work_claim`, 29 linhas,
  idêntica em forma à entrada gerada da RPC irmã; comentário atualizado);
- este registro.

Ficam como WIP não commitado (preservados): a ligação do gate em `supervisor.ts` e
`autonomous-backlog-deps.ts` (`await singleItemSqlBoundaryRefusal(client)`), seus testes
(`supervisor.test.ts`: 2 testes novos com o gate real e RPC ausente; `autonomous-backlog-deps-preflight.test.ts`),
o README do CLI e a atualização de `docs/arquitetura/single-item-governed-execution-v0.md`. O delta próprio dos
consumidores foi preservado como patch (12 hunks) contra a base WIP em
`gate-integration-*\gate-consumers.patch`; aplica e reproduz exatamente o estado atual. Menor correção
necessária: decidir o commit do conjunto Single-Item V1 (ou autorizar a incorporação do fecho de dependências)
para então versionar a ligação.

## Testes

Focais (gate, supervisor, preflight do backlog, `execute-one`): 112/112 PASS. `lib/work-orchestration` + `cli`:
2251 PASS e 3 timeouts de hook (git real sob carga) em `host-evidence`, `worktree-executor` e
`investigation-executor.worktree`, que passam isoladas (123/123). `tsc`: os 85 erros históricos de
`scripts/_session` e nenhum outro.

## Matriz de parada segura (sem retomada automática; nenhum recovery novo implementado)

Fatos conferidos no código: o CLI liga SIGINT/SIGTERM a um `AbortController`; lease do claim =
`max_duration_minutes*60+300` (item `b5f8178a`: 35 min); o modo Single-Item **não** executa reconciliação,
re-admissão nem `next_autonomous_work`; qualquer `execution_started` no histórico recusa nova execução
(`single_item_resumption_unproved`); claim aberta (mesmo vencida) do item bloqueia outro Single-Item no mesmo
alvo (`single_item_foreign_claim_open`).

| Situação | Como observar | Parada e estado preservado | Prova |
|---|---|---|---|
| Interrompida antes do claim (sinal ou deadline) | CLI: `single_item_cancelled`; sem claim/evento novo | nada a preservar | teste simulado |
| Falha antes do claim (gate, contrato Codex/WSL, histórico, elegibilidade, orçamento) | `selection_not_executable` com o código; exceção: orçamento não admitido grava `block_work_on_budget` (item `blocked`) | sem claim nem attempt; orçamento é o único efeito legítimo | testes simulados |
| Falha ou sinal após o claim, antes da attempt (`start_claimed_work_attempt` recusa, cancelamento) | `claimReleased` no JSON; `work_claims` | libera `released_without_attempt`; se a liberação falhar a claim fica aberta até o lease (35 min) e outro `claim_id` é recusado (`55000`) | teste simulado e PostgREST (recusa) |
| Falha após iniciar a attempt (erro do executor) | terminal `error` + `claimReleased` | terminal gravado, claim liberada `attempt_finished`, item não reexecutável | testes simulados |
| Executor lança exceção, checkpoint não persiste ou terminal recusado pelo banco | `execution_interrupted` (`executor_threw`, `checkpoint_persist_failed`) ou `terminal_refused` | **attempt aberta e claim retida, sem terminal inventado**; nada automático; inspeção humana | código + testes simulados |
| Verifier ou evidência falha após terminal | `single_item_verification_*`/`single_item_evidence_failed` | resultado não aprovado, claim liberada, sem integração | testes simulados |
| Cancelamento durante o Codex (SIGINT/SIGTERM) | terminal `cancelled` | teardown da árvore Windows por `taskkill`; **descendentes Linux não provados** | só simulado (limite já registrado em 10/10) |
| Processo morto, queda de energia, Docker ou Supabase caem | ledger: `execution_started` sem terminal, claim aberta, item `in_progress` | **sem recovery**: Single-Item não reconcilia; o alvo `anima` fica bloqueado para outros Single-Item; humano decide | inferido do código; não exercitado |
| Perda do transporte Codex/WSL antes do claim | `single_item_codex_wsl_required` ou `single_item_codex_authentication_unproved` | sem efeitos | testes simulados |
| Perda do transporte Codex/WSL durante a attempt | `NativeCliFailure` (`usage_limit_exceeded`, `unauthorized`, `unknown`), saída ≠ 0 ou timeout viram erro/cancelado | como "erro do executor"; conferir `pgrep codex` na distro e a worktree | simulado; transporte real só em leitura |

Impedimentos reais (sem investigação nova): não existe recovery para falha de runtime do Single-Item
(precedente `ab9cae0f`: `failure_not_classified`); o teardown cross-OS de descendentes Linux não está
provado; uma morte brusca deixa claim e attempt abertas e exige decisão humana. Parada segura definida:
nunca reexecutar, não limpar claim, não aplicar recovery; observar o ledger e decidir.

## Limites remanescentes

O gate vê a superfície do contrato, não o corpo das funções nem o ledger. A entrada de tipos ainda aguarda a
regeneração oficial. Pendências inalteradas: 23 órfãos de FK, 18 divergências históricas, 4 FAIL históricos de
orçamento, Vector em loop de restart, WIPs e 46 worktrees preservados.
