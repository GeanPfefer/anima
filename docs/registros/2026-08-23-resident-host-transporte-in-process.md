# Resident Local Host — transporte IN-PROCESS + prova viva (Next DOWN)

Data: 2026-08-23
Tipo: desenvolvimento + prova viva (end-to-end, local real)

`RESIDENT_IN_PROCESS = PASS` · `NEXT_SERVER_REQUIRED = NO`

## Objetivo

Remover a dependência operacional do resident host em relação ao Next server: hoje ele
chamava a rota `POST /…/backlog-host-turn` por HTTP (exigia `localhost:3000` vivo). Para
um runtime local persistente de verdade, o processo deve compor a aplicação DIRETAMENTE.

- Branch: `dev`. HEAD inicial: `19e3262`. HEAD final: commit deste registro.
- `origin/dev` inicial: `19e3262`; `origin/main`: `99bec54`, intacta.

## Mudança (`3a0018a`)

- **Composition root COMPARTILHADA** `runProjectBacklogHostTurn(client, ownerInstanceId,
  bounds, signal)` ([backlog-host-turn-run.ts](../../apps/web/lib/work-orchestration/backlog-host-turn-run.ts)),
  extraída da rota. A rota HTTP passa a DELEGAR a ela (comportamento idêntico, teste 6/6).
  Nenhuma duplicação: rota e adapter in-process convergem na MESMA composição.
- **`createBearerClient` isolado de `next/headers`** ([bearer.ts](../../apps/web/lib/supabase/bearer.ts));
  `server.ts` reexporta (≈40 importadores preservados). O único acoplamento Next da cadeia
  era `next/headers` no `server.ts` (só o caminho por cookie); o caminho Bearer agora carrega
  fora do runtime do Next.
- **Adapter in-process** `createInProcessHostTurnPort` ([in-process-host-turn.ts](../../apps/web/lib/resident-host/in-process-host-turn.ts)):
  constrói o cliente user-scoped do access token (`createBearerClient`) e roda a composition
  root. Fail-closed sem token; nunca lança; **NUNCA service_role**. Seams injetáveis p/ teste.
- **Loader `ts-resolve.mjs`** ([scripts/ts-resolve.mjs](../../apps/web/scripts/ts-resolve.mjs)):
  hook `module.registerHooks` ZERO-dependência que resolve imports TS relativos SEM extensão
  (`moduleResolution: bundler` do monorepo) → `node` puro carrega o grafo `@anima` sem bundler,
  junto de `--experimental-transform-types` (para parameter properties/enums que o strip-only
  não transforma). Descoberta: a cadeia de composição usa ZERO `@/` aliases — só `@anima/*`
  (resolvidos por node_modules/exports) e relativos.
- **Seleção de transporte** por `ANIMA_RESIDENT_TRANSPORT` (default `in_process`; `http`
  mantém a rota) em [scripts/resident-host.ts](../../apps/web/scripts/resident-host.ts); o
  adapter in-process entra por import dinâmico. `npm run local-host` agora roda com
  `--experimental-transform-types --import ./scripts/ts-resolve.mjs`.

## Provas

- `in-process-host-turn.test` **6/6** (mapeia resultado; constrói o cliente do TOKEN
  user-scoped e nenhum outro caminho; fail-closed sem token; nunca lança; propaga o signal).
- resident-host + host-turn + rota **95/95** (a rota refatorada permanece 6/6 — comportamento
  idêntico). typecheck dos **5 workspaces** PASS; `git diff --check` limpo.
- Re-export de `createBearerClient` verificado em runtime (request-auth + execute-commanded).

### Prova viva — Next DOWN (o ponto central)

Stack: **Supabase local + Ollama `qwen3-coder:latest` UP; Next dev DERRUBADO** (porta 3000
= `000`, verificado). Fixture descartável: usuário `resident-inproc-…@test.invalid`
(`8d5b2f7b-…`), item `ff2a8f99-37aa-4fde-9f7a-d57cb47d116f` (worktree/project:anima,
base_sha=`3a0018a`) criado→aprovado→classificado, pronto (`queue_position 1`,
`admitted=true costClass=local`).

`npm run local-host` (transport=in_process, autonomy=enabled, `maxTurnsPerCycle=1 maxCycles=1
maxIterations=2`) — SEM chamada manual à rota, COM Next fora. Telemetria real:

```
starting(transport=in_process) → reconcile → running → idle(stop/max_cycles_reached,
  cyclesExecuted=1) → [wake por poll] → reconcile → running → waiting_resource → stopped
```

O processo carregou `@anima/core`/`types`/`supabase` standalone (loader), assinou no GoTrue
como o usuário (**Bearer, sem service_role**), reconciliou e compôs a aplicação DIRETAMENTE.

Desfecho persistido (item `ff2a8f99`, `state=review`):
- **Verifier `verdict=verified`** — 7 checks, 0 gaps, 0 violations (3 attested + 4 independent).
- Gate `npm.cmd run typecheck --workspace=@anima/web` → `passed`, exit 0, 6766ms.
- Coder `ollama:qwen3-coder:latest`, 29495ms. Git observado: `insertions:1` (branch
  descartável, `observedCommitSha b4a94a…`).
- Bonus: 2ª iteração `waiting_resource` (Governor deferindo admissão ao vivo, sob carga).

**Integridade:** repo byte-intacto (`HEAD=3a0018a`, árvore limpa exceto `.worktrees/`);
worktree de execução `b4a94a` **DISCARTADA** (ausente de `git worktree list`); arquivo de
rascunho ausente do repo principal; `origin/main`=`99bec54` intacta; nada aceito/integrado.
Fixture PRESERVADA como evidência.

## Invariantes

Desfecho máximo `review`. Identidade user-scoped Bearer/`auth.uid()`/RLS — **sem
service_role** em nenhum transporte. SELEÇÃO/EXCLUSÃO server-side. Governor consultado
por-ciclo. A rota HTTP continua existindo (web/API/provas) mas NÃO é mais requisito do
resident host.

## Próximo ponto de retomada

1. **AUTO_EVENT_WAKE** — eliminar o polling como wake PRIMÁRIO: sinal (Supabase Realtime
   `work_events`/LISTEN-NOTIFY, o que já existir) → wake → reconcile → política decide.
   Fonte do wake ≠ fonte da decisão; coalescing; fallback timer como safety net. Prova viva:
   evento real (não stdin, não timer) causa a execução; `wakeSource` na telemetria.
2. Telemetria durável mínima (por que acordou, que item, por que parou, wakeSource).
3. Backlog canônico/documental → descoberta read-only → candidato tipado → materialização.
