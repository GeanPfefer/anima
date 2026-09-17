# 2026-09-09 — Anti-hang: timeout por-requisição no transporte HTTP do RunPod

- **Tipo:** desenvolvimento (fix + testes; sem prova viva paga — devolvido ao humano).
- **Branch:** `dev`. **HEAD inicial = HEAD final = `d783a5d`** (nada commitado; WIP preservado).
- **Continuação de** [2026-09-09-diagnosticabilidade-turn-not-executable.md](2026-09-09-diagnosticabilidade-turn-not-executable.md).
- **Objetivo:** após o patch de observabilidade, `npm run local-host` chegava a `state=running`
  e travava indefinidamente na PRIMEIRA host-turn (sem `idle`/`outcome`/`stopReason`/
  `notExecutableReason`). Descobrir qual `await` não retorna e torná-lo bounded.

## Causa raiz (comprovada por traço, sem rodar live)

`state=running` é emitido em [resident-host.ts:281](../../apps/web/lib/resident-host/resident-host.ts)
imediatamente antes de `await deps.runHostTurn(...)` — logo o hang está DENTRO da host-turn →
`runTurn` ([autonomous-backlog-deps.ts](../../apps/web/lib/work-orchestration/autonomous-backlog-deps.ts))
→ resolução de compute on-demand (RunPod).

**O `await` sem timeout:** [runpod-node-provisioner.ts](../../apps/web/lib/work-orchestration/runpod-node-provisioner.ts)
`fetchHttpClient.send` fazia `fetch(url, { signal })` **sem timeout por requisição**. TODAS as
chamadas externas do RunPod passam por ele: GraphQL price-quote (`runpod-price-quote.ts`), REST
`GET /pods`, `POST /pods`, polling `GET /pods/{id}` (`awaitEndpoint`), `GET /api/tags`
(`awaitModelReady`). Os laços de provisão TÊM deadline (`maxProvisionMs` 5min, `tunnelReadyTimeoutMs`
3min, `modelReadyTimeoutMs` 15min), **mas o deadline só é checado ENTRE requisições** — um único
`fetch` cuja conexão abre e o servidor nunca responde (clássico em cold-start de GPU) fica pendurado
para sempre, o laço nunca reavalia o deadline, e a host-turn nunca retorna. O túnel SSH
(`readinessTimeoutMs`/`ConnectTimeout` ~15s) e `externalHealth` (AbortController+timer 5s) JÁ eram
bounded — só o transporte cru não era. Ambiente: a chave RunPod agora responde 200 (após remover a
env antiga herdada), então o caminho entra DE FATO na provisão em vez de falhar rápido — expondo o buraco.

## Correção (root-cause, cirúrgica)

[runpod-node-provisioner.ts](../../apps/web/lib/work-orchestration/runpod-node-provisioner.ts):
`fetchHttpClient.send` agora compõe o `signal` do chamador com um `AbortController` que aborta no
teto `runpodHttpTimeoutMs()` (env `ANIMA_RUNPOD_HTTP_TIMEOUT_MS`, default 30_000, bounded) — o MESMO
padrão que `externalHealth` já usava, agora no transporte para TODA requisição herdar o limite.
Timeout → `fetch` aborta → exceção → o adapter traduz para `provider_unreachable` (ou o laço
reavalia seu deadline e devolve `capacity_unavailable`/`provision_failed`). A provisão inteira passa
a ser BOUNDED e o `runpod-price-quote.ts` herda o timeout automaticamente (usa o mesmo transporte).

**Timeout → refusal canônico observável (já ligado):** a razão de falha propaga por
`prepareResidentOnDemandCoderNode` → `notExecutable('coder_node_unavailable', 'Node on-demand
indisponível: <fase>.')` → `turn_not_executable` + `notExecutableReason` (patch anterior) →
`classifyResidentNext` → `idle`. A FASE que falhou fica na mensagem (`provider_unreachable` |
`capacity_unavailable` | `provision_failed` | `live_price:*`), então "a última etapa antes do hang"
é observável sem instrumentação extra. NÃO é retry infinito — cada teto devolve ao loop.

## Testes / gates

- `runpod-node-provisioner.test.ts`: **33/33 VERDE** (29 existentes + 4 novos anti-hang):
  requisição pendurada abortada dentro do teto (bounded, não pendura); requisição normal NÃO
  abortada (execução válida preservada); cancelamento do chamador compõe; teto default/override por
  env. Cobertura de "nunca resolve → razão canônica bounded" JÁ existia no nível do laço
  (`provision nunca pronto (deadline) → capacity_unavailable`); o fix fecha o buraco do request único.
- `runpod-price-quote` + `runpod-ssh-tunnel`: 13/13. `resident-on-demand-node`: 29/29.
- typecheck `apps/web`: 1 erro pré-existente/alheio (`p_attempt_id`, ver registro anterior); o
  arquivo alterado: 0 erros.

## Limitações / não feito (honesto)

- Boundei o transporte HTTP do RunPod (REST+GraphQL). Leituras Supabase
  (`readActivePaidComputeAuthorization`, `readEconomicHistory`, `client.from`) NÃO foram boundadas —
  não são a causa observada (rodavam rápido antes; realtime SUBSCRIBED ⇒ Supabase vivo) e bounda-las
  é mudança maior separada. Um teto de wall-clock na host-turn inteira foi DESCARTADO: teria de
  exceder o cold-start legítimo (~23min agregados) e arriscaria abortar provisão válida.
- Chave RunPod: o fix é AGNÓSTICO de auth — bounda o transporte independentemente de a chave ter
  WRITE. Não afirmo read-only; o estado real é observado ao vivo.

## Efeitos externos / bugs separados

- **Nenhum efeito externo:** sem commit/push/PR/migration/cloud/gasto/credencial; **nenhum Pod criado.**
- NÃO misturados (por instrução): `tools/dev-supervised.mjs` spawn EINVAL; `p_attempt_id` type WIP.

## Próximo ponto de retomada

Prova viva supervisionada pelo Gean com `npm run local-host`. A primeira host-turn agora ou
PROGRIDE (provisão OK) ou retorna bounded com `notExecutableReason={code:'coder_node_unavailable',
message:'Node on-demand indisponível: <fase>.'}` e o host volta a `idle` — nunca mais silêncio em
`state=running`. Se travar de novo, a fase estará na mensagem (ou é um await FORA do transporte
RunPod — ex.: Supabase — aí sim novo recorte).
