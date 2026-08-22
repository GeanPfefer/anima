# Resident Local Host V0 — ADR + engine + portos + superfície + provas de governança

Data: 2026-08-22
Tipo: arquitetura (ADR) + desenvolvimento (engine/portos/superfície) + prova viva de governança

## Objetivo

Eliminar a última dependência humana do laço autônomo: o **disparo** da invocação do
host-turn. O host-turn bounded (`runAutonomousBacklogHostTurn`) já roda vários ciclos
sozinho e para tipado; o gate real do Resource Governor (`8d78d90`) admite/adia por
ciclo. Faltava o **processo residente** que reconcilie, consulte o kill-switch, adquira
identidade user-scoped, respeite o Governor, invoque o host-turn, classifique o desfecho,
entre em quiescência e acorde — sem cron, sem recursão pós-terminal, sem `service_role`,
sem daemon gigante. Prioridade 1 = ADR; depois, a engine V0 incremental.

## Estado Git

- Branch: `dev`. HEAD inicial: `8d78d90`. HEAD final: commit deste registro.
- `origin/dev` inicial: `8d78d90`; `origin/main`: `99bec54`, **intacta**.
- Preservados: `.worktrees/`, `.claude/settings.local.json`, `apps/web/.env.local`.
- Commits deste ciclo:
  - `ec1e69d` — ADR-003 do Resident Local Host.
  - `ed7fd6f` — engine V0 (agnóstica de transporte) + 26/26.
  - `b646ee4` — portos reais + superfície `anima local-host start` + 31/31.
  - `5dc905b` — `ANIMA_RESIDENT_MAX_ITERATIONS` (provas vivas bounded).
  - (este registro).

## Decisão de arquitetura

[`docs/arquitetura/adr-003-resident-local-host.md`](../arquitetura/adr-003-resident-local-host.md)
resolve as 16 questões sobre o código real. Pontos ratificados:

- **Reside** como processo **Node** iniciado explicitamente por Gean (`anima local-host
  start`); Node 24 roda TS nativamente, sem bundler.
- **`tools/local-agent` (Python) NÃO é a casa**: é EXECUTOR isolado (CoderBackend
  candidato), não orquestrador — todo o laço é TS em `@anima/core`+`apps/web`. Sem
  runtime paralelo novo; o executor Python permanece como backend que o worktree pode chamar.
- **Identidade user-scoped** via **Bearer/GoTrue** (`auth.uid()`/RLS), com
  **auth/session provider port** fail-closed sem identidade. **Nunca `service_role`**,
  UUID hardcoded, token no repo ou senha plaintext.
- **Kill-switch** (control-plane local: arquivo/env) consultado antes de cada trabalho,
  **fail-closed**; desligado congela trabalho novo, não mata execução iniciada.
- **Wake**: reconciliação de arranque | wake explícito | trabalho elegível | recuperação.
  V0 usa **poll lento provisório** + wake explícito; a elegibilidade vem do DOMÍNIO, não
  do relógio. Wake event-driven automático = próxima fronteira declarada.
- **Backoff** puro (exponencial capado; nunca tight retry). **Crash recovery** pelos
  contratos existentes (SUP-04/SUP-05); o **banco é a autoridade** do estado de trabalho
  (sem `runner_state.json`). **Concorrência** protegida pelo claim server-side (o runner
  não é mutex). **Governor** = única autoridade em dois sítios fail-closed (pré-gate da
  engine + por-ciclo na rota). **Transporte V0 = HTTP** à rota provada; a engine é
  agnóstica de transporte (troca para in-process no futuro sem tocar o laço).

## Mudanças

- **`apps/web/lib/resident-host/resident-host.ts`** — engine V0 agnóstica de transporte.
  `runResidentHost(deps)` recebe TODOS os efeitos como portos injetados (`reconcile`,
  `checkAutonomyEnabled`, `acquireIdentity`, `admitNewWork`, `runHostTurn`, `waitForWake`).
  Ordem de gates por volta: kill-switch → identidade (fail-closed) → reconciliação de
  recuperação (só arranque/pós-wake) → pré-gate do Governor → host-turn. Classificadores
  puros: `classifyResidentNext` (run_again|wait_resource|wait_human|idle) e `errorBackoffMs`.
  Cancelamento = parada determinística (`stopping→stopped`); `maxIterations` = teto estrutural.
  Nenhum estado efêmero novo persistido.
- **`apps/web/lib/resident-host/ports.ts`** — portos REAIS (transporte HTTP), SEM imports
  de `@anima/*` em runtime (só built-ins + `fetch`) para rodar por `node` puro. Núcleos
  puros (`parseAutonomyFlag`, `sessionNeedsRefresh`, `parseGoTrueSession`,
  `mapHostTurnResponse`) + invólucros finos (`createKillSwitch`, `createGoTrueIdentityProvider`,
  `createHttpHostTurnPort`). `accessToken` opaco, nunca logado.
- **`apps/web/scripts/resident-host.ts`** — superfície `anima local-host start`: compõe os
  portos do env, wake por poll+stdin+sinais, cancelamento por SIGINT/SIGTERM, telemetria
  estruturada. `ANIMA_RESIDENT_MAX_ITERATIONS` para provas bounded.
- **`apps/web/tsconfig.json`** — `allowImportingTsExtensions: true` (o entry importa `.ts`
  explícito; Node 24 exige extensão). Só PERMITE a extensão; não afeta imports existentes.
- **`apps/web/package.json` + `package.json`** — script `local-host`
  (`node --env-file-if-exists=.env.local scripts/resident-host.ts`).

## Provas

- **Engine** `resident-host.test` **26/26** — as 15 regressões exigidas pelo handoff
  (arranque+pronto→host-turn; sem trabalho→idle; disabled→zero execução; identidade
  indisponível→fail-closed; pressão→waiting; drena→idle; mais trabalho→run_again
  imediato; só fronteira humana→wait sem spin; erro→backoff não tight; cancel→determinístico;
  wake→reconcilia de novo; wakes múltiplos→sequencial sem duplicar; restart→reconcile antes;
  sem service_role fallback; Governor antes de cada trabalho) + classificadores puros +
  accessToken opaco na telemetria + teto estrutural.
- **Portos** `ports.test` **31/31** — núcleos puros + identidade/host-turn por fetch injetado.
- Total resident-host: **57/57**. `typecheck` dos **5 workspaces** PASS. `git diff --check` limpo.
- Suite ampla `apps/web`: **817/818** (o único vermelho é o flake conhecido de UI
  `WorkProposalCard.test.tsx › falha HTTP…`, timing-sensível sob carga — **passa 47/47
  isolado**; não relacionado a este recorte, que é aditivo).

### Provas vivas de GOVERNANÇA (processo real, sem stack de trabalho)

Com o processo real (`node apps/web/scripts/resident-host.ts`, Node 24):

1. **Kill-switch off → quiescência.** `ANIMA_AUTONOMY_ENABLED=disabled`: arrancou,
   emitiu telemetria estruturada, foi a `disabled` e quiesceu em poll, **sem tocar
   identidade nem rede**. Governado e cancelável.
2. **Enabled + identidade indisponível → fail-closed.** `ANIMA_AUTONOMY_ENABLED=enabled`
   com o provider GoTrue real apontando ao Supabase local (FORA): a sessão resolveu
   `null` e o processo foi a `waiting_human_or_recovery` (`identity_unavailable`),
   **`hostTurns=0`** (nenhum caminho privilegiado sem identidade), com backoff ~2s entre
   tentativas (não tight retry), parando determinístico em `max_iterations`. Prova viva
   dos cenários 4 + 14 + 9 com os PORTOS REAIS.

Os caminhos de SEGURANÇA do runner (kill-switch, identidade fail-closed, backoff,
cancelamento, telemetria) estão provados AO VIVO. A maquinaria ABAIXO da rota
(execute→worktree→qwen3-coder→gate→host-observed→Verifier `verified`→`review`) já estava
provada ao vivo em `af240cb` (2 ciclos, ambos `verified`).

## Invariantes de segurança (herdados, não afrouxados)

Desfecho máximo `review` — nada aceito/autorizado/integrado/aplicado; sem PR/merge/deploy.
SELEÇÃO/EXCLUSÃO server-side. Fail-closed em identidade/kill-switch/Governor. Bounds
estruturais dentro do host-turn. Cancelamento atravessa runner→host-turn→ciclo→executor.
Sem `service_role`, sem segredo no Git, sem daemon. `origin/main` intacta.

## Fronteira (parada deliberada) — prova viva do HAPPY PATH end-to-end

A prova viva do caminho FELIZ (runner idle → wake → 1 item descartável → Governor permite
→ qwen3-coder → gate → evidência host-observed → Verifier `verified` → `review` → idle)
exige o stack de trabalho COMPLETO, que está **frio** nesta máquina: **Docker Desktop fora**
(Supabase local depende dele), **Ollama parado**, **Next dev parado**. Levantar Docker
Desktop (GUI) + `supabase start` a frio + Ollama + Next + fixtures é bring-up ambiental
pesado e de cauda longa, cujo valor é incremental sobre o já provado (57 testes + 2 provas
vivas de governança + o happy-path da rota já provado em `af240cb`). Parada honesta.

**Receita exata da retomada (happy path V0), quando o stack subir:**
1. Docker Desktop up → `supabase start` (migrations aplicadas) → `ollama serve` (garantir
   `qwen3-coder:latest`) → `npm run dev:web`.
2. Usuário residente descartável (`@test.invalid`) via Admin API + allowlist de orquestração;
   1 item descartável SEGURO aprovado + classificado com `execution_spec` de worktree
   (`project:anima`, `coder_backend` local, gate barato). Receita SQL single-command
   `supabase db query --local`, intents SNAKE_CASE — como nos registros de 2026-08-22.
3. `apps/web/.env.local` (ou env) com `ANIMA_RESIDENT_EMAIL`/`ANIMA_RESIDENT_PASSWORD`
   do usuário residente; `ANIMA_AUTONOMY_ENABLED=enabled` (ou `ANIMA_AUTONOMY_FILE`);
   `ANIMA_RESIDENT_MAX_TURNS_PER_CYCLE=1`, `ANIMA_RESIDENT_MAX_CYCLES=1`,
   `ANIMA_RESIDENT_MAX_ITERATIONS=2` (bounded), `ANIMA_RESIDENT_IDLE_MS` pequeno.
4. `npm run local-host` → confirmar `idle`/quiescente (sem item) → **wake explícito**
   (linha `wake` no stdin) → observar `running` → item a `review` com `verifier_opinion
   verdict=verified` → runner volta a `idle`/quiesce. **NÃO** invocar `backlog-host-turn`
   manualmente (o runner é quem invoca).
5. Registrar. **Wake automático event-driven permanece a próxima fronteira.**

## Atualização — Prova viva do HAPPY PATH V0: **PASS** (2026-08-22)

`RESIDENT_HOST_V0=PASS` · `AUTO_EVENT_WAKE=PENDING`

O stack de trabalho foi levantado (Docker + Supabase local + Ollama `qwen3-coder:latest`
+ Next dev) e a prova viva mais estreita do resident host foi executada **de ponta a
ponta pelo laço do próprio processo — sem nenhuma chamada manual à rota**.

**Setup (fixture descartável):** usuário residente descartável `resident-proof-…@test.invalid`
(`973d543e-…`) criado pela Admin API (único uso de service_role, para CRIAR o usuário — o
runner nunca a usa); allowlist + mensagem de origem semeadas; item
`fdba6c78-081c-42c9-a049-7d4f44ebd0a0` criado→aprovado→classificado
(`create_work_proposal`/`resolve_approval`/`record_work_intelligence_classification`),
`execution_spec` de worktree (`executor=worktree`, `coder_backend=ollama`,
`model=qwen3-coder:latest`, `base_sha=db1b0d7`, gate `npm run typecheck --workspace=@anima/web`,
escopo = 1 arquivo markdown de rascunho). Pré-condições pela RPC canônica:
`autonomous_work_queue` → `queue_position 1`, `target_occupied=false`; budget
`admitted=true, costClass=local`.

**Execução (`node apps/web/scripts/resident-host.ts`, autonomy=enabled, `maxTurnsPerCycle=1
maxCycles=1 maxIterations=2 idleMs=6000`):** o processo assinou no GoTrue como o usuário
(**Bearer/`auth.uid()`/RLS — sem service_role**), reconciliou, o Governor permitiu, e
invocou o host-turn bounded. Telemetria real:

```
starting → reconcile → running → idle(host_turn_idle: stop/max_cycles_reached,
  moreWorkAvailable=false, cyclesExecuted=1) → [wake por poll 6s] → reconcile →
  running → waiting_resource(host_turn_resource_pressure) → stopping → stopped
  (summary: hostTurns=2, stopReason=max_iterations)
```

**Desfecho persistido do item `fdba6c78`:** `state=review` (desfecho máximo autônomo).
Cadeia completa `work_proposed → … → work_claimed → work_started → execution_started →
checkpoint_recorded → result_submitted → work_claim_released → host_observed_gate_evidence_recorded
→ host_observed_coder_evidence_recorded → host_observed_evidence_recorded → verifier_opinion_recorded`.
- **Verifier `verdict=verified`** — 7 checks, 0 gaps, 0 violations (3 attested + 4 independent).
- **Git observado pelo host:** `insertions:1, deletions:0` (o coder criou exatamente o
  arquivo do escopo na branch descartável `anima-work/1de27c29-…`, `observedCommitSha e568973…`).
- **Gate:** `npm.cmd run typecheck --workspace=@anima/web` → `passed`, exit 0, 9806ms.
- **Coder:** `ollama:qwen3-coder:latest`, 35714ms.

**Bonus — Governor gate ao vivo como ADMISSÃO:** na 2ª iteração, sob carga real da máquina
(logo após o coder), o gate por-ciclo do host-turn devolveu `resource_pressure` e o resident
host foi a `waiting_resource` **sem executar novo trabalho** — o gate do `8d78d90` agindo
como autoridade real de admissão, ao vivo, não só por testes.

**Integridade:** repositório principal **byte-intacto** (`HEAD=db1b0d7`, árvore limpa
exceto `.worktrees/`); a worktree de execução foi **descartada** (branch `anima-work/1de27c29`
ausente de `git worktree list`); o arquivo de rascunho **não existe** no repo principal
(viveu só na worktree descartada). `origin/main`=`99bec54` intacta; sem PR/merge/deploy/apply.
Fixture descartável PRESERVADA como evidência (padrão do repo). O wake usado foi o **poll
provisório** — o wake automático **event-driven permanece PENDENTE**.

## Próximo ponto exato de retomada

1. **Wake automático event-driven** (`AUTO_EVENT_WAKE=PENDING`; hoje poll lento provisório) —
   a próxima fronteira do wake, para "acorda quando necessário" sem nudge de relógio.
2. Transporte in-process (compor `buildProjectBacklogCycleDeps` + `runAutonomousBacklogHostTurn`
   atrás de `createBearerClient`) para mover a maquinaria para dentro do processo residente
   — sem tocar a engine (portos injetados).
3. Persistência/telemetria durável do resultado (seam de observabilidade, sem daemon) + UI.
4. (Frente adjacente, só depois) backlog canônico/documental → descoberta → candidato tipado
   → materialização em `work_item` → resident host executa.
