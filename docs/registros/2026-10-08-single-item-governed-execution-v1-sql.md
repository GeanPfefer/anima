# Sessão — Single-Item Governed Execution V1 / fronteira SQL

- Data/tipo: 2026-10-08, implementação supervisionada e testes determinísticos.
- Objetivo: preparar aquisição por UUID/versão sem mutação em claims alheios,
  mantendo início sob claim, classificação e orçamento canônicos.
- Branch: `dev`; HEAD inicial/final `6bc4aadef9414d655600c2ea37c6be436b3628c8`.
- Commits: nenhum; índice vazio. Sem staging, push, reset, clean ou prune.
- Base: [checkpoint](2026-10-08-checkpoint-continuidade.md),
  [Plano 043](../planos/043-single-item-governed-execution-v0.md) e
  [contrato](../arquitetura/single-item-governed-execution-v0.md), atualizados por
  adendos. Registro V0 e checkpoint não foram editados.

## Mudanças e decisões

Migration aditiva `supabase/migrations/20261008000000_single_item_work_claim.sql`:
RPC `acquire_single_item_work_claim` obtém locks de item/alvo, recusa claim aberto
alheio inclusive vencido e delega à aquisição existente na mesma transação.
Nenhuma migration histórica, RPC global, índice ou trigger de orçamento alterado.

Integração preparada em Supervisor/adapter, mantendo `start_claimed_work_attempt`;
sem outro harness. Recusas para backend default/pago, preferência paga (Router ON
ou OFF), node remoto/on-demand, checkpoint declarado/histórico de attempts/fontes
de retomada. Cancelamento prévio impede composição; depois de claim e antes de
attempt libera só o próprio claim. Leitura dedicada de `execution_started` evita
que a janela de 40 eventos esconda uma attempt anterior.

**Gate de produção preservado:** `singleItemSqlBoundaryRefusal()` retorna sempre
`single_item_atomic_claim_unavailable` antes de efeitos. Não há env/param de bypass.
Somente Jest simula gate aprovado para testar integração com doubles. Isto NÃO
é prova SQL nem caminho operacional liberado.

`packages/types/src/database.ts` recebeu assinatura provisória explicitamente
anotada, derivada da migration; NÃO foi regenerado por Supabase contra banco.
Regeneração factual é gate pendente, não critério concluído.

## Arquivos desta sessão

```text
supabase/migrations/20261008000000_single_item_work_claim.sql
supabase/tests/single_item_work_claim.test.sql
supabase/tests/single_item_concurrency.py
supabase/tests/single_item_concurrency_test.py
supabase/tests/single_item_concurrency.md
packages/types/src/database.ts
packages/core/src/work-orchestration/single-item-execution.ts
packages/core/src/work-orchestration/single-item-execution.test.ts
apps/web/lib/work-orchestration/single-item-sql-boundary.ts
apps/web/lib/work-orchestration/single-item-sql-boundary.test.ts
apps/web/lib/work-orchestration/supervisor.ts
apps/web/lib/work-orchestration/supervisor.test.ts
apps/web/lib/work-orchestration/autonomous-backlog-deps.ts
apps/web/lib/work-orchestration/autonomous-backlog-deps-preflight.test.ts
apps/web/lib/work-orchestration/backlog-host-turn-run.ts
apps/web/lib/work-orchestration/backlog-host-turn-run.test.ts
apps/web/cli/execute-one.test.ts
apps/web/cli/README.md
docs/arquitetura/single-item-governed-execution-v0.md
docs/planos/043-single-item-governed-execution-v0.md
anima-prd.md
docs/registros/2026-10-08-single-item-governed-execution-v1-sql.md
```

O WIP V0 continua sem commit. Não incorporar WIPs anteriores por add abrangente.
PRD recebeu apenas novo adendo final; hunk inicial +16 e diff +22 do Plano 008
foram preservados. Demais untracked/scratch e 46 worktrees não foram alterados.

## Gates executados versus provas pendentes

- Web: **339 testes PASS em 14 suítes**, Node Windows **24.16.0**; Supervisor,
  Host Turn, CLI, adapter, fila/driver e regressões globais Router/on-demand e
  seleção de programação/investigação. Após consulta dedicada de attempts:
  **84 PASS em duas suítes focais**, mesmos testes já contados, não somar.
- Core: **16 PASS** na suíte nova de mandato/contrato.
- Python: **7 PASS** nas recusas de isolamento do runner, sem Docker/SQL real.
- Typechecks core/types/Supabase PASS; web com config auxiliar em `/tmp`, sem
  `scripts/_session`, PASS. Scratch não corrigido/removido; baseline de erros do
  web completo permanece descrito no checkpoint, não foi recontado nesta sessão.
- Git Windows `diff --check` PASS; índice vazio e HEAD preservado. Nenhum diff
  em migrations históricas; migration nova permanece untracked.
- Validação estática de sintaxe Python e contagem do plano TAP (29) PASS.
  Isso NÃO valida SQL no PostgreSQL.
- Build não executado: fatia backend/CLI, sem UI; validação local por Jest/tsc.

Falhas intermediárias: cast incompatível entre `unknown` e `Json`, corrigido;
import acima do docblock Jest impedia ambiente Node, corrigido. WSL Node 18
falhou em `crypto.randomUUID` preexistente no wiring global; gates finais rodados
com Node Windows exigido pelo projeto, sem mudar a produção para contornar isso.
Config auxiliar inicial fora da árvore perdeu resolução de `@types`; corrigida
em `/tmp` com typeRoots explícito. Nenhum flake novo observado no gate final.

**SQL efetivo: zero testes executados, zero migrations aplicadas.** PgTAP de
preservação integral de claims/eventos ativos/vencidos, owner/RLS, replay e budget
foi preparado. Runner concorrente mantém A aberta após retorno da RPC, exige B
bloqueada pelo PID de A, commita A, exige recusa B e compara itens/claims/eventos
fora de itemA. Não foi invocado contra banco. Protocolo inclui disputas adicionais,
concessão humana, classificação e visibilidade STABLE após espera.

## Limites, segurança e retomada exata

Nenhum banco descartável criado ou isolamento de instância real comprovado.
WSL não tem `psql`; disponibilidade de bootstrap Supabase independente não foi
testada. Não usar residente para suprir essa lacuna. Runner preparado exige ID
de container novo, label, nome de banco específico, rede none e ausência de
mounts persistentes. Testes dessas recusas não comprovam existência do ambiente.

Sem consulta residente, approval/attempt INV-11, alteração INV-09/10, Resident
Host, chamadas de modelo, API paga, RunPod, provisioning, migração aplicada,
credenciais, efeitos externos ou integração. Estado dos itens é o último estado
conhecido do checkpoint, não uma nova observação.

BLOCKED_BY_HUMAN_DECISION: revisar patch; preparar plano concreto de banco
independente e comprovar metadata/topologia, então obter autorização específica
antes de bootstrap/aplicação/testes SQL. Seguir
[protocolo](../../supabase/tests/single_item_concurrency.md); regenerar types só
do schema validado. Se budget/locks falharem, manter recusa e diagnosticar sem
afrouxar política. Só após gates e revisão considerar liberação em código.
Aplicação residente/execução INV-11/commit continuam fora desta autorização.
