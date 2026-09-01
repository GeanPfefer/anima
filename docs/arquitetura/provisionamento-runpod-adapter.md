# Adapter RunPod — primeiro provider real atrás da porta `NodeProvisioner`

**Status:** implementado, testado e integrado em modo **env-gated / test-only**. NÃO chama a
cloud durante os testes e é **incapaz de gerar gasto** sem env-gate + autorização humana paga
válida. O `NodeProvisioner` continua sendo a **única porta de efeito externo**; lifecycle,
lease, evidência e autorização vivem FORA do adapter.

Fonte: `apps/web/lib/work-orchestration/runpod-node-provisioner.ts`
(contrato em `packages/core/.../node-provisioner.ts`).

## Variáveis de ambiente

Seleção do burst on-demand (já existentes):

| Var | Efeito |
|---|---|
| `ANIMA_ON_DEMAND_NODE_ENABLED=true` | liga o burst on-demand (default OFF) |
| `ANIMA_ON_DEMAND_NODE_PROVISIONER=runpod` | escolhe o adapter RunPod (ou `local-process`) |
| `ANIMA_ON_DEMAND_NODE_ID=<slug>` | id lógico do node |
| `ANIMA_ON_DEMAND_NODE_BILLING_MODE=paid` | **obrigatório** para RunPod (compute pago) |
| `ANIMA_ON_DEMAND_NODE_RESOURCE_CLASS=<classe>` | classe de recurso (correlação/autorização) |

Config do adapter RunPod (a **API key só vem daqui**; nunca banco/log/UI):

| Var | Default | Efeito |
|---|---|---|
| `ANIMA_RUNPOD_API_KEY` | — (fail-closed) | credencial do control-plane; só header `Authorization` |
| `ANIMA_RUNPOD_IMAGE` | — (fail-closed) | imagem do container (ex.: `ollama/ollama:latest`) |
| `ANIMA_RUNPOD_GPU_TYPE_IDS` | — (fail-closed) | lista separada por vírgula (ex.: `NVIDIA A40`) |
| `ANIMA_RUNPOD_API_BASE` | `https://rest.runpod.io/v1` | base da REST API (v1 até 2026-11-15; configurável p/ v2) |
| `ANIMA_RUNPOD_GPU_COUNT` | `1` | GPUs por pod |
| `ANIMA_RUNPOD_CLOUD_TYPE` | `SECURE` | `SECURE`\|`COMMUNITY` |
| `ANIMA_RUNPOD_CONTAINER_DISK_GB` | `50` | disco efêmero |
| `ANIMA_RUNPOD_VOLUME_GB` | `0` | volume persistente |
| `ANIMA_RUNPOD_NETWORK_VOLUME_ID` | — | volume de rede p/ cache de modelo |
| `ANIMA_RUNPOD_INFERENCE_PORT` | `11434` | porta HTTP de inferência exposta |
| `ANIMA_RUNPOD_HEALTH_PATH` | `/` | caminho do health-check externo |
| `ANIMA_RUNPOD_POD_ENV_JSON` | `{}` | env estático do pod (JSON) — **nunca** a API key |

Sem `API_KEY`/`IMAGE`/`GPU_TYPE_IDS` a config é `null` (fail-closed) e o burst nem é admitido.

## Contrato / estados

- **provision(req)** → `GET /pods` (idempotência por nome `anima-<nodeId>`: reusa pod
  não-terminal, NÃO cria segundo) → se ausente `POST /pods` → poll `GET /pods/{id}` até
  `RUNNING` com endpoint resolvível → `ProvisionedNodeHandle{ providerRef=<podId>, endpoint }`.
- **inspect(handle)** → `GET /pods/{id}` (status do provider) **E** health-check EXTERNO ao
  endpoint real (a Goma não confia só no provider). `reachable` = provider RUNNING; `healthy`
  = endpoint respondeu 2xx.
- **stop(handle)** → `POST /pods/{id}/stop` (libera GPU, mas preserva o Pod e pode manter cobrança
  de storage). `404` = idempotente (nada a parar).
- **destroy(handle)** → `DELETE /pods/{id}`. `404` = idempotente (já destruído).

Endpoint resolvido: `http://<publicIp>:<portMapped>` quando há exposição TCP; senão a convenção
de proxy HTTP do RunPod `https://<podId>-<port>.proxy.runpod.net`.

`providerRef` (pod id) é suficiente para `stop`/`destroy` após restart do host.
Como a lease on-demand não declara intenção de manter capacidade aquecida, seu término normal é
`stop` seguido de `destroy`; só ambos (ou 404 idempotente) comprovam ausência do Pod.

## Erros (códigos estáveis, sem vazar payload)

`auth_invalid` (401/403) · `quota_exceeded` (402 / "insufficient/balance") ·
`capacity_unavailable` ("no available GPUs" / deadline sem endpoint) · `rate_limited` (429) ·
`provider_unreachable` (5xx / rede) · `provision_failed` (4xx genérico) · `stop_failed`.
A API key é **redigida** de qualquer mensagem; nenhum `reason`/`detail` carrega segredo.

## Limite de confiança

- Credencial: só via env, só em memória, só no header. Nunca persistida, logada ou em evidência.
- A Goma faz o health-check EXTERNO; o status do provider sozinho não leva a `ready`.
- O adapter NÃO decide nada (não avalia autorização, não gera evidência) — só toca o recurso
  quando já foi permitido pelas camadas de fora.
- RunPod só é elegível sob `billingMode=paid` (passa pelo gate financeiro humano) + API key +
  autorização paga válida. `owned` com RunPod é recusado (não se aluga cloud sem gasto autorizado).

## O que falta para a PRIMEIRA chamada real (ainda não feita)

1. Provisionar uma API key RunPod real em `ANIMA_RUNPOD_API_KEY` (só no ambiente do host).
2. Definir imagem/GPU/volume reais e validar contra o catálogo atual do RunPod (gpuTypeIds).
3. Confirmar a base da REST API vigente (v1 retira 2026-11-15; migrar p/ v2 quando publicada).
4. Uma autorização paga **humana** válida referenciando provider `runpod` + node + resource class.
5. Uma primeira prova paga BOUNDED (lease curto + custo máximo) com teardown garantido.

## Checklist de autorização financeira ANTES do primeiro gasto

- [ ] Autorização paga concedida por humano (UI de Configurações) para provider `runpod`.
- [ ] Envelope: node/resource class compatíveis, `maxDurationMs` curto, `maxCost` definido.
- [ ] `ANIMA_ON_DEMAND_NODE_BILLING_MODE=paid` e a autorização válida na janela de tempo.
- [ ] Lease com `authorizationRef` presente (invariante: pago exige referência de autorização).
- [ ] Teardown/`stop` garantido pelo lease (idle/max_duration/deadline) — nunca máquina esquecida.
- [ ] Observabilidade do custo (priceHint) tratada como HINT, nunca como gate; o gate é a autorização.
