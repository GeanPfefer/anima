# Compute pago on-demand — envelope de segurança (lease, deadline, reconciler, teardown)

**Status:** subsistema de segurança implementado e provado SEM cloud/gasto. Torna uma futura
prova paga *bounded, recuperável, auditável e fail-closed*, para que uma autorização humana
posterior a libere sem depender de "lembrar de desligar a máquina". **Nenhuma chamada paga real
foi feita.**

Complementa o adapter em [`provisionamento-runpod-adapter.md`](provisionamento-runpod-adapter.md).

## 1. Fronteira `NodeProvisioner`

A porta `NodeProvisioner` (core) é a **única** de efeito externo: `provision` / `inspect` /
`stop` / `destroy` / `locate?`. Ela só *toca o recurso* — NÃO decide nada, NÃO gera evidência,
NÃO avalia autorização, NÃO agenda, NÃO reconcilia. Toda governança vive ACIMA. `RunPodNodeProvisioner`
é um adapter fino sobre a REST do RunPod; `LocalProcessNodeProvisioner` é a prova local.

## 2. Autorização de compute pago (capability, não config)

`evaluatePaidComputeAuthorization` (core) é fail-closed e valida o pedido contra a autoridade
humana: provider, node, resource class, work item, **duração ≤ maxDurationMs**, **custo ≤
maxCostEstimate** (ou exige estimativa), janela `validFrom..validUntil`, autoria `user`. Uma
autorização é ato **humano** persistido (`paid_compute_authorizations`, RPC `grant`/`revoke` só
`authenticated`; `service_role` consulta mas NÃO fabrica). Não é ampliável por configuração nem
inventável pelo executor. `necessidade de recurso ≠ autorização de gasto`.

## 3. Lease limitada pela autoridade

`deriveBoundedLease` (core) faz a autoridade ser **TETO DURO**: `leaseExpiresAt` =
min(agora + duração pedida, `validUntil`); `maxActiveDurationMs` = min(pedida, `maxDurationMs`).
A lease **nunca fatura além da janela concedida**; fail-closed se a janela já se esgotou. O fluxo
vivo (`prepareResidentOnDemandCoderNode`) deriva a lease paga daqui — nenhuma camada inferior
expande o teto.

## 4. Deadline / expiração

`evaluateLeaseStatus` (core) decide deterministicamente `active | expired(deadline|max_duration|
idle_timeout)`. O deadline é o `leaseExpiresAt` clampado à autoridade. O teardown ao fim é
garantido pelo reconciler (§5), não por um `finally{}` de caminho feliz nem por `setTimeout` em
memória.

## 5. Reconciler / recuperação de órfão

`projectReconcilableLeases` deriva do **log append-only** de evidência de lifecycle
(`record_host_observed_node_lifecycle`) as leases PAGAS ainda vivas (estado ≠ `offline`).
`decidePaidLeaseReconciliation` decide fail-closed. `reconcilePaidComputeLeases` (web) roda na
fase de **reconcile** do Resident Host (arranque + pós-wake, ANTES da volta ⇒ toda lease paga
viva é órfã): `locate(nodeId)` → decide → `stop`+`destroy` → evidência de teardown. Bounded,
idempotente, `retry_later` em indisponibilidade temporária (nunca abandona). `locate` reconstrói
o recurso pelo nome determinístico `anima-<nodeId>` — reset-safe. Além disso, o **`providerRef`
(id opaco do recurso no provider) é PERSISTIDO na evidência** a partir de `health_confirmed`
(nunca credencial): dá recovery/observabilidade por referência DIRETA e, em `confirm_offline`,
um `stop`/`destroy` por id como defesa em profundidade (encerra um recurso que a busca por nome
possa ter perdido; idempotente).

## 6. Teardown garantido e idempotente

`release` (idle) → `stop` (para o faturamento) → `destroy` (termina o recurso) →
`shutdown_confirmed` (evidência observada). `404` após stop/destroy = convergência já alcançada.
Replays são seguros (a projeção `offline` exclui do próximo ciclo; a RPC deduplica a evidência).
"Shutdown confirmado" só é registrado quando a Goma OBSERVA (locate ausente), nunca só porque uma
chamada foi enviada.

## 7. Crash recovery (provado sem cloud)

Prova viva (`paid-compute-lease-reconciler.test.ts`, provider fake **stateful** que sobrevive ao
crash): provision → evidência → CRASH (runtime descartado, pod segue faturando) → novo reconciler
descobre o órfão → desliga → provider vazio → convergiu `offline` → replay NÃO recria nem
re-derruba → nenhum segredo na evidência. Também: crash após stop antes de confirmar → converge.
"O processo morreu" **não** implica "o recurso pago ficou esquecido".

## 8. Evidência

Append-only via `host_observed_node_lifecycle_recorded` (autor `system`, origem `host`): node,
provider, lease, `providerRef`, transição, billing, `authorizationRef`, custo estimado, timestamps.
**Nunca** segredo, endpoint sensível ou payload externo bruto. A projeção
`projectPaidComputeAudit` (core puro) / `readPaidComputeAudit` (web, RLS) devolve um REGISTRO por
lease respondendo as perguntas do humano: quem autorizou (`authorizationRef`), qual node/provider/
`providerRef`, `startedAt`/`readyAt`/`shutdownRequestedAt`/`offlineAt`, `lastState`, `failed`,
`estimatedCost`, `outcome` (active|teardown_pending|terminated|failed) e **`orphanRisk`** (paga
ainda viva). Read-only, sem provider, sem segredo.

## 9. Hard limits × hints × observed

- **Hard limit** (determinístico, aplicado antes/durante): duração da autoridade (`validUntil`,
  `maxDurationMs`), provider/node/class permitidos, e **teto de custo** — a autorização pode
  carregar `maxCostEstimate`, conferido contra uma **ESTIMATIVA de custo PRÉ-provision**
  (`estimateLeaseCost(priceHint, maxActiveDurationMs)`) derivada de um `priceHint` **configurado
  pelo operador** (`ANIMA_ON_DEMAND_PRICE_PER_HOUR`, do catálogo do provider — sem chamada ao
  provider). Estimativa > teto → NEGA fail-closed; sem `priceHint` configurado, uma autorização
  COM teto de custo NEGA (`cost_estimate_required`); autorização só-temporal segue válida.
- **Estimate/hint**: `priceHint` e `estimateLeaseCost` — CLASSIFICAÇÃO derivada, nunca custo
  final imutável. Serve ao gate (limite superior conservador), não é o custo real.
- **Observed**: estado do lifecycle e alcançabilidade observados pela Goma (não auto-relato).
- **Ainda não garantido**: custo FINAL só o provider conhece a posteriori. A estimativa usa o
  preço CONFIGURADO (não uma consulta viva ao catálogo); se o preço real divergir, a estimativa
  pode ficar defasada — mas o gate é fail-closed contra o teto CONFIGURADO.

## 10. Riscos residuais

- **Janela create→health_confirmed:** o `providerRef` é persistido a partir de `health_confirmed`;
  um crash ENTRE criar o pod e esse primeiro evento deixa o órfão localizável só pelo nome
  (`locate anima-<nodeId>`), não por `providerRef`. Janela estreita e coberta por `locate`;
  fechá-la totalmente exigiria persistir o `providerRef` no exato instante do create (evento
  intermediário) — refinamento futuro de baixo retorno.
- **Host offline após expirar a autoridade:** se o host não roda, o reconciler não roda; o recurso
  pode faturar até o host voltar. Mitigação futura: TTL/idle-stop do lado do provider como
  belt-and-suspenders. O teardown local do fluxo vivo cobre o caminho normal.
- **Custo pré-provision:** a estimativa depende de um `priceHint` CONFIGURADO pelo operador
  (`ANIMA_ON_DEMAND_PRICE_PER_HOUR`), não de uma consulta viva ao catálogo do provider; um preço
  real divergente pode defasar a estimativa (o gate segue fail-closed contra o teto configurado).
  Consulta viva de preço por classe/GPU é refinamento futuro (exigiria um READ ao provider).
- **Concorrência residual da API externa:** `at-most-one` por nodeId é estabelecido pelo nome
  determinístico + list-before-create; janelas da API do provider convergem por reconciliação.

## 11. O que falta para a PRIMEIRA chamada paga real

Ver o preflight `assessPaidComputePreflight` (READ-ONLY / NO-SPEND): separa
`READY_FOR_HUMAN_PAID_AUTHORIZATION` (infra montada) de `PAID_EXECUTION_AUTHORIZED` (+ autorização
humana válida). Faltam, para a 1ª prova: API key real no host, imagem/GPU validadas no catálogo
RunPod, base REST vigente (v1 retira 2026-11-15), e **uma autorização paga humana bounded** (lease
curto + custo máximo).

## 12. Procedimento de emergência (recurso possivelmente órfão)

1. Rodar o Resident Host: a fase de reconcile derruba leases pagas órfãs automaticamente
   (`paid-lease-reconcile` no log). 2. Consultar o log de evidência por leases não-`offline`.
3. Se necessário, parar/terminar o recurso diretamente no console do provider pelo nome
   `anima-<nodeId>`. 4. A revogação da autorização (`revoke_paid_compute_authorization`) faz o
   próximo reconcile convergir para teardown.

## 13. Por que API key ≠ autoridade financeira

`ANIMA_RUNPOD_API_KEY` é **configuração de infraestrutura** (poder técnico de tocar o provider),
não **autoridade para gastar**. Mesmo com a key configurada, um node pago só provisiona sob uma
autorização humana válida no envelope; o preflight reporta `readyForHumanPaidAuthorization` sem
implicar `paidExecutionAuthorized`. `configuração ≠ autoridade`, `provider disponível ≠
autorização`, `priceHint ≠ custo final`.
