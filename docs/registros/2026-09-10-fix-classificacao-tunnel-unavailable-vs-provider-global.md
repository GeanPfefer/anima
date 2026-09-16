# 2026-09-10 — Fix de classificação: falha de túnel/endpoint POR-PLACEMENT ≠ indisponibilidade GLOBAL do provider (Resilient Cloud Session V1)

## Objetivo
Corrigir a semântica exposta pela prova viva do mesmo dia (ver `2026-09-10-prova-viva-resilient-cloud-session-fix-reserve-jwt-role.md`): um `openTunnel=null` (Pod já criado, REST alcançável, mas mapping/TCP/SSH/túnel daquela máquina não ficou utilizável) era convertido em `provider_unreachable` GLOBAL → `halt_provider_unavailable`, parando a sessão sem tentar os demais candidatos. Sem prova paga, sem Pod, sem provider write.

## Branch / HEAD
- `dev` @ `d783a5d` (inalterado). `origin/main` `99bec54` intacta. Nenhum commit/push/stash/reset. WIP preservado.

## Causa semântica exata
`RunPodNodeProvisioner.provision()` fazia `if (endpoint === null) return { reason: 'provider_unreachable' }`. Mas quando `openTunnel` retorna null, o Pod JÁ EXISTE e a REST do provider respondeu durante toda a espera (o próprio loop `getPod` reconsulta o provider a cada iteração). É falha DE PLACEMENT/MÁQUINA (mapping oscilou `mapping_absent`, TCP não roteou `tcp_unreachable`, `ssh` não subiu `ssh_not_ready`, ou o Pod terminou `resource_gone`) — recuperável trocando de máquina/SKU. `provider_unreachable`/`halt_provider_unavailable` deve ser reservado à indisponibilidade GLOBAL da API, que o adapter já emite SOMENTE nos sites de chamada REST (`findPodByName`/`createPod`/`getPod`/`stop`/`destroy`) em erro de rede.

## Mudança (mínima, cirúrgica)
1. `apps/web/lib/work-orchestration/runpod-node-provisioner.ts`
   - Novo membro em `RunPodErrorCode`: **`tunnel_unavailable`** (doc: Pod criado + REST alcançável, mas túnel da máquina inutilizável; falha de placement, não global).
   - `provision()`: `openTunnel=null` agora retorna `{ reason: 'tunnel_unavailable' }` (era `provider_unreachable`). Comentário explica que a evidência GLOBAL vem dos sites REST, não de uma falha de túnel; se a REST estivesse fora, o próximo `createPod` desta sessão devolveria `provider_unreachable` e a sessão daria HALT ali.
2. `packages/core/src/work-orchestration/cloud-session.ts`
   - `RECOVERABLE_PLACEMENT += ['tunnel_unavailable', 'placement_unhealthy']` → `disposition: reprovision`, `excludePlacement: true`. `provider_unreachable`/`rate_limited` permanecem em `PROVIDER_UNAVAILABLE` (HALT).

`ProvisionOutcome.reason` é `string` ⇒ mudança type-trivial; nada a jusante switch-exhaustivo sobre a união.

## Casos cobertos (conforme pedido)
1. endpoint nunca publicado → `awaitEndpoint` → `endpoint_unpublished` (recoverable) — inalterado.
2. mapping aparece e some → `openTunnel` `mapping_absent` → `tunnel_unavailable` (recoverable). ✔ novo
3. TCP nunca roteável → `openTunnel` `tcp_unreachable` → `tunnel_unavailable` (recoverable); "evidência global" continua vindo dos sites REST. ✔ novo
4. `ssh` não fica pronto → `openTunnel` `ssh_not_ready` → `tunnel_unavailable` (recoverable). ✔ novo
5. REST/API RunPod global fora → `provider_unreachable` nos sites de chamada → `halt_provider_unavailable` (HALT sem hammer) — inalterado.
6. Pod healthy → não destrói; segue SSH→tunnel→Ollama→qwen3-coder→attempt→coder→gates→Verifier→review — inalterado.

## Testes
- `packages/core/.../cloud-session.test.ts`: novo teste `tunnel_unavailable → placement_unhealthy, reprovision, excludePlacement` (core 23/23).
- `apps/web/.../runpod-node-provisioner.test.ts`: os 2 testes de `openTunnel`-falho (túnel throw; TCP `timeout`) passam a esperar `tunnel_unavailable` (nomes/comentários atualizados).
- `apps/web/.../resilient-cloud-session.test.ts`: novo teste 2b — `tunnel_unavailable` na 1ª → teardown → **rotaciona para o 2º candidato (runpod:RTX_A6000) → healthy**, `attempts=2`, NÃO halt.
- `apps/web/.../paid-compute-lease-reconciler.test.ts`: consertado hang PRÉ-EXISTENTE (fake `statefulRunpod` sem stub de `tcpProbe` fazia connect REAL ao IP fake contra deadline real após a readiness-em-camadas do commit `37cf35f`; agora `tcpProbe: { probe: async () => 'reachable' }`). Ortogonal à classificação — provou que os 2 timeouts NÃO eram desta mudança.
- `prepare-resilient-cloud-session.test.ts` #6 (`provider_unreachable`, `podCreated:false`) segue HALT — intacto.

## Validação
- core typecheck PASS; web typecheck **PASS (0 erros)** — a barreira "generated-types-vs-WIP" não reincide no WIP atual.
- core `cloud-session` 23/23; web provisioner+resilient(+integration) 69/69; **web `work-orchestration` sweep completo 1082/1082 (89 suítes)**.
- `git diff --check`: só avisos CRLF pré-existentes. pgTAP: não afetado (sem mudança SQL; migration `000003` intacta e preservada).

## Resposta às perguntas
- **Um `mapping_absent`/tunnel failure agora rotaciona para RTX 3090/A6000/etc.?** SIM — provado por unidade (classificação) e composição (sessão rotaciona para o próximo candidato em vez de HALT).
- **Prontos para nova prova paga?** Sim do ponto de vista de CÓDIGO (verde). Gasto continua sendo FRONTEIRA HUMANA (novo GO). A barreira de INFRA do RunPod SECURE (publicação/estabilidade de endpoint/22) persiste; a diferença é que agora a sessão dá a cada SKU elegível uma chance e só para em `no_more_candidates` (terminal honesto) — nunca mais HALT global prematuro por um túnel ruim de uma máquina.
- **Git/WIP:** dev@d783a5d, origin/main 99bec54 intacta, WIP preservado; mudanças nos arquivos do WIP + registro aditivo.

## Efeitos externos
- Realizados: nenhum externo (sem Pod, sem provider write, sem gasto). Só edições de código/teste locais + este registro.
- NÃO realizados: prova paga; commit/push; toque em origin/main; reset/stash/drop de WIP; regressão da correção robusta de role (`000003` intacta).
