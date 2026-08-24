# Plano 002 — Modo Autônomo V0

## Continuação — execução canônica autônoma no nó remoto (2026-08-24)

`CANONICAL_AUTO_EXECUTION_REMOTE_NODE = PASS`. Uma identidade-fixture allowlisted, sem
`service_role` no runtime, partiu de fila vazia e percorreu a cadeia real: `FIX-01` → planner
OpenAI restrito à planning boundary → materialização → `work_approved author=system` →
classificação/roteamento/claim → `execution_started` → coder
`ollama:remote/runpod-a40:qwen3-coder:latest` → worktree e gate locais → evidências
host-observed → Verifier `verified` (7 checks, 0 gaps, 0 violações) → `review`.

O transporte V0 é um túnel SSH loopback `127.0.0.1:21434` → A40
`127.0.0.1:11434`; não há fallback silencioso nem endpoint público. O recorte dedicado
`ANIMA_WORKTREE_OLLAMA_*` preserva o default local e exige localidade/identidade explícitas,
URL loopback sem credenciais e falha fechada. A execução levou ~41 s (`coder=10,272 ms`,
gate typecheck=21,462 ms); branch/worktree de execução foi descartada e a árvore principal
não recebeu o arquivo-fixture. Detalhes e métricas no registro
`docs/registros/2026-08-24-execucao-canonica-no-remoto.md`.

Próxima fronteira: decisão humana sobre manter/parar o Pod. Não implementar ainda Node
Registry, Capacity Router, auto-provision/auto-stop, integração, PR, merge ou deploy.

## Continuação — diferencial OpenAI autorizado, bloqueado antes do planner (2026-08-23)

Gean autorizou explicitamente uma única prova diferencial estreita com egress minimizado
apenas no planner OpenAI (`gpt-5.6-terra`); coder/worktree/gates/Verifier permanecem locais.
A primeira inicialização encontrou o daemon Docker indisponível e parou em identidade; após
restaurar Supabase e confirmar autenticação, a instância efetiva fez 60 reavaliações bounded,
todas `resource_pressure`, zero itens. Medição: ~2,21/15,87 GiB livres (13,9%),
`moderate/defer`; Studio/pg_meta/Vector/Analytics foram parados reversivelmente por não serem
necessários, sem recuperar a reserva de 25%. Resultado: **nenhuma chamada OpenAI, zero
tokens/custo; diferencial ainda não executado**. Retomar quando Governor=`permit`, sem
reduzir a reserva nem encerrar processos do usuário.

## Continuação — diferencial qwen3-coder pós-reboot (2026-08-23)

`qwen3-coder:latest` foi comparado com a mesma fixture/planning boundary/validators, sem
OpenAI. Uma execução diagnóstica produziu proposta integralmente válida em 2 rodadas
(5 tools read-only + submit; parser e ancoragem passaram), mas três execuções pelo resident
host falharam antes de criar item (`structured proposal`/exaustão de 16 rodadas). A captura
revelou tools de investigação emitidas fora do catálogo quando a rodada oferecia somente
submit; o host as executava. Correção fail-closed + regressão em `fe5180a` (13/13, typecheck
web), mas a repetição viva ainda esgotou 16 rodadas. Portanto
`CANONICAL_AUTO_EXECUTION_LOCAL = NOT_PROVEN`; OpenAI não foi chamado. Próxima fronteira:
prova diferencial OpenAI somente após nova autorização explícita.

## Continuação — autorização autônoma canônica V1 (2026-08-23, prova viva bloqueada no planner local)

Implementação no working tree: evaluator determinístico/fail-closed no core; RPC
`auto_approve_autonomous_work` append-only e idempotente, com `work_approved`
`author=system`/`authority=autonomous_policy`; tipos Supabase regenerados; adapter web que
decide sobre o item persistido e só chama a RPC após `Resource Governor=permit`; resident
host encadeia materialização → autorização e deixa a execução para o Supervisor existente.
Verde: core 23/23, adapter+resident 41/41, pgTAP 17/17, typecheck dos 5 workspaces; suíte
geral 1.936 testes verdes e um timeout de infraestrutura isolado que passou sozinho.

`CANONICAL_AUTO_EXECUTION` permanece **NÃO PROVADO**. A prova chegou a materializar e
auto-aprovar honestamente um item (`author=system`), revelando que faltava a classificação de
inteligência exigida pela fila; o adapter agora a deriva do envelope antes da aprovação.
Após limpar somente a fixture, duas tentativas com planner local falharam antes de criar item
(`não chegou a proposta terminal` / `não produziu proposta estruturada`). O Governor foi
respeitado e recuperou para `permit` após descarregar modelos. Planner externo não foi usado:
egress exige autorização explícita. Retomada exata: tornar o planner local terminal ou obter
autorização humana explícita para o provider configurado; repetir uma única instância bounded.
Registro:
`docs/registros/2026-08-23-auto-approval-canonico-bloqueado-por-recurso.md`.

## Continuação — Resident host materializa o backlog canônico (2026-08-23)

O resident host, no seu PRÓPRIO laço, quando a fila OPERACIONAL esvazia
(`no_eligible_work`), descobre o backlog canônico e materializa UM candidato em `proposed`
SOZINHO — e para na fronteira de aprovação humana. Engine: porto opcional
`materializeWhenIdle` (só na fila vazia, sob a identidade/kill-switch já vigentes, desfecho
`proposed`, nunca lança). Entry: fiado por `ANIMA_RESIDENT_MATERIALIZE_DOCUMENT`. Loader
`ts-resolve.mjs` passou a resolver o alias `@/`. resident-host 82/82 + typecheck 5 workspaces.
**META-PROVA (in_process, planner LOCAL, sem chamada manual): usuário fresco → fila vazia →
`materialization={materialized:true, FIX-01}` → work_item `f71f157f` `proposed` (provenance
estável, cadeia work_proposed+context_attached, SEM execução, sem duplicata) → 2ª iteração
`waiting_human_or_recovery` (o proposed é fronteira humana) → para.** Auto-approval NÃO existe
(investigado) e é fronteira de autonomia progressiva (ratificação) — NÃO burlada. Registro
`docs/registros/2026-08-23-resident-host-materializa-quando-idle.md`.

## Continuação — Materializer canônico V1 (Level 6) (2026-08-23)

`CANONICAL_MATERIALIZATION = PASS`. Um candidato canônico já escolhido pelo domínio vira UM
work_item `proposed` executável, SEM humano no materializer. `17d55f4`+`a28dbab`: contrato
puro de proveniência (`intent.canonical_provenance`, correlação por sourceId ESTÁVEL) +
driver `materializeNextCanonicalCandidate` (seleção determinística gate o planner; fail-closed;
idempotente; desfecho `proposed`) + PLANNING BOUNDARY = `planExecutableProjectWork` (reuso, o
host valida escopo/paths/execution_spec) + rota `POST /api/work-orchestration/canonical-materialize`
+ campo `**Status:**` machine-explicit no parser. Reusa `create_work_proposal` com mensagem de
origem legítima (sob a identidade do usuário) — SEM schema change, SEM tocar a guarda de
proveniência ratificada. 8/8+27/27+16/16 + typecheck 5 workspaces. **PROVA VIVA por fixture
controlada (planner LOCAL qwen2.5:14b): FIX-01 → work_item `proposed` com provenance estável,
exatamente 1, cadeia `work_proposed,context_attached` (SEM execução); replay idempotente
(`no_candidate:all_settled`); backlog REAL → `none/status_unresolved` (honesto). Repo intacto,
sem service_role.** Registro `docs/registros/2026-08-23-materializer-canonico-v1.md`.
**Próximo:** reconciliar os 13 `unknown` reais; projeção operacional; resident host consome
o item + auto-approval; avaliação de conclusão de objetivo por slice.

## Continuação — Backlog canônico: descoberta + elegibilidade (2026-08-23)

`CANONICAL_BACKLOG_DISCOVERY = PASS`, `NEXT_CANONICAL_CANDIDATE = PASS`. Primeiro passo da
ponte docs → work_item, PURO e DETERMINÍSTICO (sem LLM, sem criar nada). `8925b2f`+`213ccfb`
em `packages/core/canonical-backlog.ts`: `parseCanonicalBacklog` projeta cada `### <ID> —
<Título>` em candidato tipado (id estável, título, status, dependências, localização);
`classifyCanonicalBacklogStatus` (marcador MAIS CEDO, negação-aware — corrige o achado ao
vivo de AUTO-05 falso-not_started por citar "Fase F não iniciada"); `planCanonicalBacklog\
Materialization` escolhe o próximo `ready` conservadoramente (done/awaiting não reaparecem,
já-ligado não duplica, `unknown` não materializa, dep não satisfeita → blocked sem congelar).
23/23 + typecheck 5 workspaces. **DESCOBERTA + ELEGIBILIDADE VIVAS no doc real: 28 candidatos,
15 done/13 unknown; decisão `none/status_unresolved` — NÃO re-materializa trabalho concluído
(seguro/honesto).** Registro `docs/registros/2026-08-23-backlog-canonico-descoberta-e-elegibilidade.md`.
**FRONTEIRA — Level 6 (materialização):** exige decisão de produto (granularidade fase→tarefa;
derivação de proposal/execution_spec) e nada é materializável agora (tudo done/unknown). Parada
deliberada.

## Continuação — Resident Local Host: AUTO_EVENT_WAKE (2026-08-23)

`AUTO_EVENT_WAKE = PASS`. Eliminado o polling como wake PRIMÁRIO. `0b24573`: migration
`20260823000000` adiciona `work_events` à publicação `supabase_realtime` (aditivo; RLS por
assinante é a autoridade, **sem service_role**); `WakeCoordinator` (coalesce sinais, fallback
de poll como safety net — 9/9); `subscribeWorkEventsWake` (assina INSERT via Realtime
autenticado com o Bearer do usuário — 4/4); engine `WakeReason+='event'`; entry com
coordenador + assinatura + `wakeSource` na telemetria. **Fonte do wake ≠ fonte da decisão**:
o evento só diz "acorde"; a engine reconcilia e a política decide (perdido/duplicado é
seguro). resident-host **76/76** + typecheck 5 workspaces. **PROVA VIVA (Next DOWN, poll=600s):
runner idle → item `d4f8b6ac` criado por PROCESSO SEPARADO → `wakeSource=event` em 31s (poll
não podia disparar) → reconcile → in-process → gate PASS → **Verifier `verified`** 7/0/0 →
`review` → idle → assinatura disposta.** Registro
`docs/registros/2026-08-23-resident-host-auto-event-wake.md`. **Próximo: telemetria durável
mínima; depois, backlog canônico/documental.**

## Continuação — Resident Local Host: transporte IN-PROCESS (2026-08-23)

`RESIDENT_IN_PROCESS = PASS`, `NEXT_SERVER_REQUIRED = NO`. O resident host deixou de
depender do Next server: agora compõe a aplicação DIRETAMENTE. `3a0018a`: composition root
compartilhada `runProjectBacklogHostTurn` (extraída da rota, que passa a delegar — 6/6
idêntico); `createBearerClient` isolado de `next/headers` em `bearer.ts`; adapter
`createInProcessHostTurnPort` (cliente user-scoped do token, **sem service_role**, fail-closed);
loader `ts-resolve.mjs` (zero-dep, `registerHooks`) + `--experimental-transform-types` para
rodar o grafo `@anima` por `node` puro sem bundler; transporte por `ANIMA_RESIDENT_TRANSPORT`
(default `in_process`). Provas: in-process 6/6 + 95/95 + typecheck 5 workspaces. **PROVA VIVA
com Next DERRUBADO** (porta 3000=000): item `ff2a8f99` → `review`, **Verifier `verified`**
(7/0/0), gate PASS, worktree descartada, repo intacto, `origin/main` intacta. Detalhe no
registro `docs/registros/2026-08-23-resident-host-transporte-in-process.md`. **Próximo:
AUTO_EVENT_WAKE** (eliminar o polling como wake primário).

## Continuação — Resident Local Host V0: ADR + engine + superfície (2026-08-22)

A última camada de scheduler humano — o **disparo** da invocação do host-turn — ganhou
sua arquitetura e sua engine. [ADR-003](../arquitetura/adr-003-resident-local-host.md)
fixa, sobre o código real, o **processo Node residente** iniciado por Gean (`anima
local-host start`): identidade user-scoped via Bearer/`auth.uid()`/RLS (**sem
`service_role`**, com auth/session provider port fail-closed), kill-switch de
control-plane local fail-closed, wake por poll-lento-provisório + explícito (elegibilidade
do domínio), backoff puro, crash recovery pelos contratos existentes (banco = autoridade),
concorrência protegida pelo claim server-side, Governor como única autoridade em dois
sítios fail-closed, transporte V0 = HTTP à rota provada. `tools/local-agent` (Python)
permanece EXECUTOR, não orquestrador — sem runtime paralelo.

Implementado (`ed7fd6f`/`b646ee4`/`5dc905b`): `runResidentHost` (engine agnóstica de
transporte, portos injetados) + classificadores puros + portos reais (GoTrue/kill-switch/
HTTP host-turn) + superfície `npm run local-host` (Node 24, TS nativo, sem bundler).
Provas: resident-host **57/57** (as 15 regressões + núcleos puros), typecheck 5 workspaces,
`git diff --check` limpo. **Duas provas vivas de GOVERNANÇA com o processo real**:
(1) kill-switch off → `disabled`/quiesce sem tocar identidade/rede; (2) enabled + GoTrue
real com Supabase fora → `waiting_human_or_recovery`, `hostTurns=0`, backoff (não tight
retry), parada determinística. Detalhe em
[`docs/registros/2026-08-22-resident-local-host-v0.md`](../registros/2026-08-22-resident-local-host-v0.md).

**PROVA VIVA DO HAPPY PATH: PASS (`RESIDENT_HOST_V0=PASS`, `AUTO_EVENT_WAKE=PENDING`).**
Stack levantado (Docker + Supabase + Ollama `qwen3-coder` + Next dev); item descartável
`fdba6c78` (worktree/project:anima) criado→aprovado→classificado e pronto na fila. O
processo `node apps/web/scripts/resident-host.ts` (autonomy=enabled) assinou no GoTrue como
o usuário (Bearer, **sem service_role**), reconciliou, o Governor permitiu, invocou o
host-turn bounded → `qwen3-coder` na worktree isolada → gate `typecheck` PASS → evidência
host-observed (git `insertions:1`) → **Verifier `verified`** (7/0/0) → item em **`review`**
→ runner voltou a **idle**. **Sem nenhuma chamada manual à rota.** Bonus: a 2ª iteração, sob
carga real, foi a `waiting_resource` — o **Governor gate deferindo admissão AO VIVO**. Repo
byte-intacto, worktree descartada, `origin/main` intacta. Detalhe no registro. **FRONTEIRA
restante:** o **wake automático event-driven** (hoje poll lento provisório) e o **transporte
in-process** (sem tocar a engine).

## Continuação — Resource Governor como gate real de admissão (2026-08-22)

O porto `hostPermitsAutonomousWork` deixou de ser constante: antes de **cada nova
volta**, `readResourceAdmission` captura um snapshot pontual do host e a política
pura `decideResourceAdmission` decide `permit | defer | fail_closed`. Somente pressão
`low` permite; `moderate/high` produz parada tipada `resource_pressure`; telemetria
`unknown` ou erro falha fechada. O gate não mata tentativa iniciada e não substitui
budget V2, claim/exclusão, anti-loop ou cancelamento. Sem polling/retry: uma invocação
para em `resource_pressure`; outra, após recuperação, reamostra e pode prosseguir.

## Continuação — gatilho de continuidade (host-turn) + prova viva 2 ciclos (2026-08-22)

Reduzida mais uma camada de scheduler humano: a continuação ENTRE ciclos. `b8cac08`:
`runAutonomousBacklogHostTurn` roda até `maxCycles` ciclos bounded, continuando sozinho
enquanto um ciclo termina em `max_turns_reached` (bound atingido, pode haver mais) e
parando com veredito TIPADO (`continue|wait|stop` + `moreWorkAvailable`); dois bounds
estruturais (`maxTurnsPerCycle × maxCycles`) = defesa em profundidade. `classifyCycleContinuation`
puro. Rota `POST /api/work-orchestration/backlog-host-turn`. `buildProjectBacklogCycleDeps`
extrai a maquinaria real de uma volta, compartilhada com `backlog-cycle` (6/6 intactas).
Achado: `requiresAnotherTurn` é o análogo por-volta (era do turno único), sem consumidor
de produção, superado pelo driver; a continuação de CICLO é conceito novo, promovido.
host-turn 26/26 + rotas 12/12 + 602 verdes.

**Prova viva (registro `docs/registros/2026-08-22-prova-viva-do-host-turn-dois-ciclos-verified.md`):**
UMA invocação (`maxTurnsPerCycle=1, maxCycles=2`) rodou 2 ciclos sozinha → item A → `review`
→ continuou → item B → `review` → parou tipado (`max_cycles_reached, continuation=stop,
moreWorkAvailable=false`); ambos `verified` (7 checks, 0 violations), evidência host-observed
persistida. No ciclo 2, `pending.awaitingHuman=1` prova AO VIVO que A→review não congelou a
fila (B seguiu). ~70s, repo byte-intacto, worktrees descartadas, `origin/main` intacta.

**FRONTEIRA ARQUITETÔNICA (parada deliberada):** resta só o disparo AUTOMÁTICO da
invocação (runner always-on) — camada 3 do norte, com consequências arquitetônicas
(natureza do disparo, credencial de serviço, **gate real do Resource Governor**, backoff,
observabilidade durável, idempotência sob concorrência). É ADR/decisão humana, não daemon
improvisado. O passo de maturidade mais barato antes dele: promover o Governor de advisory
a gate no porto `hostPermitsAutonomousWork`. Detalhe no registro.

## Continuação — driver do backlog autônomo + prova viva `verified` (2026-08-22)

O laço de backlog ganhou seu DRIVER e foi provado ao vivo, fechando a lacuna que o
SUP-05 deixou de propósito ("quem decide invocar de novo é quem chama"). Três recortes:

- `0842d70` — política PURA `planAutonomousBacklogTurn` (core): executar-vs-parar +
  razão tipada sobre `projectAutonomousQueue`; item bloqueado nunca congela a fila.
- `7af0735` — DRIVER `runAutonomousBacklogCycle` (apps/web): iteração com efeito que
  consome a política, executa UMA volta do Supervisor por iteração, classifica o
  desfecho e para sem spin; limitado por `maxTurns` (estrutural, não quota), cancelável.
  33 provas por doubles cobrindo as 10 regressões exigidas.
- `e339136` — fiação viva: projeção real do backlog do banco
  (`readAutonomousBacklogCandidates`), observação host-side EXTRAÍDA e COMPARTILHADA
  com a rota supervisor-turn (`persistPostTurnHostObservations`, 11/11 daquela rota
  intactas), e a rota explícita `POST /api/work-orchestration/backlog-cycle`.

**Prova viva (2026-08-22, registro `docs/registros/2026-08-22-prova-viva-do-driver-de-backlog-cycle-verified.md`):**
UMA invocação da rota (`maxTurns=1`) atravessou, sem scheduler humano, `readBacklog →
execute_next → Supervisor → routing → claim → attempt → worktree qwen3-coder → gate →
result_submitted → review`, com evidência host-observed persistida (gate+coder+git:
`filesChanged 1/insertions 1`) e **parecer do Verifier `verified`** (7 checks, 0
violations). Resultado tipado `{turnsExecuted:1, itemsTouched:1, lastOutcome:
execution_completed, stopReason:max_turns_reached}`. Orçamento V2 admitiu ao vivo
(`admitted=true, costClass=local`). Repositório byte-intacto (`HEAD e339136`), worktree
descartada, `origin/main` intacta, nada aceito/integrado/aplicado.

**Restrição que permanece (maturidade):** o gatilho de CONTINUIDADE (re-invocar o
driver enquanto houver trabalho elegível) ainda não existe — deliberadamente não-daemon.
É a última milha do laço `while` governado; candidatos: host-turn manual, `requiresAnotherTurn`
consumindo a decisão de backlog, gate real do Resource Governor no porto `hostPermitsAutonomousWork`.

## Continuação — correção da classificação da política de segurança (2026-08-12)

O [Marco 006 — Política de Segurança como Maturidade Máxima](../marcos/006-politica-de-seguranca-como-maturidade-maxima.md)
**corrige** a classificação registrada na seção seguinte (tabela "Classificação das
fronteiras atualmente bloqueadas por humano"), na linha **"alterar a própria
política de segurança"**. Aquela linha a rotulava como **fundamental**; a
classificação correta é **restrição de maturidade de grau máximo** — a capacidade
de maior risco do sistema, hoje corretamente sob governança humana/reforçada, cujo
bloqueio é uma **dívida de evidência excepcionalmente pesada**, e **não** um teto
filosófico eterno.

Isto **não afrouxa nada**: no estado atual a capacidade permanece fail-closed sob
governança humana/reforçada. Muda apenas a leitura do porquê. Promovê-la — se e
quando — exige o processo reforçado do Marco 006 §3 (isolamento, testes
adversariais, replay/simulação, revisão independente, auditabilidade,
reversibilidade/rollback, rollout gradual, observabilidade, limites explícitos,
revogação automática).

Permanecem **fundamentais** (não maturidade), preservados sem alteração: as
decisões **intrinsecamente do criador da instância** e as decisões de produto
**ainda não definidas** (ex.: a superfície de UI de auto-desenvolvimento, linha
seguinte da mesma tabela). A tabela original abaixo é mantida como registro
histórico append-only; esta seção a supersede quanto à linha da política.

## Continuação — ratificação da autonomia progressiva (2026-08-12)

O [Marco 005 — Autonomia Progressiva e Identidade Una](../marcos/005-autonomia-progressiva-e-identidade-una.md)
reenquadra este plano sem alterar nenhuma proteção vigente e sem autorizar
nenhum efeito novo. Ele torna canônica a distinção entre:

- **restrição fundamental** — continua exigindo decisão humana porque ainda não
  foi definida ou é intrinsecamente do criador da instância;
- **restrição de maturidade** — queremos automatizar, mas ainda falta evidência
  de segurança suficiente. Não é teto; é dívida de evidência.

Sob essa luz, os "Limites da primeira versão" do
[Marco 003](../marcos/003-trabalho-autonomo-seguro.md) e a "Execução separada de
integração" (INT-03) **permanecem vigentes como estado atual**, mas passam a ser
lidos como **restrições de maturidade**, não tetos permanentes. Nada é afrouxado
aqui: a separação entre produzir e integrar continua obrigatória; o que evolui por
evidência é **quem/como** autoriza cada fato distinto.

**Classificação das fronteiras atualmente bloqueadas por humano:**

| Fronteira | Estado | Classificação |
|---|---|---|
| criação real de review request (PR) | contrato puro, sem provider/efeito (ADR-002) | maturidade |
| `merged`/`integrated` (merge/apply) | sem caminho alcançável; nova autorização humana | maturidade |
| deploy | fora do V0 | maturidade |
| Reviewer/Verifier independente automatizado | revisão hoje é humana | maturidade |
| habilitar efeito Git externo por config do operador | ato explícito do operador (não payload) | maturidade (config, não teto) |
| alterar a própria política de segurança | processo reforçado exigido | ~~**fundamental**~~ → **maturidade de grau máximo** (corrigido; ver continuação no topo e [Marco 006](../marcos/006-politica-de-seguranca-como-maturidade-maxima.md)) |
| criar uma superfície de UI de auto-desenvolvimento | decisão de produto (ver prova 2026-08-11) | **fundamental** — não definida |

**Consequência operacional.** Ao encontrar uma capacidade bloqueada por política,
o trabalho deve **classificá-la** e, se for de maturidade, escolher **trabalho
seguro que aumente evidência** — testes, dry-run, simulações, idempotência,
rollback, reconciliação, validação independente, auditabilidade, recuperação,
provas controladas — **em vez de** remover a proteção. Promover um estágio do
ciclo de programação (ver [`anima-prd.md`](../../anima-prd.md) §1f.1) é acumular
essa evidência, não relaxar o gate.

**Aprovação como mandato.** A direção ratificada é o usuário expressar intenção de
alto nível e o sistema derivar um **mandato/envelope** (escopo, contratos,
invariantes, limites, gates, condições de parada e escalonamento), impedindo
automaticamente o que estiver fora dele. A fundação já materializa parte disso
(`execution_spec`, elegibilidade pura do AUTO-01, permissões declaradas, limites,
gates); o Supervisor é o candidato natural a **autor do mandato**, e Executor e
Reviewer permanecem papéis **separáveis** que a arquitetura não deve assumir como
sempre o mesmo provider (Marco 005 §8–9). Nenhuma mudança de contrato ou schema é
autorizada por esta seção — ela registra direção e reclassifica fronteiras.

## Continuação — distinção entre início manual e Supervisor (2026-08-11)

A prova viva pós-correção confirmou `capability = programming` para uma tarefa
explicitamente de programação no commit `44785fb` (antes classificada como
`research` em `1fa67aa`), mantendo `impact = structural`. Na mesma prova, o
botão **Iniciar execução manual** levou o item a `in_progress` por `start_work`,
sem claim ou attempt; uma chamada posterior do Supervisor encontrou
`attempt_missing` e saiu `requires_human`, sem inventar execução.

A investigação ratificou que não há fiação quebrada: `/start` é a fronteira do
ciclo manual original, enquanto `/supervisor-turn` possui a fronteira separada
que seleciona, cria claim e abre attempt atomicamente. A reconciliação permanece
fail-closed. O gap era de orientação: embora o botão já dissesse “manual” e o
botão autônomo já fosse separado e condicionado à elegibilidade, a interface não
explicava que um ciclo manual iniciado não seria assumido depois pelo Supervisor.
O cartão agora explicita essa irreversibilidade operacional antes do início e,
em `in_progress`, orienta o operador a registrar o resultado manual. A semântica
das RPCs, a matriz de estados e a reconciliação não mudaram. Prova detalhada em
[`docs/registros/2026-08-11-prova-classificacao-e-inicio-manual.md`](../registros/2026-08-11-prova-classificacao-e-inicio-manual.md).

> Plano incremental derivado do [Marco 003 — Trabalho Autônomo Seguro](../marcos/003-trabalho-autonomo-seguro.md). Documento de planejamento: nenhuma fase está implementada. O backlog detalhado por item vive em [`002-modo-autonomo-v0-backlog.md`](002-modo-autonomo-v0-backlog.md).

Documentos base: [arquitetura da Orquestração de Trabalho](../arquitetura/orquestracao-de-trabalho.md), [Plano 001 — Modo Construção MVP](001-modo-construcao-mvp.md).

## Estado de partida (2026-07-16)

- Comprovado no código: `work_items`/`work_events` transacionais (F2); domínio compartilhado com proposta versionada, evidências tipadas e revisão (F3/F5); ciclo no chat web e mobile com foco (F4/F7); contexto por referências (F6); contrato `WorkExecutorAdapter` + execução limitada e persistida, validada com executor falso, sem UI (F8).
- Comprovado fora do repositório: runner local (projeto separado) com execução isolada, testes como gate de conclusão, feedback iterativo e aplicação somente após gate independente.
- Apenas visão: fila, claim, tentativas persistentes, checkpoint/handoff, supervisor, roteamento de inteligência, cartões de execução.

## Estado das fases

| Fase | Estado | Resultado |
|---|---|---|
| A | **Aceita (2026-07-20)** | ORQ-01–04 comprovados ao vivo em web autenticado e em dispositivo físico (iPhone 14 Pro); Fase B desbloqueada |
| B | **Concluída (2026-07-20)** | AUTO-01 a AUTO-06 concluídos como contrato de domínio; AUTO-03 completo (ambiente e consumo) permanece adiado por decisão do próprio item |
| C | **Concluída (2026-07-20)** | INT-01–03 implementados e ratificados conforme seus checkpoints |
| D | **Aceita (2026-07-20)** | INT-04 ratificado na revisão humana (resultado tecnicamente aceito); handoff produzido, sem aplicação/merge — ver "Aceite formal da Fase D" |
| E | **Concluída (2026-07-28)** | SUP-01 a SUP-05, laço operacional, Etapas 2A, 2B.1 e 2B.2 e a capacidade **“Checkpoint real pós-planejamento e retomada informada por contexto.”** implementados, comprovados e ratificados. A decisão humana de 2026-07-28 encerrou formalmente a fase; ver "Ratificação da produção e do consumo reais de checkpoints e conclusão da Fase E". |
| F | **Concluída (2026-07-28)** | INTEL-01 a INTEL-04 concluídos; política de orçamento ratificada e aplicada |
| G | Em andamento (software-complete no web) | UX-01, UX-02 e **UX-03 ratificados**; UX-04 (histórico e retomada pelo chat) **ratificado por Gean (2026-08-03)**. **Segunda triagem 2026-08-21** (matriz de cobertura core→web→mobile, registro `docs/registros/2026-08-21-fase-g-triagem-e-paridade-fase-humana-mobile.md`): paridade da **fase humana no mobile FECHADA** (`fbf1e87`, `presentMobileWorkProgress`); assimetria remanescente = **guarda de proveniência no mobile** (web usa `reconstructWorkPresentation`; mobile usa `presentWorkItem`) — **DEFERIDA por baixa severidade**: análise arquitetônica (registro `docs/registros/2026-08-21-git-continuidade-e-analise-provenance-guard-mobile.md`) mostra que é **defesa em profundidade/UX client-side, NÃO insegurança** (as RPCs versionadas/RLS/idempotentes são a autoridade fail-closed real). O caminho seguro (projeção de integridade events-only compartilhada) tocaria o caminho autoritativo do web por ganho baixo; retomada tem gatilho objetivo no registro. Blockers restantes: **prova física Expo Go** (device/Gean), **prova viva de superfície** (orçamento `admitted=false`) e **fase pós-review/PR** (decisão humana). |

## Fase A — Fechar a orquestração atual

**Objetivo:** comprovar ao vivo e fechar o ciclo manual existente antes de qualquer autonomia: resultado e evidências visíveis, foco operacional real, revisão transacional de propostas e continuidade entre conversa, cartão, resposta e eventos.

**Pré-requisitos:** F5/F7/F8 do Plano 001 (implementadas; aguardam comprovação funcional ao vivo).

**Entregáveis:** itens ORQ-01 a ORQ-04 do backlog; registro honesto no Plano 001 do que foi comprovado.

**Critérios de aceite:** um ciclo completo (pedido → proposta → aprovação → execução manual → resultado com evidências → revisão → encerramento) comprovado ao vivo em web e mobile, com eventos consistentes e foco estável entre plataformas.

**Evidências obrigatórias:** capturas ou registro da sessão ao vivo; suítes pgTAP/core/web verdes; eventos do ciclo consultáveis por `work_events`.

**Riscos:** tratar "implementado com testes" como "comprovado"; deriva de escopo consertando UX além do necessário.

**Fora do escopo:** qualquer conceito novo do Modo Autônomo; mudanças de schema além de correções do ciclo atual.

### Registro de verificação da Fase A (2026-07-18)

- ORQ-01–03 foram fechados nos commits `c3ec9d8`, `372ab38` e `a01855b`.
- ORQ-04 passou a reabrir a conversa arquivada mais recente sem excluir mensagens, reconstruir cartões a partir de item + eventos + contextos persistidos e bloquear ações quando algum elo obrigatório de proveniência estiver ausente ou inconsistente.
- A corrida entre envio e hidratação foi fechada: o chat não aceita novo turno até concluir a reconstrução; falha de hidratação permanece fail-closed e visível.
- Evidência local: suites core/web verdes, 177 asserções pgTAP verdes, migration aplicada no Supabase local, typecheck e build verdes. O pgTAP percorre arquivar → reabrir → reidratar a sessão preservando mensagens e isolamento por usuário.
- A verificação visual abriu o app web local, mas encontrou apenas a tela de login, sem sessão autenticada disponível. A validação em dispositivo mobile também não foi executada nesta sessão. Portanto, o critério de aceite ao vivo da Fase A ainda não foi declarado cumprido e a Fase B não está formalmente desbloqueada.

### Registro de verificação da Fase A (2026-07-20) — demonstração web autenticada

Sessão real na stack local (Supabase + Next.js dev + Ollama), autenticada com conta descartável criada pela Admin API (`fase-a-demo-1784563575@teste.local`, usuário `4d848bc9`, habilitado na allowlist de orquestração). Todos os comportamentos exigidos por ORQ-01–04 foram exercitados pelo fluxo real do chat:

- **ORQ-01** — item `564f5738` criado por mensagem no chat (`work_proposed` v1 + `context_attached` atômicos); aprovado, iniciado, resultado registrado com evidências tipadas (referência, validações `passou`/`falhou`, limitação) e aceito. Cartão final `completed · v3` com "Resultado aceito · v3" e evidências preservadas; `result_accepted` aponta exatamente a versão 3.
- **ORQ-03** — correção pelo cartão gerou v2 (par atômico `proposal_changes_requested` v1 + `proposal_revised` v2, mesmo commit de transação); correção concorrente por segundo cliente gerou v3; aprovação sobre o cartão obsoleto em v2 foi recusada com HTTP 409 (`version_conflict`/55000), **sem nenhum evento de decisão**, o cartão reconciliou para v3 e a explicação "O item mudou desde a última leitura." permaneceu visível após o reconcile; a aprovação válida foi registrada uma única vez sobre a v3.
- **ORQ-02** — quatro itens no ciclo, dois ativos simultâneos; foco seguiu o item mais novo, troca explícita por "Usar como foco" persistida em `work_focus`; rejeitar o item em foco limpou o foco; mensagem de continuação ambígua produziu o cartão "A qual trabalho você se refere?" com os dois candidatos, e a escolha definiu o foco e anexou a mensagem como contexto (`context_attached` v2) sem duplicar trabalho.
- **ORQ-04** — reload completo da página reidratou mensagens, cartões, estados e foco; arquivar preservou a sessão e as 12 mensagens (`conversation_sessions.archived_at` preenchido, mensagens intactas); "Retomar conversa anterior" reabriu a conversa com todos os cartões reconstruídos de item + eventos + contextos (completed/proposed/rejected e foco corretos); aprovar o item em foco após a retomada registrou exatamente um `work_approved` v1.
- Log de eventos do item `564f5738` íntegro e sem duplicatas: `work_proposed` → `context_attached` → (`proposal_changes_requested`+`proposal_revised`)×2 → `work_approved` → `work_started` → `result_submitted` → `result_accepted`, todos os eventos de decisão ancorados na v3.
- Suítes no mesmo HEAD (`0c1569a`): typecheck 4 workspaces + mobile, core 61, supabase 7, web 31, pgTAP 177, build web — todos verdes.
- **Mobile (sem dispositivo):** typecheck verde; `MobileWorkCard`/`mobile-work.ts` consomem o mesmo domínio `@anima/core` (coberto pelas suítes) e implementam reconcile pós-erro com mensagem preservada (`run()` recarrega via `reloadWork` mantendo o erro exibido). Não há tooling Android/iOS nesta máquina; a execução em dispositivo físico/emulador **não ocorreu** e é o único aceite restante da Fase A.

#### Roteiro manual mobile (único aceite pendente)

Pré-requisito: Expo Go em dispositivo na mesma rede, Supabase local acessível, usuário allowlisted. Passos determinísticos:

1. `npm run dev:mobile`, abrir no dispositivo, logar e enviar "Planeje uma melhoria no app" → **esperado:** cartão de proposta v1 em foco.
2. Pedir correção pelo cartão → **esperado:** cartão passa a v2 com o ajuste no escopo.
3. Em um navegador web logado na mesma conta, pedir outra correção (v3); no dispositivo, sem recarregar, aprovar o cartão v2 → **esperado:** recusa com mensagem compreensível, cartão reconcilia para v3 e a mensagem permanece visível.
4. Aprovar v3, iniciar, registrar resultado com uma validação `ok:` e uma `falha:`, aceitar → **esperado:** cartão `completed · v3` com evidências.
5. Fechar e reabrir o app → **esperado:** conversa e cartão reconstruídos com o mesmo estado.
6. Evidências a registrar: capturas de cada passo e `SELECT event_type, proposal_version FROM work_events WHERE work_item_id = '<item>' ORDER BY seq;` sem duplicatas.

Com o roteiro cumprido em dispositivo, a Fase A pode ser declarada aceita e a Fase B desbloqueada.

### Aceite formal da Fase A (2026-07-20) — validação em dispositivo físico

O roteiro manual acima foi executado integralmente em um **iPhone 14 Pro** (Expo Go, conectado via Tailscale à stack local), com a conta descartável `fase-a-demo-1784563575@teste.local`, guiado passo a passo com capturas de tela e verificação do banco a cada etapa. Item descartável: `e570b888`.

- **Login e retomada:** autenticação por senha funcionou; a conversa da sessão web foi reidratada no dispositivo com os quatro cartões anteriores em estado/versão/foco corretos (`completed · v3` com ajustes, `approved · v1` em foco com botão Iniciar, `proposed · v1`, `rejected · v1`).
- **Criação resiliente:** o envio de "Planeje uma melhoria no app" falhou na resposta do Ollama (firewall da máquina bloqueia entrada no 11434/11435 — problema de ambiente, não de produto), mas a proposta e a mensagem de origem foram persistidas; ao reabrir o app, o cartão v1 apareceu em foco, comprovando o backend como fonte de verdade.
- **Correção no dispositivo:** cartão v1 → v2 com par atômico `proposal_changes_requested`+`proposal_revised` (seq 692/693).
- **Conflito:** correção concorrente do cliente web levou o servidor a v3; aprovar o cartão obsoleto em v2 no dispositivo foi recusado com "O item mudou desde a última leitura.", o cartão reconciliou para v3 exibindo o ajuste vindo da web e **a mensagem permaneceu visível**; nenhum evento de decisão foi gravado.
- **Ciclo completo:** aprovar v3 → iniciar → resultado com validações `passou`/`falhou`, referência e limitação → aceite. Log final do item: 10 eventos, um por intenção, decisões ancoradas exclusivamente na v3, estado `completed · v3`.
- **Persistência:** fechar e reabrir o app reconstruiu o cartão `completed · v3` idêntico.

**A Fase A está formalmente aceita.** Critério do plano cumprido: ciclo completo comprovado ao vivo em web e mobile, com eventos consistentes e foco estável entre plataformas. A Fase B (AUTO-01–06) está desbloqueada.

Limitações registradas (não bloqueantes, fora do critério de aceite):
- Respostas de chat no mobile dependem de liberar `ollama.exe` no firewall do Windows (regras de bloqueio de entrada existentes); as ações de orquestração não passam pelo Ollama e funcionaram integralmente.
- O cartão mobile exibe as evidências na revisão, mas não re-exibe o "Resultado aceito" no estado `completed` como o web — lacuna de paridade anotada para correção separada.
- UX mobile: tocar no campo de texto do cartão pode desviar o foco para o input do chat — anotado para correção separada.

## Fase B — Contrato de execução

**Objetivo:** definir, como contrato de domínio (conceito antes de schema), o vocabulário do trabalho autônomo: elegibilidade, tentativa de execução, claim com expiração, checkpoint, handoff, interrupção humana e resultado para revisão.

**Pré-requisitos:** Fase A aceita.

**Entregáveis:** AUTO-01 a AUTO-06; documento de arquitetura estendendo `orquestracao-de-trabalho.md` (ou anexo) com os conceitos e invariantes; tipos de domínio em `packages/core` quando o conceito estabilizar.

**Critérios de aceite:** todo conceito tem definição, invariantes, eventos tipados propostos e regras de transição; nenhum conceito depende de fornecedor; elegibilidade é função pura verificável sobre o estado do item.

**Evidências obrigatórias:** documento revisado; testes de domínio para elegibilidade e invariantes de claim/tentativa quando os tipos existirem.

**Riscos:** desenhar schema prematuro; acoplar o contrato ao runner atual; vocabulário aberto demais para validação no servidor.

**Fora do escopo:** persistência definitiva em banco; supervisor; UI.

## Fase C — WorkExecutorAdapter

**Objetivo:** evoluir o contrato do adaptador para o ciclo autônomo: contrato de entrada delimitado, eventos de progresso, resultado, erro, decisão necessária, cancelamento, idempotência e correlação entre `work_item` e tentativa.

**Pré-requisitos:** Fase B (vocabulário de tentativa e checkpoint definido).

**Entregáveis:** INT-01 a INT-03; contrato revisado em `packages/core` compatível com o `WorkExecutorAdapter` existente ou o substituindo por migração explícita.

**Critérios de aceite:** um executor falso exercita todo o contrato (progresso, decisão necessária, erro, cancelamento, resultado) em testes; reexecução da mesma tentativa é idempotente; todo evento carrega correlação item/tentativa/versão aprovada.

**Evidências obrigatórias:** testes de contrato no core; documentação do contrato.

**Riscos:** contrato inchado antes do primeiro uso real; vazamento de detalhes de Ollama/Docker/Python para o domínio.

**Fora do escopo:** transporte real (API/CLI/fila); integração com o runner.

## Fase D — Integração mínima

**Objetivo:** primeira execução real sob comando: um `work_item` aprovado, início manual pelo usuário, uma tentativa, execução em workspace isolada, retorno de evidências e revisão humana antes de qualquer aplicação.

**Pré-requisitos:** Fases B e C; autorização explícita do usuário para a integração externa (regra do AGENTS.md).

**Entregáveis:** INT-04; um adaptador concreto (fora do core) que entrega o pacote aprovado a um executor real e traduz o retorno para o contrato.

**Critérios de aceite:** o ciclo inteiro acontece dentro do produto exceto a execução em si; evidências e resultado chegam tipados ao item; falha da integração não corrompe o item nem apaga histórico; nenhuma aplicação sem revisão.

**Evidências obrigatórias:** registro de uma execução real de ponta a ponta; eventos correlacionados persistidos; testes do adaptador com executor simulado.

**Riscos:** depender de detalhes do runner; segredos ou caminhos locais vazando para eventos; “só mais um atalho” virando fila informal.

**Fora do escopo:** fila, supervisor, seleção automática de executor, paralelismo, aplicação automática.

### Aceite formal da Fase D (2026-07-20) — ratificação da revisão humana do INT-04

O resultado do INT-04 foi **tecnicamente aceito na revisão humana**. A ratificação apoia-se em quatro evidências independentes e append-only, sem reescrever nenhum registro anterior:

- **Robustez do runner** (repositório separado `anima-local-agent-poc`, commit `db704e4`): tolerância estritamente controlada a respostas estruturadas inválidas por regeneração limitada do modelo (no máximo duas tentativas compartilhadas), com revalidação idêntica, auditoria da resposta bruta + SHA-256, e sem qualquer reinterpretação semântica. Fail-closed, escopo, allowlists, isolamento e separação produção/aplicação permaneceram intactos.
- **Teste adicional de regressão** (mesmo repositório, commit `5bd917d`): fixa que `write_file` com `\n` literais no `content` é preservado byte a byte, jamais desescapado — travando o contrato contra reinterpretação semântica do conteúdo produzido pelo modelo.
- **Prova anterior pelo endpoint** (registrada em `af4d8b4`): item `507af5ef-a72f-4451-8ddb-0747f5e4e856`, tentativa `e65d1de1-ef9c-4e13-8dd5-55d784642e87`, handoff `20260720T205121334287Z-result.zip` (SHA-256 `fbe7d1acf5a6017ea0eef7344d95882380be59122c8699ebbd481e8997c00e44`), item em `review`.
- **Nova prova independente (2026-07-20)**: o runner foi comandado exatamente como o adaptador o invoca (`--produce-only --model qwen2.5-coder:7b`, gate `python -m unittest`) contra uma **cópia isolada** do piloto. O sucesso produziu o bundle `20260720T221717004114Z-result.zip`, SHA-256 `8706d0ef9504893e7c2b1179b3af08bf15f727e2098653f63cdfd09204faad7e`, contendo apenas `calculator.py` corrigido (`return a + b`, quebras de linha reais); `python -m unittest` verde (1 teste); escada de gates completa até `result_produced`. É uma amostra distinta da anterior (bundle diferente, ambos válidos).

**Limitações observadas do `qwen2.5-coder:7b` (não bloqueantes):** o modelo é estocástico e fraco — foram necessárias quatro tentativas para uma amostra verde. Modos de falha observados e preservados como evidência: `content` com `\n` literais duplo-escapados (gerou `SyntaxError`, corretamente barrado pelo gate de testes) e `iteration_limit`. Em todas as tentativas a robustez agiu corretamente: nenhuma resposta estruturada válida foi indevidamente recusada e as falhas foram do gate factual, nunca do gate estrutural.

**Confirmações de segurança:** nenhuma aplicação automática ocorreu em nenhuma tentativa (`apply.status=not_attempted`); nenhum merge, push ou deploy. O piloto original permaneceu **byte a byte intacto** (SHA-256 de `calculator.py` = `9445c47952abb8a7fc5d4a905d55b5be05771df1d69362ec597f9a50f7ede40d`, árvore limpa, HEAD `9101ec5`).

**A Fase D está formalmente aceita.** Critério do INT-04 cumprido: ciclo real comandado pelo Anima com resultado tipado e evidências persistidas, revisão humana concluída, integração sem corromper o item nem apagar histórico, e nenhuma aplicação sem revisão. A comprovação ao vivo (pré-requisito da Fase E) foi atendida pela prova registrada em `af4d8b4`.

## Fase E — Supervisor V0

**Objetivo:** o primeiro laço autônomo: fila persistente de itens elegíveis, escolha do próximo item, claim exclusivo, um trabalho por vez, pausa, retomada e recuperação de claims expirados.

**Pré-requisitos:** Fase D comprovada ao vivo.

**Entregáveis:** SUP-01 a SUP-04; AUTO-05 comprovado (retomada real após interrupção).

**Critérios de aceite:** com N itens elegíveis, o supervisor executa um por vez na ordem definida; interrupções (processo morto, Docker fora, limite de provedor) deixam checkpoint e a retomada continua do último estado válido; claim expirado é recuperado sem duplicar execução.

**Evidências obrigatórias:** cenário de interrupção forçada documentado com evidências; testes de recuperação de claim.

**Riscos:** duplo processamento por claim mal desenhado; supervisor virando scheduler genérico antes da hora.

**Fora do escopo:** paralelismo geral; múltiplos projetos simultâneos; priorização sofisticada.

### Ratificação do SUP-05 (2026-07-21) — exclusividade de alvo simétrica

A revisão humana **aprovou e ratificou** o SUP-05. Registro append-only, sem reescrever nenhuma evidência anterior. Foram aprovados nominalmente:

- a correção em `private.begin_work_attempt` como **fronteira única** compartilhada pelos inícios comandado e autônomo — e não uma verificação acrescentada ao caminho comandado, que duplicaria a regra;
- o uso de `pg_advisory_xact_lock` por `user_id + target_reference`;
- a manutenção da mesma ordem de locks de `acquire_work_claim` (item antes do alvo), que impede ciclo;
- o retorno de **replay antes** da verificação de exclusividade, preservando a idempotência do INT-04 e do AUTO-05;
- as exclusões do próprio item e do claim pertencente à própria tentativa;
- claims expirados **não bloquearem** e **não serem apropriados silenciosamente** pelo caminho comandado;
- o **endurecimento para falha fechada** (`execution target missing`, `22023`) quando o alvo não puder ser derivado — única alteração assumida sobre o contrato ratificado do INT-04;
- a garantia limitada por `user_id`, coerente com a V0 monousuário;
- o lock permanecer apenas durante a **transação curta de início**, e não pela duração da execução;
- as evidências pgTAP, a regressão completa e a corrida real entre duas sessões.

**Evidências ratificadas:**

- **Suíte específica** (`supabase/tests/commanded_target_exclusivity.test.sql`, commit `8310808`): 25 asserções cobrindo alvo livre, bloqueio por item `in_progress`, bloqueio por claim autônomo ativo, não-ocupação por estados encerrados ou em revisão, idempotência do replay sobre alvo ocupado por ele mesmo, e a inércia da recusa (claim alheio com `released_at`, `owner_instance_id` e `attempt_id` intactos; item comandado sem evento de execução).
- **Regressão completa:** 316 asserções pgTAP em 11 suítes, zero falhas; `typecheck` limpo nos cinco workspaces; 365 testes Jest em `packages/core` e 7 em `packages/supabase`; build do `apps/web` concluído.
- **Corrida real entre duas sessões**, com dois itens **diferentes** no **mesmo** alvo — a configuração em que locks de linha não serializam: a sessão concorrente permaneceu bloqueada por aproximadamente 3,97 segundos, até a conclusão da transação concorrente, e então foi recusada com `work target is held by an active claim` (`55000`).
- **Contrafactual medido:** durante a mesma janela, a consulta otimista que uma verificação na aplicação faria leu `alvo_ocupado = false` e retornou em menos de 1 milissegundo. É a prova de que a janela de corrida é observável e de que o lock é necessário, não decorativo.

**Correção documental desta ratificação:** o resumo em chat da prova concorrente trouxe a forma ambígua "3.968 ms"; a medição real é ~3,97 segundos (`Time: 3967.680 ms (00:03.968)`). A forma ambígua **nunca entrou no repositório** — a documentação e o commit `5aac4e4` já registravam "3,97 s" —, mas a redação foi uniformizada para a unidade inequívoca em todas as ocorrências.

**Confirmações de segurança:** nenhum resultado produzido foi integrado ou aplicado; nenhum merge, push, deploy ou `db reset`. O SUP-04 (reconciliação após interrupção) **não foi iniciado**. Com o SUP-05 encerrado, cai o bloqueio que impedia o Supervisor de iniciar execuções reais.

### SUP-04 pronto para revisão (2026-07-21) — reconciliação após interrupção

**Ainda não ratificado.** Registro append-only do estado alcançado, para o checkpoint humano.

**Diagnóstico confirmado:** nenhum caminho tirava um item de `in_progress` sem sinal do executor. A rota `execute-commanded` fica até 1800 s entre `start_commanded_work_attempt` e `record_commanded_work_terminal`; morto o processo nessa janela, o item ficava travado **para sempre**, ocupando o alvo pelo SUP-05 e saindo da fila do SUP-01. O AUTO-05 era estruturalmente inalcançável: `planWorkResumption` já recusava `in_progress` apontando para o SUP-04.

**Decisão central submetida à revisão:** a reconciliação não pergunta se a execução terminou — não pode saber. Pergunta se a tentativa **excedeu um limite declarado e persistido**: o lease de `work_claims` (AUTO-02) para a tentativa sob claim, e `execution_spec.limits.max_duration_minutes` da proposta **aprovada** (AUTO-01) para a comandada. Exige **todos** os limites aplicáveis excedidos. Sem limite algum declarado, sai como `requires_human` e não muda nada. `attempt_abandoned` afirma estritamente que a tentativa excedeu seu limite e deixou de ser a ocupante — mais fraco que concluir ou falhar.

**Decisões que pedem aprovação nominal:**

- a escolha de `approved` como destino do abandono, e a rejeição explícita de `failed` (afirma o não observado) e de `blocked` (beco sem saída: nenhuma RPC emite `work_blocked` e `begin_work_attempt` exige `approved`);
- o uso de `max_duration_minutes` da proposta aprovada como contrato persistido do caminho comandado, em vez de criar lease novo — que alteraria o INT-04;
- a exigência conjunta de todos os limites, em vez de qualquer um;
- materializar desfecho já persistido **sem** emitir evento novo;
- o recolhimento do lease vencido mesmo quando a tentativa continua protegida pelo limite de duração;
- o `pg_advisory_xact_lock` por usuário e a decisão de **não** adquirir lock de alvo, o que impede ciclo com `acquire_work_claim`;
- a guarda nova em `record_commanded_work_terminal` contra sinal tardio de tentativa abandonada, posicionada depois do replay idempotente;
- o status `abandoned` em `classifyPersistedAttempt` e a recusa `409` na rota.

**Evidências:**

- **Suíte específica** (`supabase/tests/supervisor_reconciliation.test.sql`): 65 asserções cobrindo reconciliação vazia inerte, posse válida intocada, lease vencido recolhido com razão declarada e linha preservada, órfã supervisionada e órfã comandada, o caso em que um único limite excedido **não** basta, ausência total de limite saindo como `requires_human`, desfecho já persistido materializado sem duplicar evento, posse liberada por fato com lease ainda ativo, idempotência em segunda e terceira passadas, recusa do sinal tardio, replay do INT-04 intacto e exclusividade do SUP-05 preservada.
- **Regressão completa:** 381 asserções pgTAP em 12 suítes, zero falhas; `typecheck` limpo nos cinco workspaces; 388 testes Jest em `packages/core` e 7 em `packages/supabase`; build do `apps/web` concluído.
- **Corrida real entre três sessões:** A reconciliou e segurou a transação; B, iniciada 1 s depois, **bloqueou 4,02 s** e retornou **zero linhas**; o estado final commitado tem exatamente um `attempt_abandoned` e um `work_claim_released`.
- **Contrafactual medido:** na mesma janela, a consulta otimista que uma verificação na aplicação faria leu `in_progress` com `lease_vencido = true` — "abandonaria = true" — em 0,5 ms. A janela de corrida é observável, não hipotética.

**Riscos e limitações declarados:**

- **Executor zumbi.** O banco não mata processos. Um executor que ignore seu próprio limite declarado pode continuar mexendo no alvo depois do abandono. Mitigações reais: o abandono só ocorre depois do limite que o próprio contrato declarou; a exclusividade do SUP-05 continua valendo no início da tentativa seguinte; e o sinal tardio é recusado. Fechar isso por completo exigiria cancelamento cooperativo do runner — fora do escopo do SUP-04.
- **Tentativa comandada sem `max_duration_minutes` permanece travada** em `in_progress` até decisão humana. É deliberado: sem limite declarado não há fato. Um caminho humano explícito de abandono seria o próximo passo natural, e não foi criado aqui para não ampliar escopo.
- **Bundle da tentativa abandonada não é aceito nem descartado.** Ele permanece no nó local, referenciado pelo evento de abandono; nenhuma via automática o promove a resultado.
- ~~**A demonstração ao vivo** de um cenário do Marco 003 com executor real, exigida pelo aceite do SUP-04, **ainda não foi feita**.~~ — **satisfeito em 2026-07-21**, ver "Demonstração ao vivo do SUP-04" abaixo.
- A garantia é limitada por `user_id`, coerente com a V0 monousuário.

### Demonstração ao vivo do SUP-04 (2026-07-21) — `application_shutdown` com executor real

Evidência exigida pelo aceite do SUP-04 ("cada cenário de interrupção do Marco 003 tem teste e pelo menos um foi demonstrado ao vivo"). Registro append-only; **o SUP-04 continua não ratificado**.

**Cenário:** `application_shutdown` — o processo da aplicação morre no meio da execução comandada, sem gravar sucesso nem falha.

**Fluxo real atravessado:** rota `POST /api/work-orchestration/execute-commanded` com sessão autenticada real (cookie `@supabase/ssr` de `sup04-live@test.invalid`), `LocalRunnerAdapter` (`local-runner-v1`) invocando o runner de `G:/anima-local-agent-poc` (`python -m local_agent --produce-only --model qwen2.5-coder:7b`) sobre **cópia isolada** do piloto, com Ollama local. RPCs reais: `create_work_proposal`, `resolve_approval`, `start_commanded_work_attempt`, `reconcile_supervised_work`, `record_commanded_work_terminal`. Nenhuma linha foi inserida diretamente no banco para simular o executor; o SQL serviu apenas para observar.

**Item da prova:** `41fe2069-eacf-404d-956e-dd9499e1dd64`, tentativa `41fe2069-0000-4000-8000-00000000b002`, `max_duration_minutes = 1` — o **menor limite que o contrato permite**, para tornar a prova prática sem alterar nenhum timestamp depois do início.

**Cronologia observada (UTC):**

| Horário | Fato persistido |
|---|---|
| 15:29:19 | `work_proposed`, `context_attached`, `work_approved` (seq 3478–3480) |
| 15:29:34.44 | `work_started` + `execution_started` (seq 3481–3482); item em `in_progress`; runner real vivo (PIDs 24344 e 11424) |
| ~15:29:54.8 | **servidor da aplicação derrubado**; a conexão HTTP da rota caiu sem resposta; nenhum terminal foi gravado |
| 15:30:01 | item confirmado órfão: `in_progress`, **0** eventos terminais, **0** claims (caminho comandado não cria lease) |
| **15:30:31** | **reconciliação executada 57 s depois da morte do executor: recusou concluir qualquer coisa** — `attempt_within_declared_bounds` / `none`, item permaneceu `in_progress` (faltavam 3 s do limite declarado) |
| 15:30:49 | limite excedido; reconciliação produziu `attempt_abandoned` (seq 3483, autor `system`), item → `approved` |

**A linha de 15:30:31 é a evidência central da prova.** O processo executor estava morto havia quase um minuto e a reconciliação ainda assim não afirmou nada, porque o limite declarado não tinha vencido. É a demonstração direta de que a decisão é governada pelo **limite persistido**, não pela ausência do executor.

**Payload do abandono:** `reason: duration_limit_exceeded`, `origin: commanded`, `claim_id: null`, `lease_expires_at: null`, `max_duration_minutes: 1`, `attempt_started_at: 15:29:34.440604Z`, `observed_at: 15:30:49.369586Z`.

**Idempotência:** segunda e terceira reconciliações, cada uma em transação própria, retornaram **0 linhas**. O item terminou com **6 eventos** no total e **exatamente um** `attempt_abandoned`. Nenhum claim foi criado ou liberado — não havia nenhum.

**Terminal tardio:** a chamada real de `record_commanded_work_terminal` com os identificadores da tentativa abandonada e um sinal `result` bem-formado foi **recusada** com `attempt was abandoned by reconciliation` (`55000`). Depois da recusa: item ainda `approved`, ainda 6 eventos, **zero** eventos terminais indevidos. **Limitação declarada:** não foi reproduzido um executor zumbi real — os processos do runner morreram junto com a aplicação nesta configuração (observação registrada abaixo) —, então a guarda foi exercitada pela fronteira real com os identificadores da tentativa abandonada, como o checkpoint autorizou.

**Nenhum efeito de resultado ou integração:** zero `result_accepted` e zero itens `completed` em todo o banco local; a workspace isolada terminou **byte a byte intacta** (`git status` vazio, `sum()` ainda retornando `a - b`) — nada foi aplicado, aceito, autorizado ou integrado.

**Diferenças entre o esperado e o observado:**

1. **Primeira tentativa falhou por setup, não por defeito do SUP-04.** O runner exige workspace em repositório git limpo; a cópia isolada não era repositório, o runner caiu com `EOFError` no prompt interativo de workspace suja e saiu com código 1. O adaptador converteu isso corretamente em `execution_failed`, e o item `1766ad82-29e4-4d0d-b1ee-d2859630acce` foi para `failed` — comportamento correto do INT-04, não órfão. A prova foi refeita com a workspace inicializada como repositório git (HEAD `6f32937`).
2. **Os processos do runner não sobreviveram à queda da aplicação** nesta configuração: derrubado o servidor, os PIDs filhos desapareceram junto. Isso **reduz** a exposição prática ao risco de executor zumbi, mas **não o elimina** — é uma observação sobre este ambiente (encerramento em árvore no Windows), não uma garantia do contrato. O risco permanece registrado.
3. Fora esses dois pontos, o comportamento observado coincidiu exatamente com o projetado.

**Configuração local da prova** (não versionada, `apps/web/.env.local` é ignorado pelo git): `ANIMA_LOCAL_RUNNER_ROOT`, `ANIMA_LOCAL_RUNNER_MODEL=qwen2.5-coder:7b` e `ANIMA_LOCAL_TARGETS_JSON` apontando `sup04-live` para a cópia isolada no diretório temporário da sessão. As linhas ficaram marcadas com comentário; removê-las desabilita o executor local.

**Validações após a prova:** 381 asserções pgTAP em 12 suítes (incluindo as 65 do SUP-04), 23 testes de domínio do espelho puro e `typecheck` limpo nos cinco workspaces. Nenhum arquivo de código foi alterado pela demonstração; a árvore permaneceu limpa em `f06f19d`.

**Estado dos dados locais:** as fixtures das provas de corrida (SUP-03, SUP-05 e SUP-04) e da demonstração ao vivo foram **preservadas** como evidência auditável, seguindo o padrão já adotado. Verificado ao final: **zero claims ativos** e **zero itens em `in_progress`** em todo o banco local — nenhum alvo permanece ocupado. Todas as contas de prova usam o domínio `@test.invalid`.

**Confirmações de segurança:** nenhuma execução foi disparada pela reconciliação; nenhum resultado foi aceito, autorizado, integrado ou aplicado; nenhum outro item da Fase E foi iniciado; `private.begin_work_attempt` não foi tocado e o SUP-05 permanece idêntico; nenhum merge, push, deploy ou `db reset`.

### Ratificação do SUP-04 (2026-07-21) — reconciliação após interrupção

A revisão humana final **aprovou, ratificou e encerrou** o SUP-04. Registro append-only: nenhuma evidência ou seção anterior foi reescrita, e as duas seções acima permanecem como o percurso que levou até aqui.

**A pendência que bloqueava a ratificação está satisfeita.** O aceite do SUP-04 exigia que ao menos um cenário de interrupção do Marco 003 fosse demonstrado ao vivo com executor real. A demonstração registrada no commit `40b8815` cumpriu o requisito e foi ratificada integralmente, com seus quinze pontos: início pela rota real `POST /api/work-orchestration/execute-commanded`, autenticação real por sessão, `LocalRunnerAdapter` e executor local reais, `work_started` e `execution_started` persistidos, interrupção da aplicação sem terminal, item órfão em `in_progress`, reconciliação recusada antes do vencimento do limite, abandono somente após `max_duration_minutes = 1` ser excedido, exatamente um `attempt_abandoned`, retorno a `approved`, reconciliações posteriores idempotentes e sem novos eventos, recusa de terminal tardio pela fronteira real, ausência de aceite, autorização, integração ou aplicação, ausência final de claims ativos e alvos ocupados, e workspace isolada sem alteração.

**O núcleo da ratificação:** a revisão destacou nominalmente a recusa da reconciliação aos **57 segundos** após a morte do executor como parte central do aceite. A ausência do processo não foi tratada como prova de nada; a decisão só ocorreu depois que o limite persistido venceu. É esse comportamento — e não o abandono em si — que o checkpoint ratificou.

**Decisões arquiteturais ratificadas nominalmente:**

- `attempt_abandoned` como afirmação **mais fraca** que sucesso ou falha;
- a transição `in_progress → approved`, única linha nova da matriz normativa;
- a **rejeição de `failed`** como conclusão inferida da ausência do executor;
- a **rejeição de `blocked`** enquanto não existir caminho executável de retomada a partir desse estado;
- `work_claims.expires_at` como limite persistido do caminho supervisionado;
- `execution_spec.limits.max_duration_minutes` como limite persistido do caminho comandado;
- a exigência de que **todos** os limites aplicáveis estejam excedidos;
- ausência de limite declarado resultando em `requires_human`, **sem mutação**;
- a guarda contra terminal tardio de tentativa abandonada;
- o **replay idempotente preservado antes** dessa guarda;
- a reconciliação restaurar consistência e elegibilidade **sem iniciar execução**;
- eventos append-only e operações idempotentes;
- o lock consultivo por usuário combinado com o lock por item;
- nenhuma interação da reconciliação com aceite, autorização ou integração.

**Observações aceitas pela revisão, sem alterar o resultado:**

- a primeira tentativa da prova falhou porque a workspace não era repositório git limpo — falha de preparação de ambiente, não defeito do SUP-04; o adaptador produziu corretamente `execution_failed`;
- os processos do runner não sobreviveram à queda da aplicação neste ambiente, o que **reduz a exposição observada** ao executor zumbi mas **não elimina o risco conceitualmente**; ele permanece no registro de riscos;
- a guarda contra terminal tardio foi comprovada pela chamada real da fronteira terminal com os identificadores da tentativa abandonada, e não por um zumbi genuíno;
- as fixtures permanecem no banco local como evidência auditável, e a configuração local do runner em `apps/web/.env.local` permanece como está.

**Riscos que sobrevivem à ratificação** (registrados, não resolvidos): o executor zumbi conceitual, que o banco não pode matar; a tentativa comandada **sem** `max_duration_minutes` declarado, que permanece em `in_progress` até decisão humana por não haver fato que sustente transição; e o bundle de uma tentativa abandonada, que não é aceito nem descartado automaticamente.

**O SUP-04 está ratificado e encerrado.** Suas decisões não devem ser reabertas sem evidência concreta de regressão ou incompatibilidade. Com isso, **SUP-01 a SUP-05 estão todos concluídos**; o que resta para fechar a Fase E é o laço que escolhe e executa (SUP-02 + AUTO-02 operando juntos) e a comprovação do AUTO-05 em retomada real — nenhum deles iniciado.

**Confirmações de segurança desta ratificação:** nenhum código funcional foi alterado; nenhum resultado foi aceito, autorizado, integrado ou aplicado; nenhum próximo item da Fase E foi iniciado; nenhuma fixture foi removida; o SUP-05 permanece intocado; nenhum merge, push, deploy ou `db reset`.

### Laço operacional do Supervisor V0 (2026-07-21) — pronto para revisão

**Não ratificado.** Registro append-only do estado alcançado, para o checkpoint humano. Nenhuma seção anterior foi reescrita.

**Diagnóstico confirmado no código.** As capacidades da Fase E existiam sem chamador: `autonomous_work_queue`, `next_autonomous_work`, `acquire_work_claim`, `start_claimed_work_attempt`, `release_work_claim` e `reconcile_supervised_work` não tinham **uma única chamada** em código de aplicação — apenas migrations, pgTAP e espelhos puros em `packages/core`. O único caminho operacional vivo era `POST /api/work-orchestration/execute-commanded` (INT-04), que usa o início comandado e não passa por posse. Não existia rota, worker, script ou processo capaz de executar o primeiro laço autônomo.

**Ponto de entrada criado:** `POST /api/work-orchestration/supervisor-turn` — **uma volta por invocação**, sem daemon, agendador ou polling. Rota autenticada porque todas as RPCs do ciclo resolvem `auth.uid()` e consultam a allowlist; um processo residente exigiria credencial de serviço nova.

**Sequência implementada:** `reconcile_supervised_work()` → `next_autonomous_work()` → leitura do item → parser do `execution_spec` → contextos → `acquire_work_claim` → `start_claimed_work_attempt` → `LocalRunnerAdapter` → `record_commanded_work_terminal` → `release_work_claim('attempt_finished')`.

**Fronteiras reutilizadas, nenhuma reimplementada.** Elegibilidade, ordem FIFO, ocupação de alvo e exclusividade continuam no banco. `evaluateAutonomousEligibility` é chamado só como parser do spec; divergência entre ele e o espelho SQL sai fail-closed **sem tomar posse**. O terminal reusa a RPC ratificada do INT-04, que valida por correlação de `execution_started` — emitido pelos dois caminhos — e não por origem; uma RPC nova duplicaria a guarda do SUP-04 contra sinal tardio.

**Serialização.** Exclusivamente do banco: lock do item, lock consultivo de alvo e índice único parcial. **Nenhum mutex em memória.** Não há consulta prévia de disponibilidade antes do claim — prever posse na aplicação é a janela que o SUP-05 mediu.

**Incerteza não vira conclusão.** Executor que lança, transcrição fora do contrato do INT-01 ou terminal recusado deixam a tentativa **aberta**, sem desfecho inventado e **sem liberar a posse** — é a órfã que o SUP-04 reconcilia por limite persistido.

**Testes (15 casos, `apps/web/lib/work-orchestration/supervisor.test.ts`):** o fake modela as invariantes ratificadas (posse única por item, alvo ocupado por claim ativo ou item em execução, replay idempotente, liberação idempotente por razão), de modo que os testes provam obediência às recusas e não coreografia de chamadas. Cobrem fila vazia sem efeito, reconciliação antes da seleção, cabeça FIFO, claim antes do início, uso de `start_claimed_work_attempt` e nunca do comandado, executor acionado exatamente uma vez, terminal registrado, posse liberada após o terminal, falha do executor virando terminal de falha, duas invocações concorrentes sem execução dupla, corrida perdida com recusa tipada, posse alheia intocada, exclusividade de alvo, item inelegível barrado antes da posse, replay sem duplicar efeito e ausência de aceite, autorização ou integração.

**Validações no HEAD da entrega:** 381 asserções pgTAP em 12 suítes, zero falhas (inalteradas — SUP-04 e SUP-05 intocados); Jest 388 em `packages/core`, 51 em `apps/web` (36 anteriores + 15 novos), 12 em mobile, 7 em `packages/supabase`; `typecheck` limpo nos quatro workspaces; build do `apps/web` concluído com a rota registrada. **Não existe script de lint neste repositório** (registrado no `AGENTS.md`), então essa validação não foi executada.

#### Prova ao vivo (2026-07-21) — dois itens, FIFO, executor real

Rota real com sessão autenticada (`suploop-fifo@test.invalid`), `LocalRunnerAdapter` invocando o runner de `G:/anima-local-agent-poc` sobre **cópias isoladas** do piloto, cada item em seu alvo. Nenhuma linha foi inserida diretamente no banco para simular o executor; o SQL serviu apenas para observar.

| Invocação | Selecionado | `approval_seq` | Desfecho | Terminal | Posse |
|---|---|---|---|---|---|
| 1ª | `7493f05f` (suploop-a) | 4316 | `execution_completed` | `result` | liberada |
| 2ª | `49104e5b` (suploop-b) | 4319 | `execution_completed` | `result` | liberada |
| 3ª | — | — | `no_eligible_work` | — | — |

Log dos dois itens, **sem sobreposição**: `work_claimed` 4320 → `work_started` 4321 (`supervised_execution`) → `execution_started` 4322 → `result_submitted` 4323 → `work_claim_released` 4324 (`attempt_finished`); só então `work_claimed` 4325 do segundo item, e a mesma escada até 4329. A posse do segundo item é adquirida **estritamente depois** da liberação do primeiro: um por vez, na ordem definida.

Handoffs persistidos: `local-runner:suploop-a:20260721T164718743084Z-result.zip:sha256:12445eee…` e `local-runner:suploop-b:20260721T164913520389Z-result.zip:sha256:f4e4eb2b…`. Ambos os itens terminaram em **`review`** — decisão humana pendente, nunca `completed`.

#### Prova concorrente real

Duas invocações disparadas **no mesmo tick**, cada uma uma requisição HTTP independente:

- **Itens diferentes disponíveis:** cada volta selecionou um item distinto (`approval_seq` 4276 e 4279), com claims e tentativas distintos. Progresso paralelo em alvos distintos, sem colisão.
- **Um único item disponível (duas repetições):** ambas as voltas selecionaram **o mesmo item** — a leitura da seleção não bloqueia, exatamente como o SUP-02 documenta — e a perdedora foi recusada **no claim**, com `claimId` e `attemptId` nulos, sem jamais acionar o executor. As duas recusas tipadas do contrato foram observadas ao vivo: `work item is held by an active claim` (**215 ms**, perdedora chegou depois da aquisição e antes do `in_progress`) e `work item is not eligible for an autonomous claim` (**321 ms** e **1,2 s**, perdedora chegou depois do início). Estado final: exatamente **um** claim, **um** `execution_started` e **um** terminal por item.

#### Cancelamento cooperativo observado sem ser planejado

Numa das voltas o cliente navegou durante a execução; o `AbortSignal` da requisição propagou ao adaptador, que emitiu `cancelled`, e o laço registrou `work_cancelled` e liberou a posse com `attempt_finished`. Comportamento correto do contrato, observado por acidente e registrado por honestidade.

#### Achado sobre o executor, fora do escopo desta entrega

As primeiras **onze** voltas terminaram em `execution_failed`. A investigação isolou a causa e ela **não está no laço**: `taskFor()` do `LocalRunnerAdapter` (INT-04) costura `Fora do escopo: <lista>` no prompt do modelo, e citar ali um **arquivo real** faz o modelo planejar editá-lo. Reproduzido fora da rota: com o texto exato que o adaptador monta, o runner falhou pela CLI (`model_execution_iteration_limit`, plano incluindo "Atualizar test_calculator.py"); com o objetivo isolado, a mesma CLI produziu `result_produced` de primeira. Removendo nomes de arquivo reais do escopo excluído do **item** — dado, não código — a primeira volta seguinte foi verde.

Isso é uma propriedade do adaptador ratificado no INT-04, não uma regressão; **não foi alterado aqui**, porque mexer nele muda contrato ratificado sem evidência de regressão. Fica registrado como candidato a item próprio.

Modelo do runner trocado de `qwen2.5-coder:7b` para `qwen2.5-coder:14b` em `apps/web/.env.local` após quatro falhas seguidas em `invalid_structured_response`. Mesmo runner, mesmos gates, apenas modelo mais estável. É configuração local não versionada; a linha do SUP-04 foi preservada e os alvos anteriores continuam declarados.

#### Confirmações de segurança

Zero `result_accepted` e zero itens `completed` em todo o banco local. Todos os **15 claims** criados pelo laço, em 8 contas de prova, foram liberados: **zero claims ativos** do laço e **zero itens `in_progress`**. Os três claims ativos remanescentes no banco são fixtures de 2026-07-20 das provas do SUP-03 e do AUTO-02, preservadas como evidência auditável e **não tocadas**. As quatro workspaces isoladas terminaram **byte a byte intactas** (`git status` vazio, `sum()` ainda retornando `a - b`): nada foi aplicado, aceito, autorizado ou integrado. Nenhum merge, push, deploy ou `db reset`. `private.begin_work_attempt` não foi tocado; SUP-04 e SUP-05 permanecem idênticos.

#### Limitações declaradas

- **A persistência de `WorkHandoffV1` não foi implementada.** O banco continua guardando apenas `handoff_reference`, uma string opaca. É tarefa separada e exige checkpoint humano por alterar contrato persistido e vocabulário de eventos.
- **O AUTO-05 não foi iniciado nem comprovado.** Sem checkpoint estruturado persistido não há de onde `planWorkResumption` eleger retomada; o abandono do SUP-04 não produz handoff algum.
- **Não há execução contínua.** Uma volta por invocação; quem chama decide a periodicidade.
- **A `maxDuration` da rota é 1800 s** e uma volta longa ocupa a conexão HTTP inteira. Cliente que desiste no meio produz cancelamento cooperativo, como observado.

> **Correção comprovada em 2026-08-11:** esse cancelamento não era uma decisão
> humana cooperativa; era o `request.signal` do transporte sendo repassado ao
> executor e persistido como `work_cancelled [user]`. O commit `3c9ac70`
> desacoplou a tentativa já aprovada da conexão HTTP. Pausa/cancelamento humano
> continuam pelo contrato explícito de UX-01 em checkpoint. Queda do processo
> permanece coberta por lease/checkpoint/reconciliação, sem terminal inventado.
- O laço herda a estabilidade do executor local: enquanto o modelo falhar seu próprio gate factual, a volta termina corretamente em `execution_failed`, que é comportamento, não defeito.

**A Fase E não está encerrada.** O critério "com N itens elegíveis, o supervisor executa um por vez na ordem definida" está comprovado; a retomada real do AUTO-05 continua pendente.

### Ratificação do laço operacional (2026-07-26) — mecanismo de execução da V0

A revisão humana **aprovou, ratificou e encerrou** o laço operacional. Registro append-only: nenhuma seção anterior foi reescrita; a seção acima permanece como o percurso que levou até aqui.

**Provas frescas na ratificação (2026-07-26, HEAD `a36d7cf`):** o espelho puro do SUP-04 (`packages/core`, `work-reconciliation`) passou 23/23; o laço (`apps/web/lib/work-orchestration/supervisor.test.ts`) passou 15/15; `typecheck` limpo nos cinco workspaces (mobile, web, core, supabase, types). A suíte pgTAP (381 asserções, 12 suítes) **não foi reexecutada**: o laço não tocou migration alguma e SUP-04/SUP-05 permanecem byte a byte, de modo que reexecutar suíte ratificada não altera o veredito.

**Decisões arquiteturais ratificadas nominalmente:**

- **uma volta por invocação** via rota autenticada, sem daemon, agendador ou polling — a periodicidade pertence a quem chama, e `requiresAnotherTurn` diz se vale insistir;
- **reconciliar (SUP-04) antes de selecionar**, para nunca decidir sobre um estado que a interrupção deixou mentindo;
- **serialização inteiramente do banco** (lock do item, lock consultivo de alvo, índice único parcial), **sem mutex em memória** e **sem consulta prévia de disponibilidade** antes do claim — prever posse na aplicação é a janela que o SUP-05 mediu;
- **`evaluateAutonomousEligibility` apenas como parser** do `execution_spec`, com divergência em relação ao espelho SQL saindo **fail-closed sem tomar posse**;
- **terminal reusando `record_commanded_work_terminal`**, validado por correlação de `execution_started` (emitido pelos dois caminhos) e não por origem, evitando duplicar a guarda do SUP-04 contra sinal tardio;
- **incerteza não vira conclusão** — executor que lança, transcrição fora do contrato do INT-01 ou terminal recusado deixam a tentativa **aberta e a posse retida** para o SUP-04, sem inventar desfecho;
- **desfecho máximo de uma volta em `review`** — nenhum caminho aceita, autoriza, integra ou aplica resultado (fronteira do INT-03 intacta).

**Riscos e limitações que sobrevivem à ratificação** (registrados, não resolvidos): `WorkHandoffV1` permanece **sem persistência** e o **AUTO-05 em retomada real continua não iniciado**, bloqueado por isso; não há execução contínua, e a `maxDuration = 1800 s` ocupa a conexão HTTP inteira, com cancelamento cooperativo quando o cliente desiste no meio; o achado do `taskFor()` do `LocalRunnerAdapter` — que costura arquivos reais do escopo excluído no prompt e induz o modelo a editá-los — é propriedade do INT-04, **candidato a item próprio**, e não foi alterado aqui; o modelo local em `apps/web/.env.local` foi trocado para `qwen2.5-coder:14b`, configuração local não versionada.

**Confirmações de segurança desta ratificação:** nenhum código funcional foi alterado; nenhuma migration foi tocada; `private.begin_work_attempt`, SUP-04 e SUP-05 permanecem idênticos; nenhum resultado foi aceito, autorizado, integrado ou aplicado; nenhum merge, push, deploy ou `db reset`.

**Consequência para a Fase E:** o laço está ratificado como o **mecanismo de execução da V0**. Ele é seguro contra órfãs por composição com o SUP-04, mas **não retoma** trabalho pausado enquanto o handoff estruturado não for persistido. A Fase E **permanece aberta** por uma única pendência nomeada — a retomada real do AUTO-05, bloqueada pela persistência de `WorkHandoffV1` (tarefa separada, com checkpoint humano).

### Ratificação da Etapa 2A — persistência de checkpoint (2026-07-26)

A revisão humana **aprovou, ratificou e encerrou** a Etapa 2A da persistência de handoff/checkpoint. Registro append-only: nenhuma seção anterior foi reescrita.

**Provas ambientais frescas (2026-07-26, base local limpa via `supabase db reset`):** todas as migrations aplicaram sem erro, incluindo as da Etapa 2A; pgTAP específico `work_checkpoint` **25/25**; **pgTAP total (`supabase test db`): 13 arquivos, 406 asserções, PASS**; core **424**, web **51** e `typecheck` limpos nos cinco workspaces. Verificado no banco real: o enum tem `checkpoint_recorded`; as RPCs, o índice e o validador existem; o cliente autenticado não consegue `INSERT` direto em `work_events` (`permission denied`); o `jsonb =` ignora a ordem das chaves; e `data.checkpoint = data.executor_signal.checkpoint` em todos os eventos.

**Corridas concorrentes reais medidas** (duas sessões psql; o detentor segura o lock do item enquanto o outro bloqueia): mesmo conteúdo e mesma sequência → o segundo bloqueou **3,029 s**, resultou em `replayed`, exatamente **um** evento, nenhuma exceção de índice não tipada; conteúdo diferente e mesma sequência → o segundo bloqueou **3,022 s**, recebeu a recusa tipada `checkpoint conflict at the same sequence` (`55000`), exatamente **um** evento e o payload vencedor íntegro.

**Decisões arquiteturais ratificadas nominalmente:**

- o evento **append-only `checkpoint_recorded`**, não-terminal e fora da matriz de estados — não muda estado, não conclui, não aceita, não autoriza e não integra;
- a RPC **`record_work_checkpoint`**, fail-closed e decidindo só por fato persistido;
- a reconstrução **`latest_work_checkpoint`** pelo maior `signal_sequence`, com ausência tipada;
- o **espelho puro no core** (`reconcileCheckpointDelivery`, `selectLatestCheckpoint`, `projectCheckpointContinuation`), sem derivar `status`/`stopReason` terminais;
- a **semântica de sequência** 1-indexada, monotônica não consecutiva: regressão e conflito falham fechados, replay idêntico não cria evento;
- a **estratégia de concorrência** por `FOR UPDATE` do item e índice único parcial `(attempt_id, signal_sequence)`, sem mutex em memória;
- a **proteção de autenticação, posse e allowlist**, agora simétrica com as demais RPCs de orquestração;
- as **correções de revisão dirigida** dos commits `02af23f` (guarda de allowlist em `latest_work_checkpoint`) e `4dff367` (correção do fixture de abandono e asserção de allowlist no pgTAP).

**Riscos aceitos que sobrevivem à ratificação** (registrados, não resolvidos): o `LocalRunnerAdapter` ainda emite **zero** checkpoints, então a persistência existe sem produtor; a qualidade do checkpoint depende da honestidade do executor; há uma pequena janela entre emitir e persistir um checkpoint; e a integração com o laço mais a retomada real do AUTO-05 permanecem **fora** da Etapa 2A.

**Consequência confirmada para a Etapa 2B:** `record_commanded_work_terminal` ainda exige `sequence == 1`; quando o terminal passar a vir **depois** de checkpoints (sequência > 1), essa guarda o recusará e precisará ser revisitada em 2B — sem tocá-la agora.

**Confirmações de segurança desta ratificação:** nenhum código funcional novo foi escrito; o laço operacional, o `LocalRunnerAdapter`, o runner, o AUTO-05 e o `planWorkResumption` permanecem intocados; nenhum resultado foi aceito, autorizado, integrado ou aplicado; nenhum merge, push ou deploy. As migrations e provas da Etapa 2A estão nos commits `ec060d5`, `b820af1`, `855ceeb`, `e0d591c`, `72a86ef`, `02af23f` e `4dff367`.

### Ratificação da Etapa 2B.1 — persistência de checkpoint em stream (2026-07-26)

A revisão humana **aprovou, ratificou e encerrou** a Etapa 2B.1. Registro append-only: nenhuma seção anterior foi reescrita. A consequência sobre o INT-04 antecipada na ratificação da Etapa 2A — a guarda `sequence == 1` do terminal comandado — foi resolvida aqui.

**Decisões e garantias ratificadas nominalmente:**

- `runExecutorStreamed` consome o stream do executor **incrementalmente**;
- cada `checkpoint` é persistido **imediatamente** ao ser recebido, e a confirmação da persistência ocorre **antes** de consumir o próximo sinal;
- `progress` continua **não persistido** e nunca é tratado como checkpoint;
- o terminal só é processado depois dos sinais anteriores; nada após o terminal é aceito;
- falha ao persistir um checkpoint interrompe o processamento **fail-closed**, sem processar terminal, sem liberar posse e sem inventar desfecho;
- checkpoints já confirmados **sobrevivem** a exceção do executor, ausência de terminal ou cancelamento da conexão;
- a tentativa permanece **aberta para reconciliação pelo SUP-04** quando não há terminal válido;
- `record_commanded_work_terminal` aceita terminal com `sequence` positivo e **posterior ao maior checkpoint persistido**; o banco **não** reconstrói `progress` não persistidos, e a continuidade completa da transcrição permanece do `validateWorkExecutorTranscript`;
- executores que emitem **zero checkpoints** continuam compatíveis;
- `LocalRunnerAdapter`, `BoundedWorkExecutorAdapter`, `terminalKinds`, a matriz de estados, INT-03, SUP-04, SUP-05 e `planWorkResumption` permanecem preservados; o desfecho máximo do laço continua sendo `review`;
- a persistência entra por uma **porta genérica** (`CheckpointSink`), sem acoplar o consumidor ao Supabase; o caminho comandado (INT-04) segue single-shot e rejeita checkpoint fail-closed.

**Evidências ratificadas:** `typecheck` limpo nos cinco workspaces; core **424/424**; web **62/62**; pgTAP específico `terminal_after_checkpoint` **9/9**; **pgTAP total com 415 asserções verdes**. **Prova real contra o Supabase local** com o laço `runSupervisorTurn` e um `FakeWorkExecutor` emitindo `progress 1 / checkpoint 2 / progress 3 / checkpoint 4 / result 5`: os eventos persistiram na ordem `execution_started → checkpoint_recorded → checkpoint_recorded → result_submitted → work_claim_released`, checkpoints com sequências **[2, 4]** e estado final **`review`**.

**Riscos aceitos que sobrevivem à ratificação:** o `LocalRunnerAdapter` ainda **não** produz checkpoints; a qualidade do checkpoint depende do executor; pode haver perda do sinal emitido antes da confirmação persistente; o caminho comandado continua single-shot enquanto o supervisionado tem a porta persistente; e a retomada real do AUTO-05 permanece **não implementada**.

**Confirmações de segurança desta ratificação:** nenhum código funcional novo foi escrito; o `LocalRunnerAdapter`, o runner, o AUTO-05 e o `planWorkResumption` permanecem intocados; `latest_work_checkpoint` **não** é lido pelo laço; nenhum resultado foi aceito, autorizado, integrado ou aplicado; nenhum merge, push ou deploy. As migrations, provas e mudanças da Etapa 2B.1 estão nos commits `fc76b76`, `e00e4aa`, `bce3eb2`, `e213754` e `643c8d8`.

### Ratificação da Etapa 2B.2 — retomada real após abandono (2026-07-28)

A revisão humana **aprovou, ratificou e encerrou** a Etapa 2B.2 — a retomada real do AUTO-05 a partir de uma tentativa abandonada pelo SUP-04. A implementação já estava no repositório quando a ratificação foi conduzida; a decisão humana foi **manter a implementação completa** (sem reduzir ao escopo mínimo da tarefa anterior, que estava desatualizada) e ratificá-la **condicionada à execução verde das provas de banco**, agora cumprida. Registro append-only: nenhuma seção anterior foi reescrita.

**O que a Etapa 2B.2 entrega.** `planWorkResumption` passou a receber a fonte discriminada `WorkResumptionSourceV1`, com dois ramos **semanticamente distintos**:

- `terminal_handoff` — o caminho anterior, preservado byte a byte: carrega um `WorkHandoffV1` **terminal** e um `InterruptionScenario` do Marco 003;
- `abandoned_checkpoint` — o caminho novo: uma projeção **apenas de fatos append-only** (`AbandonedCheckpointV1`), correlacionada a um evento `attempt_abandoned` real, que **preserva a razão técnica do abandono no vocabulário próprio** e **nunca** a converte em `InterruptionScenario`, `status` ou `stopReason`.

A costura da retomada no **Supervisor** (`apps/web/lib/work-orchestration/supervisor.ts`) lê a fonte por `abandoned_work_resumption_source`, chama `planWorkResumption` e, quando o plano autoriza, inicia a nova tentativa por `begin_resumed_work_attempt` — claim e início criados **atomicamente**, com identidades novas e `reason = 'resumed_execution'`. Ausência de checkpoint na fonte abandonada exige humano e **não** cai no início normal. O executor recebe `carriedContext` informativo (restante, próximo passo, riscos, recursos, falhas anteriores) que **não amplia permissão**.

**Decisões arquiteturais ratificadas nominalmente:**

- `WorkHandoffV1` permanece **exclusivamente terminal**; a Etapa 2B.2 não amplia nem enfraquece esse significado;
- `attempt_abandoned` permanece uma afirmação **mais fraca** que um terminal do executor, e a retomada a partir dele **não** fabrica cenário, `status` (`paused`/`timed_out`) nem `stopReason` (`time_limit_reached`);
- os três motivos técnicos persistidos — `lease_expired`, `duration_limit_exceeded`, `declared_bounds_exceeded` — permanecem **distinguíveis** e atravessam a retomada **literais**;
- a fonte abandonada carrega só fatos comprováveis (tentativa/claim de origem, versão aprovada, `seq` de checkpoint e abandono, `signal_sequence`, conteúdo do checkpoint, razão e instante);
- `begin_resumed_work_attempt` é a **fronteira atômica** que revalida estado `approved`, versão, evento de abandono, checkpoint e sua maximalidade, identidades novas e a exclusividade de alvo do SUP-05 antes de criar claim e tentativa;
- fail-closed diante de qualquer correlação ou fato obrigatório ausente; o plano é **determinístico**; os dois tipos de fonte **não** podem ser misturados.

**Provas de banco (2026-07-28, base local reutilizada — `supabase start`, sem `db reset`).** Docker Desktop iniciado; o volume local existente foi reaproveitado; a migration `20260727000000_begin_resumed_work_attempt.sql` já constava aplicada (maior versão aplicada = arquivo mais novo do repositório) e as duas RPCs — `abandoned_work_resumption_source` e `begin_resumed_work_attempt` — existem no banco. `supabase test db`: **16 arquivos, 447 asserções, Result: PASS**, incluindo `work_resumption.test.sql` (retomada a partir de `lease_expired`, com checkpoint obrigatório e correlacionado, IDs novos, terminal tardio recusado e ausência de aceite/integração), `supervisor_reconciliation.test.sql` (SUP-04, intocado), `commanded_target_exclusivity.test.sql`/`target_exclusivity.test.sql` (SUP-05, intocado) e o novo `work_resumption_reasons.test.sql`.

**Prova individual dos três motivos (novo `work_resumption_reasons.test.sql`, 18 asserções).** Cada motivo nasce da **reconciliação real** (SUP-04), não de um evento fabricado, e é provado ponta a ponta:

| Motivo | Como é produzido | O que a prova confirma |
|---|---|---|
| `lease_expired` | supervisionada, só o lease do claim vencido (sem `max_duration_minutes`) | fonte devolve `abandoned_checkpoint` com a razão **literal**; `begin_resumed_work_attempt` aceita; item em `in_progress`; `reason = resumed_execution` |
| `duration_limit_exceeded` | comandada **sem posse**, só `max_duration_minutes` vencido | idem, razão literal preservada |
| `declared_bounds_exceeded` | supervisionada com lease **e** duração vencidos juntos | idem, razão literal preservada |

Para os três, a fonte **não** carrega chave `scenario`, e seu texto não contém `time_limit_reached`, `timed_out` nem `paused` — a preservação é literal e sem conversão semântica.

**Provas de código no mesmo estado:** `packages/core` **432/432** em 19 suítes (inclui os três motivos no espelho puro `work-resumption.test.ts`); supervisor em `apps/web` **27/27** (inclui "tentativa abandonada retoma com IDs novos e carriedContext sem cenário inventado"); `typecheck` limpo nos cinco workspaces.

**Diferenciação explícita do que está e do que não está pronto:**

- **Retomada real implementada no Supervisor** — sim. O laço reconstrói a fonte abandonada, planeja e inicia a tentativa de retomada atomicamente, provado por pgTAP e pelos testes do supervisor.
- **Produtor real de checkpoints ausente no `LocalRunnerAdapter`** — o adaptador ainda emite **zero** checkpoints. Sem um executor que faça streaming de checkpoints reais, a retomada por `abandoned_checkpoint` só tem valor sobre checkpoints sintéticos/de fixture; a **retomada prática** de ponta a ponta com executor real permanece pendente.

**Riscos e limitações que sobrevivem à ratificação** (registrados, não resolvidos): o `LocalRunnerAdapter` não produz checkpoints; a qualidade do checkpoint depende da honestidade do executor; persiste a pequena janela entre emitir e persistir um checkpoint; o executor zumbi que o banco não mata continua um risco conceitual herdado do SUP-04; e a demonstração ao vivo de uma retomada real conduzida pelo executor local ainda **não** foi feita.

**Confirmações de segurança desta ratificação:** nenhuma alteração no `LocalRunnerAdapter` nem no runner; nenhuma migration nova (a migration da 2B.2 já estava no repositório e no banco); nenhuma execução foi disparada; nenhum resultado foi aceito, autorizado, integrado ou aplicado; `supabase db reset` **não** foi executado; nenhum merge, push ou deploy. As mudanças da Etapa 2B.2 estão nos commits `7bf9179` (contrato puro), `f72bfa5` (migration + pgTAP + tipos), `020db80` (costura no laço), `85178a4` (documentação), `4643115` (prova dos três motivos no espelho puro) e `fd787be` (prova dos três motivos no banco).

**Consequência para a Fase E:** a Etapa 2B.2 está ratificada como o **contrato e o planejamento verdadeiros da retomada**, costurados ao Supervisor. A Fase E **permanece aberta** por uma única pendência nomeada — um **produtor real de checkpoints** no `LocalRunnerAdapter` — sem a qual a retomada prática de ponta a ponta com executor real não pode ser demonstrada.

### Produção e consumo reais de checkpoints (2026-07-28) — pronto para revisão

**Não ratificado.** Registro append-only do estado alcançado, para o checkpoint humano. Fecha a pendência operacional nomeada da Fase E — o produtor real de checkpoints —, mas **não** registra ratificação: a Fase E segue aberta até a decisão humana.

**O que foi implementado.** O sinal `checkpoint` do INT-01 e a persistência da 2A/2B.1 já existiam; faltava um **produtor real** e a **transmissão** pelo adaptador.

- **Runner local** (repositório separado `anima-local-agent-poc`): emite um checkpoint mid-flight **após o planejamento e antes da edição**, no protocolo `ANIMA_CHECKPOINT_JSON=`. O `Plan` validado é projetado num subconjunto do `WorkCheckpointV1` (passos concluídos/restantes por templates fixos, próximo passo, validação `declared`, handoff opaco + sha256 de um artefato do plano) — **só fatos do plano**, sem prosa do modelo, cadeia de pensamento, `status`/`stopReason` terminais nem segredos. A linha é ancorada com `\n` para sobreviver ao prompt de aprovação. Na retomada, `--carried-context` injeta o contexto de continuação (restante, próximo passo, riscos, falhas anteriores) no planejador e no executor como preâmbulo `[RETOMADA]` — **apenas contexto, nunca instrução de domínio**; o motivo do abandono não chega por contrato. Ausência preserva o começo do zero.
- **`LocalRunnerAdapter`**: ganhou um caminho em **stream, opt-in por chamador**. Quando ligado, consome o stdout linha a linha, projeta cada `ANIMA_CHECKPOINT_JSON=` num sinal `checkpoint` (revalidado pela régua única `validateWorkCheckpoint` do core e restrito ao escopo aprovado) e o emite **antes do terminal** — nunca convertido em `progress` ou terminal —, para o laço persistir por `record_work_checkpoint`. Checkpoint mal-formado falha fechado como violação de contrato.
- **Preservação do INT-04:** a emissão é **opt-in** (`localRunnerFromEnvironment({ emitCheckpoints })`), ligada só na rota `supervisor-turn`. O caminho comandado (INT-04) não liga a flag e permanece **single-shot byte a byte**, honrando a fronteira ratificada em 2B.1 (comandado rejeita checkpoint). Nenhum contrato ratificado foi ampliado ou enfraquecido; nenhum fato novo é persistido além dos já existentes.

**Provas determinísticas (sem depender do modelo estocástico):**

- Runner (`anima-local-agent-poc`): suíte **99/99**, `mypy` limpo (17 arquivos), `compileall` ok. Cobrem a projeção do plano em checkpoint, a emissão antes do terminal no fluxo real com fake, a ausência sem a flag, a âncora de linha (o mock de `input` passou a ecoar o prompt), e a entrega/consumo do `carriedContext` no planejador e no executor sem fabricar cenário/status.
- `apps/web`: `local-runner` **10/10** (as 4 do single-shot comandado intactas + 5 novas de stream: checkpoint antes do terminal, ignorado sem a flag, mal-formado fail-closed, fora de escopo recusado, `carriedContext` repassado); supervisor **27/27**; web **68/68**.
- `packages/core` **432/432**; `typecheck` limpo nos 5 workspaces; pgTAP `supabase test db` **16 arquivos/447** PASS (inalterado — nenhuma migration tocada).

**Prova real com modelo local (`qwen2.5-coder:14b`, Ollama + Docker + Supabase local):**

- **Produção + transmissão** (adaptador real contra o runner real): o runner emitiu um `checkpoint` válido (`WorkCheckpointV1`, `validateWorkCheckpoint` = ok, sem vocabulário terminal) em `sequence=1`, **antes** do `result` em `sequence=2`.
- **Ciclo completo de ponta a ponta** contra o Supabase local, item `b6d38d8b-0fd7-4b13-bf95-1817386fcf19` (alvo isolado `cp-live`, tarefa de duas unidades verificáveis: `add` e `subtract`):

| seq | evento | fato |
|---|---|---|
| 2551 | `execution_started` | tentativa 1 `e1ca7da3…` |
| 2552 | `checkpoint_recorded` | checkpoint real persistido (`signal_sequence=1`) |
| 2553 | `work_claim_released` | `expired` |
| 2554 | `attempt_abandoned` | **SUP-04**, `declared_bounds_exceeded` |
| 2556–2557 | `work_started`/`execution_started` | tentativa 2 `c32dc0a2…`, `reason=resumed_execution`, `resumed_from=e1ca7da3…` |
| 2558 | `checkpoint_recorded` | checkpoint real da tentativa retomada |
| 2559 | `result_submitted` | `local-runner:cp-live:20260728T212802644731Z-result.zip:sha256:caa0f45a…307cc8` |
| 2560 | `work_claim_released` | `attempt_finished` |

Estado final **`review`**; **zero** `result_accepted`; a interrupção deixou a tentativa **aberta** (0 terminais) até o SUP-04. A workspace `cp-live` terminou **byte a byte intacta** (`git status` vazio; `calculator.py` ainda com os stubs `return 0`), preservando a garantia do INT-04.

**Diferenciação determinístico × real:** as garantias contratuais (produção, transmissão sem conversão, escopo, fail-closed, entrega/consumo do `carriedContext`, persistência, correlação da retomada) são provadas por **fixtures determinísticas**; a prova com modelo local demonstra o **fluxo real de ponta a ponta**, cujo desfecho de edição é estocástico e não é a base das garantias.

**Fora desta etapa (não resolvidos):** encerramento de executor zumbi; aceite/integração/merge automáticos; daemon/execução contínua; armazenamento de cadeia de pensamento; redesenho do runner; troca de modelo. As provas descartáveis não foram commitadas; a configuração local do usuário (`.env.local`, alvos) não foi alterada permanentemente.

**Confirmações de segurança:** nenhum contrato ratificado foi enfraquecido; nenhum fato novo persistido além dos existentes; caminho comandado (INT-04) intocado byte a byte; nenhum resultado foi aceito, integrado ou aplicado; nenhum merge, push ou deploy; `supabase db reset` não foi executado. Mudanças no runner nos commits `b7d17f9` e `5361101` (repositório `anima-local-agent-poc`); no monorepo, `cae9d92` (adaptador + costura + testes).

### Ratificação da produção e do consumo reais de checkpoints e conclusão da Fase E (2026-07-28)

O usuário **ratificou a implementação da produção e do consumo reais de checkpoints nos limites exatos demonstrados pelas provas**. A capacidade ratificada, em sua formulação vinculante, é:

> **“Checkpoint real pós-planejamento e retomada informada por contexto.”**

Este registro é append-only: preserva integralmente a seção anterior, que documentou o estado pronto para revisão, e acrescenta a decisão humana que faltava.

**O que foi implementado e ratificado.** O runner Python produz um `WorkCheckpointV1` real, válido e não terminal depois do planejamento validado e antes da edição. A emissão é opt-in e exclusiva do caminho supervisionado. O `LocalRunnerAdapter` transmite o checkpoint como sinal canônico, sem convertê-lo em progresso ou terminal; o laço o persiste por `record_work_checkpoint`, correlacionando item, tentativa, claim, versão e sequência. Depois de um `attempt_abandoned` registrado pelo SUP-04, o Supervisor inicia uma tentativa nova por `begin_resumed_work_attempt`; ela recebe `carriedContext` e realiza uma retomada informada por contexto. O resultado permanece limitado a `review`.

O caminho comandado ratificado do INT-04 continua sem checkpoints e fail-closed diante deles. Não existe aceite, integração, aplicação ou merge automáticos, e a workspace original continua protegida pelas garantias do INT-04.

**O que foi comprovado deterministicamente.**

- runner Python: **99 testes verdes**, `mypy` limpo em **17 arquivos** e `compileall` verde;
- `LocalRunnerAdapter`: **10/10**;
- Supervisor: **27/27**;
- `apps/web`: **68/68**;
- `packages/core`: **432/432**;
- `typecheck` limpo nos **cinco workspaces**;
- pgTAP: **16 arquivos, 447 asserções, PASS**.

**O que foi demonstrado na prova local real.** Com `qwen2.5-coder:14b`, o item `b6d38d8b-0fd7-4b13-bf95-1817386fcf19` percorreu a tentativa inicial `e1ca7da3…` e a tentativa retomada `c32dc0a2…`. Foram observados `execution_started`; `checkpoint_recorded` da primeira tentativa; `work_claim_released`; `attempt_abandoned` com `declared_bounds_exceeded`; `work_started` da retomada; `execution_started` com `reason=resumed_execution` e `resumed_from` correlacionado à tentativa anterior; `checkpoint_recorded` da retomada; `result_submitted`; e `work_claim_released` com `attempt_finished`.

As sequências relevantes foram 2551 (`execution_started`), 2552 (`checkpoint_recorded`), 2553 (`work_claim_released`), 2554 (`attempt_abandoned`), 2556–2557 (início da retomada), 2558 (`checkpoint_recorded` da retomada), 2559 (`result_submitted`) e 2560 (`work_claim_released`). O resultado referenciado preserva o hash iniciado em `caa0f45a` e terminado em `307cc8`. O estado final foi `review`, houve **zero** `result_accepted`, e a workspace original terminou com `git status` vazio e conteúdo original preservado.

**Limites preservados.** Esta ratificação não afirma restauração dos arquivos produzidos pela tentativa anterior nem de workspace parcialmente editada; continuação exata do estado interno do modelo; preservação ou armazenamento de cadeia de pensamento; que o planejamento sempre seja pulado numa retomada; checkpoints depois de cada unidade editada e testada; encerramento forçado de executor zumbi; comportamento determinístico do modelo local; aceite, integração, aplicação ou merge automáticos; execução contínua ou existência de daemon.

Permanecem separados como possíveis trabalhos futuros, sem integrar o aceite desta fase: checkpoints mais ricos após unidades editadas e testadas; transporte de `carriedContext` por stdin ou arquivo temporário restrito em vez de argumento de processo; tratamento de executor zumbi; retomada com estado material de workspace; execução contínua ou daemon; aceite, integração, aplicação ou merge automáticos.

**Conclusão formal.** A revisão do Plano 002 e do backlog confirma que a ratificação acima era a **última pendência canônica aberta da Fase E**. Os entregáveis, critérios e evidências obrigatórias da fase já estavam satisfeitos pelas ratificações anteriores e pelas provas determinísticas e real registradas; faltava apenas esta decisão humana. Por isso, a **Fase E está formalmente concluída em 2026-07-28, por ratificação do usuário**. Riscos residuais e melhorias futuras permanecem registrados, mas não reabrem a fase nem ampliam retroativamente seu aceite. A próxima fase elegível segundo este plano é a **Fase F — Uso sustentável de inteligência**, que não é iniciada por este registro.

## Fase F — Uso sustentável de inteligência

**Objetivo:** transformar em mecanismo a visão "leve para operar, médio para construir, forte para decidir": classificação de complexidade e risco, escolha inicial de executor, escalonamento após falhas, redução depois de plano consolidado, reserva de capacidade e rastreabilidade da decisão.

**Pré-requisitos:** Fase E operando; histórico de tentativas persistidas suficiente para calibrar.

**Entregáveis:** INTEL-01 a INTEL-04.

**Progresso do INTEL-01 (2026-07-28; implementado, aguardando ratificação).**
Três incrementos contratuais estão implementados: (1) taxonomia, proveniência,
validação e readiness puras da classificação V1; (2) persistência append-only,
reclassificação auditável e reconstrução vigente por versão aprovada; (3) gate
autoritativo da execução autônoma, composto com AUTO-01 na fila, na criação do
claim e no início sob claim. Classificação ausente ou com `unknown` impede
seleção, claim, tentativa e chamada ao executor, com razões tipadas e eixos
desconhecidos em ordem determinística. Uma nova versão aprovada exige
classificação própria. Proposta e aprovação não exigem classificação, e o
INT-04 comandado permanece fora do gate. Este registro não ratifica o INTEL-01,
não escolhe executor/provedor/modelo/esforço e não inicia o INTEL-02.

### Ratificação do INTEL-01 (2026-07-28) — classificação de trabalho

O usuário aprovou e ratificou o contrato apresentado do INTEL-01 ao declarar
confiança na recomendação técnica, depois de receber nominalmente as decisões
abaixo. Esta ratificação encerra o INTEL-01 sem ampliar seu escopo:

- os cinco eixos obrigatórios são complexidade, risco, reversibilidade, clareza
  do plano e urgência;
- `unknown` é um valor válido durante a classificação, mas impede readiness para
  execução autônoma;
- toda classificação registra proveniência humana ou sistêmica;
- reclassificação cria evento append-only e não sobrescreve versões anteriores;
- a classificação só vigora para a versão atual e aprovada da proposta;
- proposta e aprovação continuam possíveis sem classificação;
- seleção, claim e início autônomos exigem classificação vigente e completa;
- o INT-04 comandado pelo usuário permanece fora desse gate;
- nenhuma escolha de executor, provedor, modelo ou esforço pertence ao INTEL-01.

As evidências técnicas ratificadas são os três incrementos registrados acima:
contrato puro V1, persistência auditável e gate autoritativo composto com
AUTO-01 no core e no banco. A validação fresca anterior à decisão passou em
todos os cinco workspaces no `typecheck`, em 597 testes Jest, com 2 testes de
integração ignorados, e no build de produção do `apps/web`. A suíte pgTAP não
foi reexecutada neste checkpoint; permanecem como evidência as provas SQL
registradas na entrega.

**Conclusão formal naquele checkpoint:** o INTEL-01 foi encerrado por
ratificação humana e a Fase F passou a estar em andamento. O INTEL-02 ainda
não havia sido iniciado e exigiria checkpoint humano próprio para aprovar a
política inicial de roteamento.

### Ratificação do INTEL-02 (2026-07-28) — roteamento por política explícita

O usuário aprovou a política inicial depois de receber suas regras e limites,
respondendo “marcha”. A política V1 usa os níveis abstratos `light`,
`standard` e `strong`: somente trabalho rotineiro, de baixo risco, reversível
e com plano claro pode usar `light`; complexidade alta, risco alto/crítico,
irreversibilidade ou plano incerto exigem `strong`; os demais casos usam
`standard`. Urgência só desempata rotas equivalentes e nunca reduz a margem de
segurança. A política escolhe a rota disponível de menor esforço que satisfaça
a capacidade e o mínimo exigido; ausência de rota suficiente interrompe de
forma tipada, sem redução silenciosa.

O catálogo é genérico por capacidades e identificadores opacos, sem nomes de
fornecedores fixados na regra. A primeira configuração contém apenas o runner
local real; integrações externas fictícias não foram criadas. INTEL-03
(escalonamento/redução após histórico de tentativas) e INTEL-04
(orçamento/reserva) permanecem fora deste incremento.

Cada decisão é gravada antes do início como evento append-only
`work_routing_decided`, ligado ao item, à versão aprovada, à classificação
vigente e ao `attempt_id`. O fato contém política, esforço exigido, rota
selecionada, fatores e candidatos rejeitados; a RPC
`work_routing_decision` o torna consultável por tentativa. Uma guarda no banco
impede o início autônomo sem decisão correspondente ou com executor diferente
do selecionado. A retomada permite esse único fato anterior ao início, sem
afrouxar a recusa de reutilização de identificadores.

**Evidência técnica:** 12 cenários puros reproduzem a política; a integração do
Supervisor comprova seleção, persistência anterior à posse e uso do adaptador
escolhido; 20 provas pgTAP cobrem validação, consulta, idempotência,
concorrência e enforcement. A regressão completa passou em 19 arquivos e 522
testes SQL, 609 testes Jest (com 2 integrações ignoradas), `typecheck` dos cinco
workspaces e build de produção do web.

**Conclusão formal:** o checkpoint humano da política inicial e os critérios de
aceite do INTEL-02 estão satisfeitos. O INTEL-02 está encerrado; a próxima
dependência da Fase F é o INTEL-03.

### Conclusão do INTEL-03 (2026-07-28) — ajuste entre tentativas

A política `work-routing-adjustment-v1` usa exclusivamente fatos persistidos da
mesma versão aprovada. Duas falhas consecutivas (`execution_failed` ou
`attempt_abandoned`) elevam exatamente um nível: `light → standard` ou
`standard → strong`; `strong` nunca é ultrapassado. Resultado submetido ou
cancelamento quebra a sequência. Depois de uma tentativa escalada, um
checkpoint correlacionado com próximo passo e trabalho restante, sem falhas,
permite voltar ao baseline da classificação — nunca abaixo dele.

Cada tentativa recebe antes da decisão de rota o evento append-only
`work_routing_adjusted`, inclusive quando o resultado é `none`. O fato registra
baseline, esforço efetivo, quantidade de falhas, IDs das tentativas usadas como
evidência e razão fechada. O banco reconstrói o histórico, exclui o caminho
comandado do INT-04, recalcula a decisão e recusa divergência. Dois gates
impedem tanto gravar uma rota com esforço diferente do ajuste quanto iniciar
sem ajuste/rota correspondentes. Retomadas aceitam esses dois fatos prévios,
sem liberar qualquer outro reaproveitamento de `attempt_id`.

A redução não infere que uma etapa é “mecânica” a partir de prosa livre: exige
o checkpoint estruturado. Ausência de rota no esforço escalado interrompe de
forma tipada; não há downgrade silencioso. O limite de tentativas do AUTO-05
continua soberano e impede o início; orçamento permanece exclusivamente no
INTEL-04.

**Evidência técnica:** 10 cenários puros cobrem escalonamento, teto, quebra de
sequência e redução; o Supervisor prova o ajuste antes do claim; a prova SQL
executa duas falhas e verifica a terceira tentativa escalada com razões e IDs
persistidos. Passaram 20 arquivos/532 testes pgTAP, 621 testes Jest (2
integrações ignoradas), `typecheck` dos cinco workspaces e build de produção.

**Conclusão formal:** os critérios do INTEL-03 estão satisfeitos sem checkpoint
humano adicional. O próximo item é o INTEL-04, cujo orçamento padrão exige
decisão humana antes da implementação.

### Conclusão do INTEL-04 e da Fase F (2026-07-28) — orçamento e reserva

O usuário aprovou os padrões recomendados e autorizou a implementação: no
máximo 3 tentativas autônomas por item em 24 horas, respeitando qualquer limite
declarado menor; 6 tentativas e 120 minutos autônomos por usuário em 24 horas;
e no máximo 45 minutos autônomos em cada janela móvel de 60 minutos, preservando
15 minutos para uso interativo. O V0 mede tentativas e tempo; tokens e dinheiro
continuam fora do escopo.

A política pura devolve quatro razões fechadas:
`item_attempt_budget_exhausted`, `user_attempt_budget_exhausted`,
`user_runtime_budget_exhausted` e `interactive_reserve_protected`. O banco
reconstrói consumo a partir do log append-only, incluindo o tempo de tentativas
abertas, e serializa admissões por usuário. Uma guarda em
`execution_started` impede que concorrência ultrapasse os tetos. Somente
tentativas com `claim_id` entram na contabilidade; o caminho comandado continua
fora do orçamento autônomo.

O Supervisor consulta o orçamento antes do roteamento e não toma posse quando
não há capacidade; materializa o bloqueio humano para retirar o item esgotado
da cabeça da fila. Depois de cada checkpoint persistido, verifica os limites de
tempo. Ao atingi-los, registra `input_requested` e `work_blocked` com razão,
limite e referência exata do checkpoint, move o item para `blocked`, libera o
claim e não consome nem inventa terminal. Assim a retomada automática para e o
trabalho aguarda decisão humana.

**Evidência técnica:** 8 cenários puros, 2 cenários do Supervisor e 15 provas
pgTAP específicas. A regressão completa passou em 21 arquivos/547 testes SQL,
631 testes Jest (2 integrações ignoradas), `typecheck` dos cinco workspaces e
build de produção do web.

**Conclusão formal:** o checkpoint humano do INTEL-04 e seus critérios de
aceite estão satisfeitos. Como INTEL-01 a INTEL-04 estão concluídos, a
**Fase F — Uso sustentável de inteligência está formalmente concluída em
2026-07-28**. A próxima fase canônica é a Fase G — Experiência no chat.

**Critérios de aceite:** toda seleção de executor/modelo/esforço é registrada com os fatores considerados; escalonamento acontece por regra explícita após falhas; existe reserva de capacidade que impede o modo autônomo de esgotar o provedor do usuário.

**Evidências obrigatórias:** decisões de roteamento consultáveis por tentativa; cenários de escalonamento e redução testados.

**Riscos:** otimização prematura; regras opacas que o usuário não consegue auditar.

**Fora do escopo:** aprendizado automático de política; leilão entre provedores; otimização de custo por token como objetivo primário.

## Fase G — Experiência no chat

**Objetivo:** projetar o Modo Autônomo na conversa: cartões de execução com progresso, checkpoint, decisão necessária e resultado para revisão, com ações de aprovar, pedir alterações, pausar e cancelar — mantendo o chat como entrada única.

**Pré-requisitos:** Fases D–E (há o que exibir); pode começar em paralelo com E para o subconjunto da Fase D.

**Entregáveis:** UX-01 a UX-04.

**Critérios de aceite:** o usuário acompanha e decide tudo pela conversa; cada cartão é projeção do estado persistido (nunca estado próprio); decisões apontam para a versão exata apresentada; histórico permite retomar um trabalho antigo pelo chat.

**Evidências obrigatórias:** testes de componente; ciclo ao vivo conduzido inteiramente pelo chat.

**Riscos:** cartão virar formulário; UI inventar estado; excesso de notificação quebrando o princípio de interrupção mínima.

**Fora do escopo:** telas dedicadas de gerenciamento; dashboards; notificações push.

### UX-00 pronto para revisão (2026-07-29) — intenção natural para proposta persistida

O teste real do UX-01 revelou uma lacuna anterior ao cartão de execução: pedidos
como “analise os Planos 003 a 006 e me apresente a proposta antes de começar”
caíam em conversa livre. O modelo então afirmava ter lido os arquivos e imitava
propostas e cartões em texto, sem `work_item`, versão ou autorização persistidos.

O diagnóstico encontrou duas causas concretas: o classificador determinístico
não reconhecia verbos de análise/síntese nem objetos documentais, e
`orchestration_not_enabled` era descartado silenciosamente pela rota do chat. O
incremento UX-00 amplia de forma conservadora o vocabulário de intenção,
preserva conversas pessoais e perguntas comuns, cria uma proposta
**planning-first** sem inventar nó, alvo, arquivo, permissão ou limite, e expõe
capacidade ausente como sinal tipado.

A primeira prova real criou e reconstruiu o cartão persistido, mas mostrou que o
modelo local ignorava instruções e ainda alegava falsamente ter produzido o
resultado. A correção final não depende de prompt: quando uma proposta real é
criada — ou quando a capacidade está ausente — a resposta curta é determinada
pelo servidor e o Ollama não é chamado para narrar um resultado inexistente.
Conversa comum continua usando o modelo normalmente.

**Evidências:** 551 testes do core; 104 testes web; typecheck limpo nos cinco
workspaces; build web; prova autenticada com o modelo e Supabase locais. O item
`56a74a19-c524-46c4-b18e-363113df7da7` permaneceu `proposed`, versão 1, somente
com `work_proposed` e `context_attached`; o cartão e a resposta “Ainda não li
nem executei o trabalho” sobreviveram ao refresh.

**Limite preservado:** UX-00 termina numa proposta segura de planejamento. Ele
não resolve sozinho um nó local, não fabrica `execution_spec` e não torna o
item elegível ao Supervisor. A estruturação automática de alvo, permissões,
validações e limites depende dos contratos de nós locais e permanece trabalho
posterior. O UX-01 continua aguardando uma demonstração autônoma real de
pausa/cancelamento.

### UX-01 pronto para revisão (2026-07-29) — cartão de execução

**Não ratificado.** Registro append-only do estado alcançado, para o checkpoint humano. Nenhuma seção anterior foi reescrita.

**O que foi implementado (web).** Um cartão conversacional de execução autônoma que é **exclusivamente projeção do estado persistido** e permite acompanhar a tentativa e pedir pausa/cancelamento reais.

- **Projeção pura (`packages/core`, `projectAutonomousExecution`)** reconstrói do log: estado da tentativa, executor/provedor/modelo/esforço (de `work_routing_decided`, com fallback ao `execution_started`), início, limites declarados, checkpoint persistido mais recente, pedido de controle pendente, resultado aplicado da pausa/cancelamento e bloqueio por orçamento. Ausência de tentativa autônoma (ou execução comandada sem claim) resulta em cartão ausente. É integrada ao `WorkPresentation` e flui pela reconstrução fail-closed existente.
- **Controle cooperativo, aplicado só em checkpoint seguro.** `request_work_control` persiste a intenção do usuário (`work_control_requested`) sem mudar estado nem matar execução. O laço do Supervisor, após persistir cada checkpoint e **antes** do gate de orçamento, chama `apply_work_control_at_checkpoint`, que — espelhando o `interrupt_work_on_budget` do INTEL-04 — move o item para `blocked` (pausa) ou `cancelled` (cancelamento), grava `work_paused`/`work_cancelled` e libera o claim com `attempt_finished`. Nenhum terminal do executor é consumido depois disso.
- **Orçamento para de contar** após a pausa: `autonomous_work_budget_usage` passou a encerrar a janela da tentativa também em `work_paused`.
- **Cartão web** (`WorkExecutionCard`) renderiza a projeção e oferece Pausar/Cancelar (com confirmação de cancelamento); as ações vêm de `canRequestControl`, derivado do estado persistido — o cliente não inventa nada. Versão obsoleta/erro forçam reprojeção a partir do estado vigente.
- **Contratos ratificados preservados:** o terminal comandado (INT-04) já recusa sinal tardio pela guarda de estado (item deixa de estar `in_progress`), então nenhuma RPC ratificada foi alterada. A execução comandada permanece fora do controle cooperativo (sem claim).

**Decisões que pedem atenção na revisão:**

- extensão de `autonomous_work_budget_usage` (INTEL-04, ratificado) para encerrar a contagem em `work_paused` — aditiva, sem alterar o comportamento de fluxos existentes (regressão `work_budget` 15/15 verde);
- os três rascunhos de migration foram **auditados e finalizados**: `current_work_control_request` foi removido (a projeção já cobre o pedido pendente por eventos), guardas de allowlist e de versão nula foram adicionadas, e a ordem de `apply` passou a checar o pedido pendente antes de exigir checkpoint;
- a matriz normativa ganhou uma única linha nova (`in_progress → work_paused → blocked`); o cancelamento reaproveita `in_progress → work_cancelled → cancelled`, já existente.

**Evidências (verdes):** `packages/core` 551 testes (inclui 13 do cartão); `apps/web` 87 (inclui `WorkExecutionCard` e 3 novos do laço); mobile 12; `supabase` 7 (2 integrações ignoradas); **pgTAP `work_control` 20/20 e regressão de 22 arquivos sem falha, contra o Supabase local com as RPCs reais**; `typecheck` limpo nos cinco workspaces; build de produção do `apps/web` com a rota `/api/work-orchestration/control` registrada.

**Ratificação ao vivo (2026-07-29):** demonstração de ponta a ponta concluída
na conta local descartável, pelo cartão real do chat. O trabalho explicitamente
selecionado entrou em `in_progress`, exibiu executor, modelo, limites e os
controles. O pedido de pausa foi persistido enquanto o Ollama executava; no
checkpoint #1, o Supervisor aplicou a pausa, moveu o item para `blocked`,
registrou `work_paused` e preservou quatro passos restantes. Após recarregar a
página, o cartão reconstruiu “Pausada por você” e o mesmo checkpoint somente a
partir do estado persistido. O alvo original permaneceu intacto porque o runner
operou em workspace isolada. A preparação também revelou e corrigiu no ambiente
de prova um alvo descartável com metadados Git incompletos; a primeira tentativa
falhou fechada antes de qualquer checkpoint.

**Nota de ambiente:** os três rascunhos já tinham sido aplicados ao banco local pela sessão anterior. Como as versões finalizadas diferem e `db reset` é proibido sem checkpoint, o banco local foi sincronizado manualmente às funções finalizadas (só código de função/uma linha de transição; nenhum dado tocado). Um ambiente novo aplica os arquivos 17/18/19 do zero corretamente.

**Fora desta entrega (não iniciados):** UX-02 (cartão de decisão necessária), UX-03 (cartão de resultado autônomo), UX-04 (histórico/retomada pelo chat) e a paridade mobile do cartão.

### UX-02 pronto para revisão (2026-07-29) — decisão necessária

**Não ratificado.** O fluxo foi implementado e validado automaticamente; ainda falta uma interrupção real no chat para o checkpoint humano.

- O contrato `decision_required` exige razão fechada, explicação e ao menos duas alternativas distintas, cada uma com efeito `resume` ou `cancel`.
- A interrupção só é persistida depois de um checkpoint seguro. O banco bloqueia o trabalho, grava `input_requested` e `work_blocked`, preserva o sinal integral e libera o claim.
- A projeção compartilhada reconstrói exclusivamente o pedido ainda não respondido. Web e mobile exibem as alternativas persistidas e não oferecem a retomada genérica enquanto a decisão estiver pendente.
- A resposta referencia o evento e a versão exatos. Uma alternativa não apresentada ou uma versão obsoleta é recusada. `resume` devolve o item à fila `approved`, de onde uma nova tentativa pode usar o checkpoint; `cancel` encerra em `cancelled`.
- O Supervisor trata `decision_required` numa fronteira própria e não o envia ao registrador de resultado/erro/cancelamento.

**Evidências verdes:** core 561 testes; web 118 testes; mobile 12; pgTAP UX-02 10/10; typecheck dos cinco workspaces; build de produção web. As oito razões da política AUTO-06 possuem cobertura de projeção e apresentação.

**Falta para ratificar:** provocar uma interrupção real do executor, confirmar que o cartão sobrevive ao refresh e testar uma escolha de retomada ou encerramento no chat.

### UX-02 ponta a ponta (2026-07-29) — correção da implementação parcial

O checkpoint anterior desta seção comprovava a emissão e a resposta ao cartão, mas não o ciclo completo. A auditoria posterior encontrou duas lacunas: o evento `input_requested` não preservava um `InputRequestedPayloadV1` com `source_state` e `WorkHandoffV1` completos; além disso, `resume` somente retornava o item a `approved`, sem uma fonte persistida que permitisse ao Supervisor abrir a tentativa seguinte pelo checkpoint.

- O mesmo vocabulário `decision_required`/`InputRequestedPayloadV1` foi mantido e refinado com alternativas e handoff; não foi criado um protocolo paralelo.
- O alvo determinístico `ux02-deterministic-decision`, habilitado apenas por configuração explícita de prova, emite progresso, checkpoint conhecido e decisão estruturada e suspende o executor sem chamar modelo.
- O pedido, o checkpoint e o handoff pausado são persistidos juntos. A projeção do cartão e a fonte de retomada consultam somente eventos do banco, portanto sobrevivem a refresh e reinício do processo web.
- “Continuar” persiste `input_provided`, abre uma nova claim/tentativa ligada ao evento de pergunta e resposta e entrega ao executor o checkpoint no `carriedContext`; o cenário determinístico só produz resultado depois de receber esse contexto.
- “Encerrar” persiste `work_cancelled` e deixa o item em `cancelled`. Repetições iguais não duplicam eventos; respostas divergentes, tardias ou dirigidas a trabalho terminal são recusadas.

**Evidências verdes:** pgTAP 26/26 cobrindo os ramos de retomada e cancelamento contra o Supabase local real; core 563; web 123; mobile 12; typecheck dos cinco workspaces; build web. A prova automatizada também confirma reconstrução do cartão a partir do `input_requested`, nova tentativa com referência exata ao pedido/resposta e resultado terminal somente depois do checkpoint retomado.

**Falta para ratificar:** executar o cenário determinístico no chat real, recarregar a página enquanto o cartão estiver pendente e escolher um dos dois ramos. A frase de teste só deve ser fornecida depois de o ambiente de prova estar preparado.

### UX-02 prova autoprovável (2026-07-29) — provisionamento próprio, sem conta pessoal

A prova determinística passou a provisionar todo o estado sozinha, fechando duas lacunas do roteiro manual anterior: o item era criado sob a conta pessoal e ficava **sem a classificação necessária**, então nunca era selecionável pela fila autônoma.

As duas camadas de prova são **formalmente distintas** e têm status diferentes:

**Camada 1 — prova determinística de domínio/banco (EXECUTADA).**
- **`supabase/tests/ux02_deterministic_proof.test.sql`** (pgTAP, padrão canônico BEGIN/ROLLBACK): cria uma conta descartável `@test.invalid` própria, allowlista, e percorre o caminho **real de RPCs** — `create_work_proposal`, `resolve_approval`, `record_work_intelligence_classification`, claim, roteamento, tentativa e checkpoint — até `record_work_decision_required` e a resposta humana (ramo A retoma até `review`; ramo B encerra em `cancelled`). Prova explicitamente que, **antes** da classificação, `select_autonomous_work` não oferece o item, e que **depois** dela passa a oferecer — cobrindo a lacuna original. Nenhuma conta pessoal é usada e nada persiste (ROLLBACK). **Ressalva:** a prova insere a intenção/proposta *equivalente* à da frase; ela **não** invoca `configureUx02DeterministicProof`.
- **`apps/web/lib/work-orchestration/execution-environment.test.ts`**: prova o **gatilho da frase** pela função real (`configureUx02DeterministicProof` só configura com a flag e a frase exata) e a **ponte de elegibilidade** — a frase produz um `execution_spec` que o predicado do AUTO-01 aceita. É a fonte da verdade da forma que o pgTAP reproduz em JSON.

**Camada 2 — prova integrada do chat e da interface** (à época pendente; **ratificada em 2026-07-30**, ver subseção seguinte).
Enviar a frase no chat Next.js real, ver o cartão de decisão, **recarregar a página** com o cartão pendente e clicar em continuar/encerrar. Depende do dev server + Ollama + navegador. As garantias determinísticas (Camada 1) não dependem dela.

**Evidências verdes da Camada 1 (executadas 2026-07-29):** pgTAP `ux02_deterministic_proof` 36/36 contra o Supabase local real; suíte pgTAP completa 25 arquivos / 629 testes PASS; web 127/127; typecheck `apps/web`. A frase determinística exata e o cenário fechado `ux02-deterministic-decision` foram preservados intactos.

### UX-02 ratificado — funcional completo (2026-07-30)

Registro **factual** de ratificação do UX-02 funcional com base nas Camadas 1 e 2. Nenhum código de produção, contrato ou teste foi alterado para esta prova; **o commit funcional ratificado é `8d3ba73`, sem novas mudanças de código**.

**Significado preciso da ratificação:**

1. **O UX-02 funcional está ratificado dentro do desenho atual** — Camada 1 (domínio/banco) ratificada e automatizada; Camada 2 (chat/interface) ratificada por prova integrada.
2. A **Camada 2 foi uma prova integrada assistida**, executada no navegador real dirigido passo a passo — **não** um harness E2E totalmente automático de comando único.
3. A **classificação foi provisionada pela RPC real** (`record_work_intelligence_classification`) porque **não existe atualmente um caminho no chat ou na interface que produza a classificação INTEL-01**.
4. Essa ausência **não é um defeito do UX-02**; fica documentada como **limitação externa do fluxo** (a classificação INTEL-01 ainda não tem gatilho conversacional).
5. **Fora desta ratificação:** `review → completed` (aceite do resultado), concorrência multi-sessão e execução estocástica (modelo real).

**Fatos da prova:**

- **Data da ratificação:** 2026-07-30.
- **Branch/commit testados:** `codex/ux-00-natural-proposal` (= `codex/ux-02-prova-autoprovavel`), commit **`8d3ba73`**.
- **Usuários descartáveis (`@test.invalid`, criados na sessão):** A `ux02-proof-a-20260730150741@test.invalid`; B `ux02-proof-b-20260730151519@test.invalid`.
- **Itens e estados finais:** A `13358f9d-afc7-4051-bf87-0ea69e4c4937` → **`review`** (fluxo "continuar", com retomada correlacionada e resultado terminal, sem integração automática); B `0e6453a0-e9bb-46d9-b0d4-bd9fff40e1cc` → **`cancelled`** (fluxo "encerrar", sem retomada, resultado ou integração).
- **Frase → função real:** os dois itens nasceram `capability=programming` + `execution_spec.target=ux02-deterministic-decision` pela rota `/api/ai/chat`, forma que só `configureUx02DeterministicProof` produz sob a flag.
- **Reload confirmado:** em ambos os cenários, o cartão de decisão foi reconstruído a partir dos eventos persistidos e reexibido idêntico após recarga completa da página.
- **Sem conta pessoal:** ambos os itens pertencem a contas `@test.invalid`; `tecopfefer@gmail.com` não foi utilizado.
- **Sem mudança de código para a prova passar:** `git status` só mostrava `.worktrees/`; `HEAD` permaneceu `8d3ba73`; a configuração determinística veio de um overlay de ambiente temporário e gitignored, removido ao final.

### UX-03 pronto para revisão (2026-07-31) — cartão de resultado autônomo

**Não ratificado.** Registro append-only do estado alcançado, para o checkpoint humano. Nenhuma seção anterior foi reescrita. Branch dedicada `claude/ux-03-autonomous-result-card` a partir de `ce57eab`; sem push, PR, merge ou alteração de `main`.

**Definição canônica (backlog UX-03):** cartão de resultado com resumo, evidências tipadas, **referência de handoff** e ações de **aprovar** e **pedir alterações**; **reutilizar o fluxo de revisão existente, estendido para a tentativa autônoma**; integração continua etapa separada (INT-03); risco explícito de duplicar o fluxo em vez de estendê-lo.

**Achado central (diagnóstico):** o fluxo de revisão de resultado **já existia genérico** desde o ciclo manual F5 — projeção pura (`projectLatestWorkResult`/`availableWorkActions`), RPC `review_work_result_versioned` (aceite/pedir alterações referenciando o **evento de resultado exato** + versão; `55000` em conflito), rota `/api/work-orchestration/reviews` e a UI embutida no `WorkProposalCard`. Por ser **origin-agnóstico**, já cobria mecanicamente resultados autônomos. O UX-03 foi entregue **estendendo** esse fluxo, sem duplicá-lo nem criar cartão paralelo.

**O que foi implementado (mínimo, aditivo):**
- **Core:** `WorkResultProjection` ganhou `handoffReference`; `projectLatestWorkResult` passa a ler `data.handoff_reference` (null quando ausente/malformado). O terminal do executor já persistia a referência, mas ela **nunca era projetada** — exigência explícita do cartão do UX-03. `projectAcceptedWorkResult` herda o campo.
- **Web:** o cartão de resultado exibe a **referência de handoff** (ou declara a ausência). Nada é inventado no cliente; o resto do fluxo (aceite/pedir alterações) já existia.
- **Escopo preservado:** `completed` = resultado aceito, **nunca** integração; nenhum botão de merge/publicação; `changes_requested` mantém o item aberto (`changes_requested → work_started → in_progress`) sem perder histórico; as duas decisões seguem o enum ratificado `work_review_decision = {accept, request_changes}`.

**Decisão sobre "rejeitar" (humana, 2026-07-31 — não é divergência em aberto):** a redação original do backlog mencionava uma terceira ação ("aprovar, pedir alterações **ou rejeitar**"). Essa menção fica **superada** pelo contrato vigente `work_review_decision = {accept, request_changes}`. Decisão arquitetural: `accept` = resultado aceito, o item pode ir a `completed`; `request_changes` = resultado não aceito, o item permanece aberto para um novo ciclo. **Não** se cria agora evento ou estado adicional de rejeição de resultado, pois sua semântica não está definida no domínio ratificado. **Rejeitar definitivamente ou cancelar um trabalho é uma decisão distinta da revisão de um resultado** e não deve ser introduzida implicitamente no UX-03.

**Evidências verdes (2026-07-31):**
- **Camada 1 — domínio/banco (automatizada):** `supabase/tests/ux03_autonomous_result_review.test.sql`, pgTAP determinístico autoprovável **41/41** contra o Supabase local real. Leva o item a `review` pelo **terminal real do executor** (`record_commanded_work_terminal`, `origin=executor`) e exercita `review_work_result_versioned` nos dois ramos — aceitar (`review → completed`, aceite aponta o evento de resultado exato, `completed ≠ integrated`) e pedir alterações (`review → changes_requested`, texto obrigatório, histórico preservado) — com guardas de isolamento por usuário, idempotência/versão. Contas descartáveis `@test.invalid`, `BEGIN/ROLLBACK` (nada persiste). Suíte pgTAP completa **26 arquivos / 670 testes** sem falha. Testes de componente e projeção: web **130**, core **567**, mobile **12**; `typecheck` limpo nos cinco workspaces.
- **Camada 2 — integrada, navegador real (2026-07-31):** conta descartável `ux03-web-a@test.invalid` provisionada e allowlistada; pela interface real, a frase determinística criou a proposta (`target=ux02-deterministic-decision`). **Aprovação e classificação INTEL-01 foram etapas de provisionamento executadas por RPC** — a classificação pela mesma **limitação externa** já documentada no UX-02 (não há gatilho conversacional que a produza); a aprovação por conveniência da prova, já sendo o aceite manual coberto por UX-00/UX-01. A partir daí, **a superfície específica do UX-03 foi exercitada pela interface real**: a execução autônoma parou em `decision_required`, "Continuar do checkpoint" retomou, o **terminal autônomo produziu o resultado** (→ `review`) e o **cartão de resultado** foi exibido com resumo, autoria `executor`, referências, validações tipadas e a **referência de handoff `ux02-proof:completed`**. **Aceitar resultado** levou o item a `completed` referenciando o evento de resultado autônomo exato (sem integração automática); em item irmão, **Pedir correções** (texto obrigatório) levou a `changes_requested` preservando o resultado no histórico. Ambas as decisões refletiram no chat sem refresh manual e sobreviveram à recarga. Os dados descartáveis foram **verificados e removidos** por identificação exata (cascade do usuário `7482baae…`); **os registros, contagens e dados protegidos verificados retornaram ao baseline observado** (6 usuários / 10 itens / 75 eventos / 34 conversas; `tecopfefer@gmail.com` intacto) — não houve comparação binária do banco.

**Fora desta entrega (não iniciados):** UX-04 (histórico/retomada pelo chat) e a paridade mobile do cartão de resultado (o `presentMobileWorkResult` já projeta o resultado, mas sem ações de revisão). Ratificação final é do humano.

### UX-04 pronto para revisão (2026-07-31) — histórico e retomada pelo chat

**Não ratificado.** Registro append-only do estado alcançado, para o checkpoint humano. Nenhuma seção anterior foi reescrita. Branch dedicada `claude/ux-04-chat-history-resumption` a partir de `0a7837a` (UX-03 ratificado); sem push, PR, merge ou alteração de `main`.

**Definição canônica (backlog UX-04):** pela conversa, listar trabalhos ativos/pausados/aguardando decisão, trazer um ao foco e retomar do último checkpoint. Escopo: consulta + retomada conversacional. Fora: dashboard, busca avançada, timeline visual.

**Lacuna real (diagnóstico):** a hidratação do chat reconstrói cartões **apenas da sessão de conversa ativa** (`items/by-source` por mensagem). Ao arquivar uma conversa (`conversation_sessions.archived_at`) e abrir outra, o trabalho aberto da anterior fica **invisível/inalcançável** — exatamente o problema do UX-04. Não havia endpoint/RPC que listasse os itens do usuário nem gatilho conversacional para reencontrá-los. O caminho `isWorkContinuation` já buscava itens abertos entre sessões, mas não renderizava cartão.

**O que foi implementado (mínimo, estendendo o existente):**
- **Core:** `RESUMABLE_WORK_STATES` (fonte única dos estados não terminais) e `isWorkHistoryQuery` — intenção determinística e fail-closed de reencontrar/listar o próprio trabalho aberto, distinta de `isWorkContinuation`.
- **Repo/Service:** `findResumableWorkItems()` — itens não terminais do usuário, isolados por **RLS** (`auth.uid()=user_id`), em ordem determinística (`updated_at` desc, `id` desc). Espelha `findItemsBySourceMessageId`.
- **Backend:** `GET /api/work-orchestration/items` lista os itens como a **mesma projeção reconstruída** dos cartões (`serializeReconstructedWorkPresentation`) — fonte persistida e autoritativa.
- **Chat route:** intenção `work_history` (avaliada **antes** da continuação) devolve as `presentations`; resposta ditada pelo servidor (Ollama não é chamado), com variante honesta para lista vazia.
- **ChatClient:** renderiza a lista reencontrada como cartões `WorkProposalCard`, reusando **todas** as ações (focar, retomar, decidir, revisar). Nada é inventado no cliente.

**Garantias preservadas (pela projeção existente, reutilizada):** estados terminais/decididos/aceitos reaparecem só como histórico, sem ação repetível; a lista exclui os terminais; retomada referencia o item/versão/evento corretos. Nenhum evento/estado/RPC de domínio novo; nenhuma integração externa; retomada continua separada de integração.

**Evidências verdes (2026-07-31):**
- **Automatizadas:** core interpret (classificador + estados), web ChatClient (lista reencontrada acionável, item terminal só histórico, lista vazia). `typecheck` limpo nos cinco workspaces; **core 588, web 132, mobile 12**. Sem alteração de schema — nenhuma migration/pgTAP nova; o isolamento da lista repousa na política RLS `SELECT` já existente de `work_items` (`auth.uid()=user_id`), confirmada no banco.
- **Prova integrada (API real, 2026-07-31):** exercida contra os **endpoints reais do Next.js** com uma conta descartável autenticada. **Nota de método:** nesta sessão a automação do navegador não conseguiu dirigir os inputs controlados do React nem submeter os formulários de auth; portanto a sessão foi obtida via GoTrue e as etapas foram dirigidas por **HTTP autenticado contra os mesmos endpoints que a UI chama** (a renderização da lista em si está coberta pelo teste de componente do `ChatClient`). Onboarding, aprovação, início manual, envio de resultado e classificação foram **provisionamento**; a **superfície do UX-04** — arquivar a conversa, reencontrar o trabalho aberto em nova conversa e retomar — foi exercitada pelos endpoints reais. Fluxo: (1) dois itens criados pela rota real `/api/ai/chat` na conversa #1 e levados a `review` e `changes_requested`; (2) conversa #1 **arquivada** (`archive_current_conversation`), abrindo a #2; (3) na #2, `GET /api/work-orchestration/items` **reconstruiu os dois itens do histórico persistido através da sessão arquivada**, com estados e ações corretos; a rota `/api/ai/chat` com "quais trabalhos tenho em aberto?" devolveu `kind:work_history` com 2 cartões e resposta ditada pelo servidor; (4) **retomada** do item em `review` por `/api/work-orchestration/reviews` (aceite) → `completed`; (5) **novo `GET /items`** já **excluiu** o item terminal, mantendo só o `changes_requested` — reload/relista não torna o terminal acionável; (6) **isolamento:** uma 2ª conta descartável, autenticada e allowlistada, viu **0 itens** e nenhum item da 1ª (RLS). Dados descartáveis (usuários `a4432804…` e `75561f0a…`, seus itens/eventos/sessões) **verificados e removidos** por identificação exata (exclusão transacional com guardas); **os registros, contagens e dados protegidos verificados retornaram ao baseline observado** (6 usuários / 10 itens / 75 eventos / 34 conversas; `tecopfefer@gmail.com` intacto; sem comparação binária do banco).

**Divergência/limitação registrada:** a prova integrada foi conduzida pela API real (não por cliques no navegador) por limitação da automação de navegador nesta sessão — a renderização/interação da UI está coberta pelos testes de componente. Também: a lista conversacional é uma **consulta viva** (reperguntar re-lista); ela não é persistida como cartão que sobrevive ao reload — reabrir a conversa arquivada, porém, restaura os cartões dela pelo mecanismo existente.

**Fora desta entrega (não iniciados):** paridade mobile do histórico/retomada; qualquer painel/dashboard persistente (fora do escopo canônico). Ratificação final é do humano.

### UX-04 — prova complementar de retomada real pelo checkpoint (2026-08-03)

**Não ratificado.** Registro append-only de uma prova adicional; nenhuma seção anterior foi reescrita. Nenhuma linha de código, schema ou migration foi alterada nesta sessão — a implementação de 2026-07-31 permaneceu intacta e foi apenas exercitada. Branch `claude/ux-04-chat-history-resumption` a partir de `2d49273`; sem push, PR, merge ou alteração de `main`.

**Motivo.** A prova de 2026-07-31 demonstrou principalmente reencontro, foco e revisão de itens já em `review`/`changes_requested` e retomou o de `review` por aceite. Isso é insuficiente para a **promessa central** do UX-04 (aceite: "retomar um trabalho pausado … apenas pelo chat, partindo do checkpoint"). Esta prova fecha exatamente essa lacuna: um trabalho **realmente bloqueado** (`decision_required` → `blocked`), reencontrado em **conversa nova**, com a decisão respondida ali e a execução **retomada a partir do checkpoint persistido** — sem recomeçar do zero.

**Método (honesto).** Endpoints reais do Next.js + Supabase local + executor determinístico. Como nas provas anteriores, a automação de navegador não dirigiu os inputs controlados do React; a sessão veio do GoTrue e as etapas foram dirigidas por **HTTP autenticado contra os mesmos endpoints que a UI chama** (a renderização/interação da lista está coberta pelos testes de componente do `ChatClient`, verdes). Cenário determinístico `ux02-deterministic-decision` (flag existente `ANIMA_UX02_DETERMINISTIC_PROOF`, `configureUx02DeterministicProof`) — **sem modelo** para a execução do trabalho; o executor emite checkpoint + `decision_required` na 1ª tentativa e `result` na retomada. Aprovação (UX-00/01) e classificação INTEL-01 foram **provisionamento por RPC** (sem gatilho conversacional — limitação externa já registrada). Contas descartáveis `@test.invalid`; nunca a conta pessoal.

**Fluxo provado ponta a ponta (item `4184b312`, usuário A `a27f3399`):**
1. Conversa #1 (`1908adc1`… nesta corrida): `/api/ai/chat` com a frase determinística criou a proposta; aprovação + INTEL-01 (provisionamento); `/supervisor-turn` (1ª volta) executou o executor determinístico → **`checkpoint_recorded`** (seq do evento, `signal.sequence=2`) + **`input_requested`** (`architectural_decision`, opções `continuar`/`encerrar`) + **`work_blocked`** → item **`blocked`**; claim liberado. Tentativa 1 = `d2b24624`.
2. `archive_current_conversation` arquivou a conversa #1 **sem** concluir o trabalho.
3. Conversa **nova** #2: `GET /api/work-orchestration/items` reconstruiu o cartão do item **bloqueado** (com `pendingDecision`) através da sessão arquivada; `/api/ai/chat` "quais trabalhos tenho em aberto?" devolveu `kind:work_history` com o cartão, em sessão diferente da arquivada.
4. Na conversa #2, `POST /api/work-orchestration/decision-responses` (`continuar`) → `input_provided` e item de volta a **`approved`**; `human_decision_resumption_source` reconstruiu `kind:human_decision_checkpoint`.
5. `/supervisor-turn` (2ª volta) → `begin_human_decision_resumed_attempt`: **nova** tentativa `80c56b2d` (≠ `d2b24624`), `execution_started` com `reason=human_decision_resumed` e correlação explícita `resumed_from_attempt_id=d2b24624`, `resumed_from_checkpoint_event_seq`, `resumed_from_input_requested/_provided_event_id`. O executor recebeu `carriedContext.continueFromCheckpoint` e emitiu `result_submitted` (`summary` "retomou do checkpoint persistido", validação "Retomada consumiu o checkpoint persistido"=`passed`, `resultReferences:["ux02-proof:resumed-from-checkpoint"]`) → item **`review`**. **Não reiniciou do zero.**

**Persistência/reload:** após a retomada, `GET /items` reconstruiu o item (`review`) do banco; `GET /items/by-source/<msg #1>` reidratou o cartão da conversa arquivada.

**Idempotência:** repetir `/decision-responses` (`continuar`) → **1** `input_provided` (sem 2º processamento), item permanece `review`; repetir `/supervisor-turn` → `no_eligible_work`, **sem** nova tentativa (permanecem **2** `execution_started` distintas e **1** `result_submitted`).

**Isolamento:** 2ª conta descartável B (`6c812faf`), autenticada e allowlistada — `GET /items` = **0**; lista conversacional vazia; `/decision-responses` no item de A = **404** (RLS o esconde); `/supervisor-turn` no item de A = `no_eligible_work`; o item de A permaneceu intacto.

**Sem integração externa real:** item terminou em `review` (não `completed`, não integrado); **0** `result_accepted`; **0** eventos de integração; diretório-alvo determinístico **vazio** (executor não tocou filesystem real).

**Validações:** typecheck limpo nos cinco workspaces; core interpret **21/21** (classificador UX-04 + estados retomáveis); web ChatClient **4/4** (lista reencontrada acionável, item terminal só histórico, lista vazia). Nenhuma migration criada (nenhuma necessária). O contrato de banco reutilizado é o já ratificado da Etapa 2B.2/UX-02 (RPCs `record_work_decision_required`, `respond_to_work_decision`, `human_decision_resumption_source`, `begin_human_decision_resumed_attempt`), não modificado.

**Limpeza:** descartáveis (usuários `a27f3399`, `6c812faf` e todos os seus itens/eventos/conversas/sessões e efeitos de detecção — pilares/XP/embeddings) **removidos** por identificação exata em transação com guardas fortes (só `ux04-%@test.invalid`, guarda anti-conta-pessoal, `session_replication_role=replica` local). **Baseline restaurado exatamente**: 6 usuários / 10 itens / 75 eventos / 34 conversas / 6 sessões; `tecopfefer@gmail.com` intacto; **0** órfãos.

**Lacunas encontradas:** nenhuma. A promessa normativa do UX-04 se sustenta pelo comportamento já implementado.

**Veredito:** **UX-04 apto para ratificação.** A ratificação final permanece decisão humana.

**Ratificação (2026-08-03):** Gean **ratificou o UX-04** — reencontro e retomada de trabalhos pelo histórico do chat — considerando aceita esta prova complementar (commit `e680d89`): trabalho realmente bloqueado por `decision_required`, checkpoint persistido, abandono da conversa original, reencontro em conversa nova por `work_history`, resposta à decisão na conversa nova, retomada real por nova tentativa correlacionada à original e ao mesmo checkpoint com `human_decision_resumed` explícito, sem reinício do zero, persistência após reload, idempotência, isolamento entre usuários, ausência de integração externa real e limpeza guardada. Registro append-only: nenhuma prova anterior (inclusive a limitação da prova de 2026-07-31) foi reescrita, e o significado normativo do UX-04 permanece inalterado.

### Paridade mobile da Fase G — histórico e retomada canônica (2026-08-03)

**Implementado e pronto para revisão (não ratificado).** Branch `claude/ux-04-mobile-parity` a partir de `61eedb5`; sem push/PR/merge; `origin/main` intacta. Nenhum contrato ratificado, executor, Supervisor, migration ou normativa UX-02/03/04 foi alterado.

**Escopo (aceito pelo Gean):** o mobile permanece **apenas cliente** — nada executa no dispositivo, nada do Supervisor é duplicado. (1) Reencontro pela conversa: `routeWorkMessage` avalia `isWorkHistoryQuery` antes de `isWorkContinuation`, usa `findResumableWorkItems()` (RLS) e `presentWorkItem`, curto-circuita o Ollama e renderiza `MobileWorkCard` (foco + todas as ações). (2) Retomada canônica: após `respond_to_work_decision` com efeito `resume` → estado `approved`, o card pede ao **host** uma volta do Supervisor; retry não-destrutivo aciona **só** o host (sem 2º `input_provided`). (3) Canal mobile→host: a rota `supervisor-turn` passou a aceitar `Authorization: Bearer <access token>` **além** do cookie (`authenticateRequest` + `createBearerClient`), com RLS/`auth.uid()` do token, **sem** service role, **sem** confiar em `user_id` do corpo, chamando o **mesmo** `runSupervisorTurn`. Host em `EXPO_PUBLIC_ANIMA_WEB_URL` (validado, sem credenciais).

**Provas verdes (automatizadas + banco, 2026-08-03):** mobile **31** (histórico, host, decisão/retomada, regressão "Resultado aceito"), web **140** (incl. `request-auth` e `supervisor-turn/route`: cookie e bearer, bearer inválido recusado, `user_id` do corpo ignorado, mesmo `runSupervisorTurn`), core **588**, typecheck **5**. **Prova determinística ponta a ponta pelo CANAL BEARER (mobile→host):** item bloqueado por `decision_required` (bearer 1ª volta), reencontro por `findResumableWorkItems` através da sessão arquivada, decisão respondida (persistida **independente** do host), retomada canônica (bearer 2ª volta) → nova tentativa com `reason=human_decision_resumed` correlacionada à tentativa e ao checkpoint anteriores → `review`; idempotência (1 `input_provided`, sem 2ª tentativa), isolamento (usuário B não reencontra/responde/retoma), zero `result_accepted`, workspace intacta. Descartáveis removidos por identificação exata; baseline restaurado (6/10/75/34; `tecopfefer@gmail.com` intacto).

**Pendência nomeada:** a **prova física em Expo Go** (dispositivo, padrão da Fase A/ORQ-04) depende do Gean; o ambiente, a conta descartável e o estado bloqueado ficam preparados. Não substituída por afirmação. **Fora:** executor/Supervisor no mobile, push, offline, dashboard, timeline, busca avançada, reabertura geral de conversas arquivadas, cartão completo de execução do UX-01.

#### Checklist de prova física mobile da Fase G (2026-08-21, para o Gean)

Software-complete no dispositivo (paridade de apresentação); falta só a prova
física. Pré-requisitos: Expo Go no dispositivo na mesma rede, Supabase local
acessível, conta descartável allowlistada, `EXPO_PUBLIC_ANIMA_WEB_URL` para o host.
Passos (não marcar como concluído sem executá-los):

1. Reencontrar pelo chat um trabalho aberto de outra conversa (`findResumableWorkItems`) → cartão renderiza com foco e ações.
2. Conferir a **fase humana** no topo do cartão (novo, `fbf1e87`): `Implementando`/`Testando` com ponto `●` durante execução; `Revisando`/`Pronto para integrar`/`Concluído` conforme o estado — deve casar com o web.
3. Cartão de **execução** (executor/modelo/limites/checkpoint) e, se interrompido por orçamento, a linha de **espera temporal** ("retomada do checkpoint quando a janela liberar").
4. **Decisão necessária** (`pendingDecision`): responder `continuar` → retomada pelo host (canal Bearer) sem 2º `input_provided`; `encerrar` → `cancelled`.
5. **Resultado** para revisão + parecer do **Verifier** (advisory) + **integração** disponível após aceite (sem afirmar merge).
6. Recarregar/fechar-e-abrir o app: todos os cartões reconstruídos idênticos do estado persistido.
7. Registrar capturas + `SELECT event_type, proposal_version FROM work_events WHERE work_item_id='<item>' ORDER BY seq;` sem duplicatas.

Assimetria conhecida (não bloqueia a prova, decisão pendente): o mobile usa
`presentWorkItem` (sem a guarda de proveniência do web `reconstructWorkPresentation`).

### Integração do GPT e do runner ao monorepo (2026-08-03) — pronto para revisão

**Implementado e pronto para revisão (não ratificado).** Branch `claude/ux-04-mobile-parity`, quatro commits acima da paridade mobile: `2dec60c` (integração do GPT), `7fd4ad4`+`c7d5a0f` (runner trazido por `git subtree`) e `56854e8` (fiação do runner ao monorepo). A branch **tem push** (`origin/claude/ux-04-mobile-parity` em dia); **`origin/main` permanece intacta**, sem PR nem merge.

**Nota de método (honesta).** Esta seção foi redigida **a partir da leitura do código commitado** e das **validações automatizadas executadas nesta sessão** (ver *Evidências* abaixo). Os commits originais **não traziam corpo de mensagem** nem registro no plano — o repositório não descrevia esta mudança até aqui, e é essa lacuna que a seção fecha. **Distinção explícita:** as evidências abaixo são de **validação automatizada** (typecheck, testes de unidade/componente, build e suíte do runner); uma **prova ponta a ponta com o provedor OpenAI real** e a **prova física mobile em Expo Go** permanecem **pendentes** e **não são substituídas por afirmação**.

**Autorização e ratificação da integração externa (Gean, 2026-08-04).** A mudança **introduz uma dependência externa nova em tempo de execução: a API da OpenAI** (`https://api.openai.com/v1/responses`, modelo padrão `gpt-5.6-terra`, via `OPENAI_API_KEY`). O `AGENTS.md` exige autorização explícita para integração externa. **Gean autorizou e ratificou explicitamente** a introdução da integração OpenAI/GPT no Anima, mantendo estas fronteiras: escolha explícita entre GPT remoto e Ollama local; chaves apenas no servidor e nunca no bundle mobile; ferramentas do GPT limitadas à leitura do projeto; alterações reais executadas somente pelo runner em workspace isolada; nenhuma aplicação automática no projeto original; aprovação e revisão humanas preservadas. A integração é **opcional por configuração**: sem `OPENAI_API_KEY` o provedor GPT falha fechado com mensagem clara e o Ollama local permanece disponível.

**O que foi feito, por parte:**

1. **Runner no monorepo (`tools/local-agent/`).** O braço local de programação — antes projeto separado em `G:\anima-local-agent-poc`, referido no "Estado de partida" como *comprovado fora do repositório* — foi **vendorado por `git subtree`** (split `3d60521`): pacote Python completo (`agent`, `planning`, `execution` transacional, `checkpoint`, `sandbox`/`container`, `ollama`, `policy`, `tools`, `snapshot`) e a suíte `tests/`. Mantém processo, venv, workspace temporária e contratos de segurança **separados** da aplicação web (execução em contêiner efêmero `network none`, não-root, raiz somente leitura, cópia sanitizada sem `.git`/`.env`, fail-closed sem Docker, `git -c safe.directory` por processo no Windows, `--produce-only` sem aplicar). `56854e8` fia as variáveis `ANIMA_LOCAL_RUNNER_*` no `apps/web/.env.example` e enxuga o README. Nenhum contrato do runner ratificado no INT-04/Fase D foi alterado por esta integração — apenas a localização do código mudou.

2. **Provedor de chat com dois back-ends (`apps/web/lib/ai/chat-provider.ts`).** O chat deixa de falar só com o Ollama: `streamChatProvider` roteia para `openai` (GPT pela Responses API, com laço de ferramentas) ou `ollama` (local, `qwen2.5:14b`). O provedor é **escolhido pelo usuário no compositor** (campo `provider` no corpo da rota); sem escolha, cai no `ANIMA_AI_PROVIDER`. Ambos são normalizados para um **stream de texto puro**, o que simplificou o consumo na rota. **Respostas determinísticas nunca saem da máquina:** elas curto-circuitam antes de qualquer provedor; só uma resposta **livre** usa o provedor escolhido.

3. **Ferramentas de projeto somente leitura para o GPT (`apps/web/lib/ai/project-tools.ts`).** Cinco ferramentas expostas ao modelo para **fundamentar afirmações no código real** antes de responder: `project_search` (ripgrep literal), `project_read_file` (intervalo ≤ 400 linhas), `project_list_files`, `project_git_status`, `project_git_diff`. Sandbox forte: segmentos bloqueados (`.git`, `node_modules`, `.next`, `.worktrees`, `.claude`), arquivos sensíveis bloqueados (`.env*`, `*.pem|key|p12|pfx`, `id_rsa/ed25519`), guarda de path traversal e de escape da raiz, recorte de saída, **teto de 10 chamadas por turno** e timeout de 15 s por comando. Nenhuma ferramenta escreve.

4. **Planejador de trabalho executável (`apps/web/lib/ai/project-work-planner.ts`).** Quando o usuário no provedor `openai` faz um pedido de trabalho **sem `execution_spec`**, o GPT **investiga o repositório** com as ferramentas de leitura e então **deve** chamar `submit_project_work_proposal`, produzindo uma proposta estruturada (resumo/objetivo/escopo incluído e excluído/efeitos/riscos + **um** comando de validação `npm test|run typecheck|run test|run build`). O **servidor fixa** o alvo (`project:anima`), o isolamento (`workspace_read` + `workspace_write_isolated`) e os limites (3 tentativas, 30 min); guardas rejeitam caminhos inseguros no escopo e comandos de validação fora do padrão, e **exigem investigação antes do envio** (`localEvidenceCalls > 0`, envio forçado após 8 evidências, teto de 24 chamadas). A proposta entra pela orquestração existente marcada como `planner: openai_project_tools_v1`; falha de planejamento vira `work_error` (`project_planning_failed`) — **nunca** uma proposta inventada.

5. **Resposta autoritativa de estado (`apps/web/app/api/ai/chat/route.ts`).** Perguntas curtas de estado ("deu certo?", "funcionou?", "terminou?", "qual o estado?") passam a ser respondidas pelo **`work_focus` + `work_item` persistidos**, e **não** pela memória textual do modelo, com frase determinística por estado (`completed`/`review`/`blocked`/`in_progress`/…). O restante da rota preserva a persistência da resposta do assistente e a cadência de arquétipo/identidade.

6. **Ponte de admissão no `supervisor-turn` (`apps/web/app/api/work-orchestration/supervisor-turn/route.ts`).** Para que uma proposta planejada pelo GPT **chegue à execução autônoma**, a rota passou a **classificar (INTEL-01) automaticamente** propostas de **baixo impacto** cujos alvo, isolamento, validação e limites tenham sido **todos fixados pelo servidor** (`planner=openai_project_tools_v1`, `target project=anima`, permissões exatamente `[workspace_read, workspace_write_isolated]`, limites 3/30, `impact_level=low`, `capability=programming`). É uma **ponte fechada** (classificador `gpt-project-planner-bridge`), ao lado da já existente para a prova determinística do UX-02; qualquer outro trabalho continua **sem** classificação automática. Só classifica se ainda não houver classificação, e propaga conflito como `409`.

7. **Status do runtime local e superfície (`apps/web/app/api/ai/local-runtime-status/route.ts` + UI/PWA).** Nova rota GET autenticada que consulta o `GET /api/ps` do Ollama e reporta modelos carregados, VRAM% e contexto — para um indicador na interface. Acompanham ajustes de UI (`ChatClient`, `WorkProposalCard`, `WorkExecutionCard`, `AppNav`, `ChatFab`, `chat.module.css`, `globals.css`) e um **`manifest.ts` de PWA**.

**Evidências (validação automatizada, 2026-08-04, HEAD `56854e8`).** Comandos e resultados reais desta sessão:

| Verificação | Comando | Resultado |
|---|---|---|
| Typecheck do monorepo | `npm run typecheck` | **5 workspaces limpos** (mobile, web, core, supabase, types) |
| Testes core | `npm run test --workspace=packages/core` | **27 suítes, 588 testes — todos verdes** |
| Testes web (inclui `chat-provider`, `project-tools`, `project-work-planner`, `WorkExecutionCard`, `supervisor-turn/route`) | `npm run test --workspace=apps/web` | **15 suítes, 153 testes — todos verdes** |
| Testes mobile (sem dispositivo) | `npm run test --workspace=apps/mobile` | **4 suítes, 31 testes — todos verdes** |
| Testes `packages/supabase` (espelhos puros) | `npm run test --workspace=packages/supabase` | **7 verdes, 2 pulados** (dependem de banco) |
| Build web | `npm run build --workspace=apps/web` | **build concluído** (rotas geradas, incl. `/api/work-orchestration/supervisor-turn` e `/manifest.webmanifest`) |
| Suíte do runner | `python -m pytest -q` (venv em `tools/local-agent`) | **95 testes verdes, 9 pulados** (dependem de Ollama/Docker reais) |
| Sanidade do runner | `python -m compileall local_agent tests` + `python -m mypy local_agent` | **compileall OK; mypy sem issues em 17 arquivos** |

**Não executado (e por quê):** a suíte **pgTAP** (banco) **não** foi rodada — estes commits **não tocaram migration alguma** e ela exige o Supabase local no ar; o contrato de banco reutilizado permanece o já ratificado. A **prova ponta a ponta com o provedor OpenAI real** e a **prova física mobile em Expo Go** continuam pendentes (ver *Pendências nomeadas*).

**Fronteiras preservadas (declaradas, a confirmar na revisão):** as ferramentas do GPT são **somente leitura** e não podem escrever no repositório; a escrita real de código continua **exclusivamente** no runner isolado, sob o contrato ratificado do INT-04, **sem auto-aplicação**; a revisão do resultado permanece **humana**; a ponte de admissão só admite propostas de baixo impacto com parâmetros fixados pelo servidor; respostas determinísticas não usam provedor externo. Nenhuma migration foi criada; `private.begin_work_attempt`, SUP-04 e SUP-05 não foram tocados por estes commits.

**Pendências nomeadas (não substituídas por afirmação):** (1) **prova ponta a ponta com o provedor OpenAI real** — pedido em linguagem natural → investigação do GPT → proposta executável → aprovação → execução isolada pelo runner → resultado em `review`, com evidências e workspace intacta; (2) a **prova física mobile em Expo Go** da seção anterior (depende do Gean; ambiente e conta descartável preparados). A **validação automatizada** (typecheck, testes, build, suíte do runner) está **feita e registrada acima**; estas duas são **provas ao vivo** distintas dela. **Ratificação final é do humano.**

### Execução local de código em git worktree (ADR-001) — implementado e provado ao vivo (2026-08-04)

Ratificada a **Opção A** do [ADR-001](../arquitetura/adr-001-execucao-local-de-codigo.md) (Gean, 2026-08-04): o Anima passa a executar código no repositório **real** dentro de uma **git worktree isolada**, com o toolchain real, e a inteligência que escreve o código é **selecionável** por adaptadores. Detalhes, invariantes e commits estão no ADR; aqui fica só o marco.

Implementado sobre o contrato `WorkExecutorAdapter` existente (consumido pelo `runExecutorStreamed`), **sem sistema paralelo**: `WorktreeExecutorAdapter` + primitivas de worktree + interface `CoderBackend` (com `ScriptedCoderBackend` determinístico e `OllamaCoderBackend` local). Fronteiras: worktree descartável a partir do SHA autorizado, workspace original nunca tocado (mesmo sujo), `node_modules` real preservado, allowlist de comandos, guardas de segredo/escopo, gates obrigatórios, checkpoint, resultado **sempre** para revisão humana, **sem** merge/push/apply.

**Provado ao vivo no próprio Anima:** (1) determinístico — função pura + teste em `packages/core`, gates `npm test`/`npm run typecheck` reais verdes, `result` → revisão, original byte-idêntico; (2) **modelo local** `qwen3-coder:latest` escreveu uma mudança TypeScript real, gates reais verdes, `result` → revisão, original intacto (~35 s). Provas automatizadas verdes (worktree 13, worktree-executor 13, ollama-coder 4; suíte web 186 na entrega inicial). Commits `3f70555`..`ba4c5a8`.

**Fiação da rota (2026-08-04):** o executor de worktree passou a ser alcançável pelo fluxo real com **seleção explícita pelo contrato persistido** — `resolveExecutorRoute` lê `execution_spec.executor`; o planejador GPT persiste `executor`/`coder_backend`/`model`/`base_sha` (HEAD capturado na proposta, sem migration); `project:anima` exige o worktree, o runner Python segue no legado, e config inválida falha explícita sem fallback. Prova de **integração determinística** `Supervisor → worktree → review` com gate `npm` real e original intacto; suíte web **205**; typecheck limpo. Commits `ad9eaa7`..`63ca2b2`.

**Prova ao vivo pela stack HTTP (2026-08-04):** o fluxo COMPLETO foi executado pela rota autenticada real (Docker + Supabase local + dev server + `qwen3-coder:latest`), com usuário/dados descartáveis `@test.invalid`: proposta com contrato worktree persistido → aprovação → `POST /api/work-orchestration/supervisor-turn` (HTTP 200, `executorId=worktree-v1`) → `qwen3-coder` editou 2 arquivos TS em `packages/core` → **gates `npm` reais verdes** (test + typecheck) → checkpoint persistido → item em **`review`** → workspace original **byte-idêntico**; descartáveis limpos, fixtures e conta pessoal preservados. Detalhes no [ADR-001](../arquitetura/adr-001-execucao-local-de-codigo.md). **Pendente:** backend de nuvem (GPT) selecionável e a ponte de aplicação (INT-03). **Ratificação final do fluxo completo é do humano.**

### Superfície humana da segunda decisão de integração (2026-08-09)

**Implementada em web e mobile, sem publisher naquele checkpoint.** O `WorkPresentation` existente
foi estendido — sem criar arquitetura paralela — para projetar do log persistido
`awaiting_decision | authorized | refused`, sempre correlacionado ao resultado
aceito, item e versão exatos. O cartão conversacional existente oferece ações
explícitas **Autorizar integração** e **Recusar integração** somente depois de
`result_accepted`; após `integration_decided`, as ações desaparecem e o estado é
reconstruído corretamente em reload/outra sessão.

Web consome `POST /api/work-orchestration/integration-decisions`; mobile consome
o mesmo `WorkOrchestrationService.decideIntegration`. Ambos usam uma chave de
idempotência determinística por resultado+decisão, bloqueiam duplo envio enquanto
a mutação está pendente e só atualizam a UI após reler o estado persistido. Falha
HTTP, conflito ou versão obsoleta não produz estado otimista. A cópia pós-autorizar
declara **“autorizada e aguardando execução protegida”** e nega explicitamente
publicação, envio, integração ou merge. `refuse` declara ausência de efeito externo.

**Provas automatizadas:** core 641/641; web 305/305; mobile 33/33; typecheck dos
cinco workspaces; build de produção web. O SQL não foi alterado, portanto a suíte
pgTAP não precisou de nova execução neste incremento. Permanecem proibidos e
inexistentes neste fluxo: publisher real, push, PR, merge, apply e registro de
`integrated`.

### Substrato puro da execução protegida (2026-08-09)

**Implementado, inerte e sem provider naquele checkpoint.** `protected-integration.ts` substitui,
para a futura execução real, o outcome colapsado `reviewableReference` por fatos
separados: `integration_authorized → branch_published → review_request_created →
await_human_merge_decision`. Request e receipts carregam provider, repositório,
remote, branch local/remota, base branch/SHA, commit SHA, autorização, resultado
aceito e correlação. Replay idêntico é idempotente; divergência de
repo/branch/base/commit falha fechado. Push parcial, PR falho, branch/PR já
existentes e crash antes da persistência são representáveis por inspeção e
receipt `already_existed`.

### Publisher protegido da branch (2026-08-09)

**Implementado; efeito externo ainda não autorizado pelos fatos disponíveis.**
`GitBranchPublicationProvider` realiza preflight do remote/repositório, branch
local, commit, ancestralidade e base remota; inspeciona a branch exata; reconcilia
o mesmo SHA; recusa conflito; e, quando ausente, usa somente o refspec explícito
`refs/heads/<anima-work>:refs/heads/<anima-work>`, sem force, tags ou wildcard.
Um receipt com provider, repositório, remote, branch, commit, branch-base e
SHA-base só nasce após inspeção pós-efeito. `record_branch_published` persiste o
fato append-only apenas depois da validação do receipt e da correlação exata com
autorização, resultado aceito, tentativa, versão e `WorktreeHandoffV1`.

Provas: 21 cenários puros; 13 testes web, incluindo push e replay reais contra
remote bare temporário local; typecheck dos workspaces; pgTAP específico com 12
asserções. A migration incremental foi aplicada sem reset. O banco local
inspecionado não contém um candidato que reúna autorização de integração e
`WorktreeHandoffV1`; portanto nenhum push ao GitHub e nenhum `branch_published`
real foram fabricados. PR, review request, merge, apply, `integrated` e alteração
de `origin/main` permanecem estritamente fora do escopo.

### Coordenador, recuperação e observabilidade de `branch_published` (2026-08-09)

O fluxo agora possui um coordenador vivo que relê `work_events`, projeta
`IntegrationBoundary` e `WorktreeHandoffV1`, deriva a request protegida e só
então chama o provider. Fato já persistido começa por inspeção remota e não
repete push; remoção ou alteração externa da branch é drift explícito e
fail-closed. Concorrência foi exercitada contra remote bare real.

Foi corrigido o caso de resposta incerta após commit da RPC: um retry pode
observar `already_existed` depois de o receipt original registrar `created` sem
gerar falso conflito, desde que toda a identidade externa permaneça igual. A
unicidade de publicação passou de `decision_id` global para item+decisão, e a
RPC também exige ordem persistida resultado → aceite → autorização. A projeção
compartilhada web/mobile exibe branch e SHA quando `branch_published`, negando
explicitamente PR, merge e `integrated`.

Nenhum candidato legítimo foi encontrado no banco local: a consulta cruzando
resultado aceito, `integration_decided(authorize)`, `WorktreeHandoffV1` e ausência
de publicação retornou zero linhas. Nenhum candidato artificial foi criado e
nenhum efeito Git externo ocorreu. A próxima fronteira foi apenas endurecida no
core com identidade completa e `state='open'`; criar review request real segue
dependente de nova autorização humana.

### Endurecimento e provas da publicação de branch (2026-08-10)

**Sessão autônoma de revisão sobre `cac188c`; sem push, PR, merge ou alteração de
`origin/main`.** Nenhuma nova decisão arquitetural: apenas consequências diretas
de invariantes já ratificadas. A revisão adversarial de `ead91f5..cac188c`
confirmou o fluxo fail-closed e encontrou um único fail-open real, corrigido.

- **`--no-follow-tags` no push protegido (`ba74976`).** O push usava refspec
  explícito sem force nem wildcard, mas ainda respeitava `push.followTags` do
  ambiente: sob essa config uma tag anotada apontando para o commit publicado
  acompanharia o push, violando a invariante documentada "sem tags". A flag torna
  a ausência de tags garantida pelo código, não pela configuração local do git.
  Regressão cobre a presença da flag e a ausência de force/wildcard/tags.
- **Provas pgTAP da RPC (`9212149`).** `record_branch_published` já recusava (a) um
  receipt que casa o `WorktreeHandoffV1` mas diverge do persistido num campo de
  identidade não fixado pelo handoff — conflito, distinto de replay idempotente —,
  (b) versão de proposta divergente e (c) input inválido; o pgTAP só exercitava
  replay, reconciliação de `disposition` e mismatch contra o handoff. Três
  asserções fecham essas lacunas no nível real da RPC (a invariante "divergência
  conflita" só estava provada no core puro). `branch_publication.test.sql` passou
  de 13 para 16 asserções.
- **Prova negativa da projeção (`96917dd`).** `projectWorkIntegration` só promove a
  UI a "branch publicada" quando o evento `branch_published` casa exatamente
  autor=system, versão, autorização, resultado aceito, tentativa e a
  `idempotencyKey` derivada do commit; qualquer divergência permanece em
  "autorizada". Só o caminho feliz estava provado. Quatro casos negativos (autor
  não-system, tentativa/autorização divergentes, `idempotencyKey` adulterada)
  provam que um evento forjado ou corrompido nunca faz a UI afirmar publicação.
- **Achado invalidado por verificação:** a suspeita de que a reconciliação
  (`already_persisted`) quebraria após limpeza da branch local não procede — o
  `dispose` do worktree **preserva a branch por padrão** (`deleteBranch` é opt-in),
  então o preflight da reconciliação a encontra no fluxo normal.
- **Fronteira preservada:** confirmado que **nenhuma rota viva** dispara
  `executeAuthorizedBranchPublication`/`GitBranchPublicationProvider`/
  `record_branch_published`. A maquinaria existe e é testada, mas o gatilho de push
  real permanece não fiado — postura fail-safe correta. Criar review request real
  e fiar o gatilho de push seguem dependentes de nova autorização humana.

**Gates verdes no HEAD da sessão:** typecheck dos cinco workspaces; core 669;
web 324 (serial — o run paralelo tem flake ambiental conhecido de contenção de
fetch-mock sob os testes git-pesados de worktree, verde isolado e serial, não é
regressão); mobile 33; pgTAP `branch_publication` 16/16 contra o Supabase local
(BEGIN/ROLLBACK, sem `db reset`). Nenhum efeito Git externo; `origin/main` intacta.

### Fiação da publicação de branch ao caminho vivo (2026-08-10, ratificada por Gean)

**Ratificação humana da próxima fronteira do ADR-002.** A publicação protegida de
branch — o primeiro efeito Git externo real — foi fiada a uma rota autenticada,
sem enfraquecer nenhuma invariante. Detalhes em [ADR-002](../arquitetura/adr-002-integracao-aplicacao-publicacao.md);
resumo:

- **Rota `POST /api/work-orchestration/branch-publications`** (`route.ts`): corpo só
  com `workItemId` (validado como UUID). `branchPublicationTargetFromEnvironment`
  reconstrói o alvo confiável **só do ambiente do servidor** (`ANIMA_INTEGRATION_*`),
  ausente por padrão ⇒ 503 fail-closed. `runAuthorizedBranchPublicationWithSupabase`
  compõe readEvents/persist do cliente autenticado (RLS) e traduz o desfecho.
- **O cliente não escolhe nada sensível.** Remote, repositório, base, provider,
  branch, SHA e idempotencyKey vêm do servidor; campos maliciosos no payload são
  ignorados. Provado por teste de rota.
- **Tradução HTTP fail-closed** (`branch-publication-http.ts` + precondições
  tipadas no coordenador): precondição ⇒ 409; divergência ⇒ 409; remote
  indisponível/push não comprovado ⇒ 502; inconsistência do servidor ⇒ 500; erro
  Postgres por SQLSTATE com mensagem controlada; inesperado ⇒ 500. Sem vazamento.
- **Isolamento por dono** provado em pgTAP (16→17): 2º usuário allowlistado não
  publica item de outra conta (P0002). RLS + `user_id` no `FOR UPDATE`.
- **Endurecimentos da 2ª passagem adversarial:** UUID malformado ⇒ 400 (não 500
  opaco); `invalid_request` do provider ⇒ 500 (inconsistência do servidor, não do
  cliente); remoção do `executeAuthorizedBranchPublicationWithSupabase` morto
  (agora usado pela rota).
- **Sem efeito externo nesta sessão.** Prova ponta-a-ponta contra remote bare
  LOCAL: publicação real, idempotência (`already_existed` no retry, sem 2º push),
  invariante "sem tags" com efeito real (sob `push.followTags=true`), base
  intocada. Nenhum push contra origin/GitHub; `origin/main` intacta.

Fronteira seguinte inalterada: criação real de review request segue pura;
`merged`/`integrated` sem caminho alcançável.

### Prova viva da execução autônoma por `Executar autonomamente` (2026-08-11)

Prova sobre `1fa71a3`, **sem alteração de código**. Detalhes e evidências no
[registro](../registros/2026-08-11-prova-autonoma-supervisor-turn.md).

- **Achado central:** a UI real do chat **não** cria item de worktree elegível —
  nenhuma tela envia `developmentMode`, então um pedido de programação vira
  proposta **sem `execution_spec`** (item `713a34ff`, `approved`), e o Supervisor
  a recusa corretamente (`no_eligible_work`). Fail-closed esperado; a lacuna é a
  ausência de superfície de UI de auto-desenvolvimento — decisão de produto
  (`BLOCKED_BY_HUMAN_DECISION`).
- **Cadeia autônoma comprovada até o coder:** com item elegível criado pelo único
  produtor (o planejador, acionado por `developmentMode` via sessão autenticada —
  o próprio achado), dois itens (`337ba4ee`, `b72b67f0`, ambos programming/low,
  executor worktree, coder `ollama:qwen3-coder`) mantidos em `approved` e
  acionados por `/supervisor-turn` atravessaram `classificação → routing → claim →
  attempt → worktree isolada → coder`, com routing `worktree-v1`/`effort=strong` e
  worktree a partir do `base_sha` `1fa71a3`.
- **Resultado:** ambos `execution_failed` = `[ollama_read_round_limit]` (o coder
  não propôs edições no orçamento; os gates nem rodaram). **Não** alcançou `review`.
  Formulação corrigida (ver a correção conceitual no registro): o coder local
  atual, sob o protocolo e o orçamento de leitura vigentes, **falhou repetidamente
  em produzir uma edição antes do limite de leitura** — comportamento observado a
  diagnosticar, **sem** afirmar causa aleatória nem defeito da cadeia/contrato;
  nenhuma correção feita (não se força verde). A cauda `→ gates → review` já foi
  comprovada em 2026-08-04 com coder bem-sucedido.

### Investigação do cancelamento e nova prova UI (2026-08-11)

O cancelamento anterior foi rastreado de `WorkProposalCard` até a RPC: a rota
repassava `request.signal`; worktree/coder/processos o convertiam em terminal
`cancelled`; `record_commanded_work_terminal` gravava `work_cancelled` com
`reason=execution_cancelled` e `author=user`, embora nenhum pedido explícito de
controle existisse. Isso divergia do Marco 003 e do UX-01. A menor correção
(`3c9ac70`) cria um lifetime de execução independente do transporte dentro da
mesma invocação, sem processo residente ou arquitetura nova.

Nova prova integral pelo navegador real: conta descartável, superfície Dev,
planner OpenAI, item novo `b6ab5eeb` `programming/low`, aprovação e clique real
em `Executar autonomamente`; cadeia até worktree/coder com attempt `e6a828fe`.
Conexão estável; terminal `execution_failed`, não cancelamento, novamente por
`ollama_read_round_limit`. Nenhum gate, `review`, aceite ou integração. Não foi
alterado modelo, prompt, protocolo ou orçamento. Ver
[registro](../registros/2026-08-11-investigacao-cancelamento-transporte.md).
- **Invariantes:** `G:/anima` byte-intacto (`1fa71a3`, limpo), worktrees isoladas
  dispostas, **0** `result_accepted`/`integration_decided`/`branch_published`,
  `origin/main` `973ef46` intacta, itens `failed` fail-closed, `G:/anima-local-test`
  intacta. Setup (conta descartável + superfície dev) revertido; itens preservados
  como evidência. `impact = structural` não ampliado.

### Proveniência correta do cancelamento do executor (2026-08-12)

Continuação direta do fio acima. A investigação do transporte deixou registrada
uma imprecisão da RPC: `record_commanded_work_terminal` gravava o terminal
`cancelled` do executor com `author=user`. Rastreada a causa, ela é estrutural,
não do transporte: **todo** terminal que essas RPCs registram tem
`origin=executor` (validado), e o `cancelled` do executor nasce exclusivamente de
`signal.aborted` nos adaptadores (`worktree-executor`, `local-runner`, core
`BoundedWorkExecutor`) — nunca de decisão humana. O cancelamento humano explícito
tem caminho próprio e auditável (`request_work_control` →
`apply_work_control_at_checkpoint`, que grava `work_cancelled` com `author=user` e
`reason=cancelled_by_user`). Atribuir `user` ao cancelamento do executor confundia
as duas proveniências no log append-only.

Após `3c9ac70` esse terminal está dormante no caminho vivo (o sinal de execução
nunca aborta) e a projeção (`presentation.ts`) já distingue os dois pelo
`control_request_event_seq`, não pela autoria; ainda assim a autoria é um fato
permanente e auditável, e a fronteira do Marco 003 exige separá-las. A migration
incremental `20260812000000_executor_cancelled_provenance.sql` corrige **apenas** a
autoria para `executor` em `record_commanded_work_terminal` (reproduzindo a
definição vigente `20260726000003`, com a lógica de sequência pós-checkpoint
preservada) e no gêmeo dormante `finish_work_execution` (definição única
`20260715000004`); `reason=execution_cancelled` já era gravada. Sem mudança de
assinatura, estado alcançado ou tipos gerados. Commit `e3ef7aa`.

- **Provas:** pgTAP 29 arquivos/730 testes PASS — novo
  `executor_cancelled_provenance` (5/5: item→`cancelled`, `author=executor`,
  `reason=execution_cancelled`, origem, idempotência) e `work_execution` estendido
  para 24 com a asserção de autoria; regressão de checkpoint/retomada/reconciliação
  intacta. typecheck 5 workspaces; core 31/687. `origin/main` `973ef46` intacta;
  nenhum push, PR, merge, `db reset`, aceite ou integração. Ver
  [registro](../registros/2026-08-12-proveniencia-cancelamento-executor.md).
- **Varredura completa (2026-08-12):** os **quatro** produtores de `work_cancelled`
  ficam uniformemente consistentes — executor (`record_commanded_work_terminal`,
  `finish_work_execution`) → `author=executor`/`reason=execution_cancelled`; humano
  (`apply_work_control_at_checkpoint`) → `user`/`cancelled_by_user`; decisão humana
  (`respond_to_work_decision` encerrar) → `user`. Nenhum outro produtor diverge.

### Clareza de prompt na volta final do coder (2026-08-12)

Primeiro passo da investigação do `ollama_read_round_limit` que fechou os dois
recortes acima. Separando os fatores (protocolo, rodadas, prompt, modelo): o
contrato do protocolo limitado (`ollama-protocol.ts`) está correto e fail-closed;
o defeito acionável e determinístico é de **prompt**. Com `roundsLeft=0` o coder
ainda oferecia `{"action":"read"}` embora qualquer leitura ali seja recusada,
encerrando a tentativa sem edição — um modelo obediente gastava a última chance
lendo. A volta final passa a **exigir** `{"action":"edit",...}` e não repetir a
oferta de leitura; a penúltima avisa ser a última rodada. **Não** altera o
contrato do protocolo, o orçamento de rodadas nem terminal algum; melhora as
chances de edição sem forçar verde (falha de edição segue fail-closed). Commit
`e004b2a`; apps/web ollama-coder 11/11, typecheck 5. Fatores restantes (número de
rodadas, estratégia de leitura, capacidade do modelo) são sensíveis a contrato e
estocásticos — não tocados aqui, coerente com "antes de alterar qualquer
contrato".

### Hardening determinístico do coder e do executor de worktree (2026-08-12)

Varredura orientada por evidência nos componentes tocados, dois recortes locais
sem mudança de contrato:

- **Orçamento/truncamento do reparo do coder** (`684d8e0`): no reparo só-de-schema
  do protocolo limitado, `assertPromptWithinBudget` reavaliava o prompt **original**
  (já checado) em vez das mensagens de reparo, que enviam mais tokens (eco do
  assistente até 500 chars + instrução). Um reparo maior que a janela ia sem guarda
  e o Ollama o truncava em silêncio — o que a Fase 1 evita. Passa a medir orçamento
  e truncamento sobre o payload real (`SYSTEM+prompt+eco+instrução`) e acrescenta
  `assertNotTruncated` após o reparo, em paridade com a 1ª volta. Códigos precisos
  (`ollama_context_budget_exceeded`/`ollama_prompt_truncated`) em vez de erro de
  schema a jusante. Regressões que falhariam antes: ollama-coder **13/13**.
- **Cobertura do desfecho de zero alterações** (`89a161c`): o ramo de defesa em
  profundidade do `WorktreeExecutorAdapter` — backend alega sucesso e não escreve
  nada → `error` (execution_failed, não-retryable), NUNCA um `result` de revisão
  vazio — não tinha teste próprio. `ScriptedCoderBackend([])` exercita o caminho.
  worktree-executor **16/16**.

typecheck 5 workspaces; sem mudança de SQL/tipos/contrato; `origin/main` `973ef46`
intacta. Verificado ainda que a mudança de proveniência (`e3ef7aa`) é segura em
todos os consumidores JS: `presentation.ts` distingue cancelamento humano por
`control_request_event_seq` e projeta status por evento, nunca pela autoria; o
`gpt-coder` (single-shot) não compartilha o defeito do reparo do Ollama.

### Desacople do transporte estendido à execução comandada (2026-08-12)

Varredura da classe de defeito do `3c9ac70` por todas as rotas que iniciam
execução. Achado: `/execute-commanded` (INT-04, runner Python legado) ainda
repassava `request.signal` ao `runExecutorOnce` — o mesmo acoplamento que o
`3c9ac70` desfez em `/supervisor-turn`, deixado no irmão comandado. Abandonar a
conexão abortava o sinal e o executor emitia `cancelled`, um terminal inventado a
partir de disconnect. Corrigido (`ee15b71`) passando um `AbortController` fresco
depois de `start_commanded_work_attempt` já ter persistido a tentativa; mesmo
racional e mesmo caráter single-shot, sem mudar payload de RPC. Consequência
coerente com o SUP-04: item comandado sem `max_duration` vai a `requires_human` na
reconciliação em vez de `cancelled` espúrio (fail-safe). A rota não tem chamador de
UI hoje (a UI usa `/supervisor-turn`), mas é endpoint real usado em provas do
SUP-04. Nova `route.test` 1/1 (falharia antes do fix); typecheck web.

A varredura fechou a classe: as **duas** rotas que iniciam execução
(`/supervisor-turn`, `/execute-commanded`) estão desacopladas. `/branch-publications`
também recebe `request.signal`, mas é **outro caso** e fica intacto: publicação é
operação discreta, idempotente e verificada (inspeciona→push→reconfirma o SHA
remoto), não produz terminal de trabalho; cancelar por disconnect apenas adia uma
retomada idempotente, nunca inventa `work_cancelled`. É a superfície protegida do
ADR-002 e não tem o defeito.

## Dependências entre fases

### SELF_UNDERSTANDING / PROJECT_ADVISOR_V0 (2026-08-24)

Implementado no chat web, ainda **não declarado PASS**. A rota reconhece somente
perguntas explícitas sobre o estado/próximo passo do projeto e bifurca antes dos
detectores que poderiam gravar XP, notas, quests ou trabalho. O builder local usa
uma allowlist de manifesto, PRD, plano/backlog, arquitetura, prova e registros;
acrescenta apenas metadados RLS de `work_items`/`work_events` e observação Git
read-only. Cada fonte carrega autoridade e proveniência, com orçamento total,
remoção de caminhos locais sensíveis e redação defensiva de tokens.

O `ProjectAdvisor` é uma porta provider-agnostic. OpenAI e Ollama recebem o mesmo
contrato estruturado, sem as ferramentas genéricas de repositório. Validação do
host exige fontes canônicas, estado observado e evidência; exige evidência para
"comprovado" e fonte canônica para "direção"; resposta insuficiente ou sem
proveniência falha fechada. O resultado é advisory: não escreve classificação,
decisão, backlog, `work_item`, evento ou ação.

Gates da implementação: typecheck dos cinco workspaces; 72/72 suítes web
(887 testes), 46/46 core (1014), mobile 5/5 (51), Supabase 1 suíte/8 testes
(1 suíte e 2 testes já skipados); build Next 56 páginas. Warnings preexistentes
de `act(...)` e acesso ao ignore Git global não são regressões. Próximo ponto
exato: prova pela UI real. O Ollama local estava indisponível e a autorização
OpenAI da meta-prova anterior não se transfere; portanto, qualquer egress exige
novo checkpoint humano explícito. Até lá, `PROJECT_ADVISOR_V0 = PASS` não pode
ser declarado.

**Primeira meta-prova real — NOT_PROVEN (2026-08-24).** Uma única chamada OpenAI
autorizada foi consumida. O contexto foi reconstruído localmente após a prova:
20.544 caracteres, nove fontes de arquivo/Git, quatro classes presentes e zero
problemas de suficiência. A mensagem fail-closed genérica só é usada para erros
que não são `ChatProviderError`; como o contexto passou e o provider retornaria
erro próprio em falha HTTP/configuração, a resposta OpenAI chegou ao host e a
falha ocorreu no parse/validação posterior. O subtipo exato não foi preservado
pela instrumentação anterior. Causa determinística: o boundary pedia JSON apenas
por prompt, sem schema nativo; causa adicional de observabilidade: o catch
apagava a classe local. Correção sem novo egress: `structuredOutput` comum aos
providers (JSON Schema estrito em OpenAI Responses; `format` schema no Ollama),
regressões para ambos e log somente do código local, sem conteúdo/contexto. O
gate semântico permanece igual e fail-closed. Nova prova externa é necessária e
exige nova autorização; não há retry coberto por esta sessão.

**Segunda tentativa — inconclusiva por ambiente (2026-08-24).** A pergunta foi
submetida uma vez, mas `next build` e `next dev` haviam compartilhado `.next`: o
HTML passou a apontar para CSS/chunks dev que respondiam 404. O dev não crashou
nem reiniciou. Sem stdout recuperável e sem persistência do advisory read-only,
não há prova de que o POST/provider foi alcançado; consumação da chamada fica
indeterminada. Banco e Git permaneceram no baseline. `.next` foi removido com o
dev parado, o servidor reiniciado e seis assets CSS/JS confirmados em HTTP 200.
Terceira prova externa/autorização necessária; gates futuros devem parar o dev
antes de `next build` e reiniciar sobre artefato limpo.

**Terceira tentativa — NOT_PROVEN sem novo retry (2026-08-24).** A trilha local
provou UI→backend→contexto (11 fontes/quatro classes/21.409 chars)→OpenAI
`gpt-5.6-terra`→resposta estruturada de 5.194 chars; o host recusou com
`project_advisor_answer_invalid` antes da apresentação. Schema/parse estruturais
passaram, semântica falhou; a versão ainda não registrava a lista segura de
códigos, e conteúdo não foi persistido. Gate preservado. Pós-prova, o JSON Schema
passou a restringir dinamicamente IDs por autoridade/seção e a observabilidade
passou a guardar apenas códigos semânticos; regressão + typecheck verdes. Banco e
Git ficaram no baseline. Estado final: NOT_PROVEN, sem quarta chamada/commit/push.

**Consolidação local do contrato (2026-08-24).** Sem novo egress, claim ganhou
classes de autoridade declaradas e verificadas contra as fontes; prompt, schema
dinâmico e host foram alinhados à mesma matriz. Onze respostas adversariais e
três positivas (incluindo resposta mínima sintética por estrutura+semântica)
estão verdes, com 13 códigos seguros e sem log de conteúdo. Build final ocorreu
com dev parado/`.next` limpo. O recorte é versionável e útil, mas permanece
`PROJECT_ADVISOR_V0 = NOT_PROVEN` até futura E2E explicitamente autorizada.

**Provider-schema boundary (2026-08-24).** E2E seguinte foi recusada pela OpenAI
antes de geração (`uniqueItems is not permitted`). O host mantém o schema completo
e toda autoridade semântica; uma projeção recursiva exclusiva do request OpenAI
remove somente a keyword comprovadamente incompatível. Ollama permanece com o
schema integral. Duplicações seguem recusadas por códigos host. Regressões de
payload/projeção/host verdes; sem novo egress; estado continua NOT_PROVEN.

**PROJECT_ADVISOR_V0 = PASS (2026-08-24).** Prova pela UI real atravessou
backend→contexto governado (11 fontes/quatro classes)→OpenAI
`gpt-5.6-terra`→schema→parser→semântica (20 claims)→apresentação HTTP 200. A
resposta separou corretamente fatos, prova, fronteiras, canonical e advisory.
Banco/Git permaneceram idênticos e nenhum workflow/coder iniciou. O único achado
pós-prova foi o nome não sensível `.worktrees/` no status Git; o prefixo porcelain
foi corrigido e coberto sem novo egress. Detalhes no registro da sessão.

**PROJECT_ADVISOR_FRESH_OPERATIONAL_STATE_V1_LOCAL = PASS (2026-08-24).** A
observação viva foi promovida de contagens para uma projeção host determinística
e bounded de metadados RLS: `work_items` fornece o estado corrente,
`work_events` fornece sequência/evidência tipada e `work_focus` fornece foco.
O snapshot identifica ativos, review, bloqueio e falha ainda não superada por um
resultado posterior, sem TTL arbitrário. Fontes agora declaram papel temporal;
claims sobre o presente sustentados apenas por snapshot histórico falham
fechado. A serialização de contexto consolida triagem por item e omite payloads,
pedidos originais e conteúdo pessoal. Fixture conflitante e casos adversariais
passam localmente sem provider/egress e sem mutação. Prova externa pela UI não
foi realizada nem autorizada neste recorte.

**E2E V1 — NOT_PROVEN (2026-08-24).** A única chamada autorizada chegou ao
provider: UI→backend→contexto de 11 fontes/quatro autoridades/24.068 caracteres
→OpenAI `gpt-5.6-terra`→structured output de 7.226 caracteres. O host recusou
antes da apresentação com `current_claim_without_live_source`; nenhuma segunda
chamada ocorreu. A causa contratual estreita era `unprovenFrontiers` ainda
admitir histórico puro, apesar de a categoria descrever fronteira aberta no
presente. O host agora exige ao menos `current_projection` ou `event_sequence`
nessa categoria; histórico puro continua permitido no racional como trajetória.
Banco e Git ficaram no baseline. Nova E2E requer autorização independente.

**PROJECT_ADVISOR_FRESH_OPERATIONAL_STATE_V1_E2E = PASS (2026-08-24).** Antes do
reteste, o snapshot ganhou auditoria segura de `generatedAt`, cobertura e
contagens, sem conteúdo/payload. A única chamada autorizada atravessou UI real,
snapshot `2026-08-24T19:42:30.960Z`, contexto governado (11 fontes/quatro
autoridades), OpenAI `gpt-5.6-terra`, schema, parser, semantic validator (15
claims) e apresentação HTTP 200. O snapshot tinha 2 ativos, 13 falhas não
superadas, 0 bloqueios, 0 review e nenhum foco; a resposta não inventou os estados
ausentes, explicitou que somente 4 falhas
cabiam no contexto e não concluiu ausência global a partir da cobertura bounded.
Histórico apareceu como trajetória/prova específica, nunca como estado atual.
Banco e Git permaneceram nos baselines e nenhum workflow/coder foi acionado.

**PROJECT_ADVISOR_ITEM_DRILLDOWN_V0_LOCAL = PASS (2026-08-24).** O Advisor agora
possui um recorte explícito para compreender um único item operacional sem ampliar
o snapshot global. A resolução prefere UUID estável, aceita prefixo único,
ordinal determinístico e foco atual apenas para referência dêitica; múltiplos
candidatos produzem esclarecimento, nunca escolha silenciosa. Depois da resolução,
uma projeção pura resume estado atual, timeline de até 20 eventos, tentativa,
falha, resultado, parecer do Verifier e evidências tipadas observadas. Códigos e
mensagens de erro só atravessam quando bounded e sem marcadores sensíveis; do
contrário a causa permanece explicitamente desconhecida. Payloads crus, pedido,
proposta, prompt/output, comandos, logs, caminhos e diffs não entram no contexto.
A bifurcação ocorre antes dos detectores/gravadores do chat e declara mutation
`none`. Fixtures de falha conhecida, falha desconhecida e review verificado,
incluindo adversariais, passaram localmente sem provider. E2E pela UI real não foi
executada nem autorizada neste recorte.

**PROJECT_ADVISOR_ITEM_DRILLDOWN_V0_E2E = NOT_PROVEN (2026-08-24).** A pergunta
autorizada chegou à rota real, mas o item `d3890a38…` havia sido criado pela
identidade descartável da execução remota e não era visível para a conta
autenticada no navegador. A consulta RLS retornou zero candidatos compatíveis e
a resolução terminou HTTP 404 em 758 ms, antes da projeção e de qualquer log de
request do provider; portanto a chamada OpenAI autorizada não foi consumida. Os
quatro contadores de banco, HEAD/origens e diff permaneceram no baseline. A UI
mostrou “Erro desconhecido” porque esse 404 era texto, embora o cliente leia JSON
em respostas não-2xx. Correção local estreita: `not_found` agora retorna JSON com
mensagem segura sobre visibilidade/acesso, preservando 404, RLS e fail-closed;
regressão, typecheck dos cinco workspaces e build com dev parado passaram. Não
houve retry. Nova E2E precisa de item pertencente à mesma identidade da UI ou de
login explícito na identidade-fixture, além de nova autorização de egress.

**PROJECT_ADVISOR_ITEM_DRILLDOWN_V0_E2E = PASS (2026-08-24).** O reteste
selecionou pelo próprio RLS da conta do navegador o item `58159655…`, único item
visível em `in_progress`. Sua projeção bounded continha integralmente quatro
eventos (`work_proposed`, `context_attached`, `work_approved`, `work_started`) e
nenhuma tentativa, falha, resultado, opinião do Verifier ou evidência
coder/gate/Git. Uma única chamada autorizada chegou à OpenAI
`gpt-5.6-terra`, retornou structured output de 4.201 caracteres, passou parser e
semantic validator (12 claims) e foi apresentada HTTP 200 em 15.634 ms. A
resposta afirmou o estado e a timeline, preservou explicitamente todas as
ausências e não inferiu atividade, interrupção, falha ou diagnóstico depois de
`work_started`. Banco `work_items/work_events/work_focus/ai_conversations`
permaneceu `60/601/2/189`; HEAD, origens e diff permaneceram idênticos. Nenhum
retry, coder, workflow ou mutação foi acionado.

**PROJECT_ADVISOR_CONVERSATIONAL_ITEM_REFERENCE_V0_LOCAL = PASS (2026-08-24).**
O substrate reutilizado é o próprio turno em memória do `ChatClient` e o canal de
headers estruturados já usado pela superfície: depois de validar a resposta, o
host extrai somente UUIDs exatos realmente mencionados, cruza com o snapshot e
emite até 20 tuplas `{workItemId, ordinal, role}`. O cliente retém apenas o
conjunto da apresentação mais recente; header vazio limpa refs stale e respostas
não-Advisor não criam memória nova. No turno seguinte, ordinais e anáforas simples
são resolvidos antes do provider. Ambiguidade produz esclarecimento, nunca escolha
global. UUID/prefixo e foco anteriores continuam funcionando. A referência só
identifica: item e eventos são relidos sob RLS, e perda de visibilidade retorna
404 governado. Testes controlam A/B→primeiro/segundo e A+B→“esse?” ambíguo,
incluindo payload adversarial, stale, RLS e chat normal. Nenhum egress ou mutação.

### Prova viva de superfície pendente pela janela de orçamento (2026-08-21)

No HEAD `5896862`, a RPC canônica `autonomous_work_budget_status`, chamada como o
usuário autorizado antes de qualquer nova proposta/aprovação, devolveu
`admitted=false`, `reason=user_attempt_budget_exhausted`, uso `6/6` tentativas em
24h e zero tentativas restantes. Os orçamentos de runtime não bloqueiam
(`354/7200s` em 24h; `0/2700s` na reserva de 60min). A primeira tentativa contada
sai da janela após `2026-08-22 10:25:00 -03:00`. A prova completa
`chat → proposal → approval → supervisor-turn → qwen3-coder → Next typegen →
typecheck web → Verifier → review` permanece o próximo ponto exato, sem bypass;
nenhum novo item/tentativa foi criado nesta verificação. Registro:
[`2026-08-21-prova-viva-pendente-janela-orcamento.md`](../registros/2026-08-21-prova-viva-pendente-janela-orcamento.md).

```text
A (fechar fundação)
└→ B (contrato de execução)
   └→ C (adaptador)
      └→ D (integração mínima, sob comando)
         ├→ E (supervisor V0)
         │  └→ F (inteligência sustentável)
         └→ G (experiência no chat — subconjunto de D; completa com E)
```
