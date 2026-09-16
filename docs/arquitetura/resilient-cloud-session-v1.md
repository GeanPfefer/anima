# Resilient Cloud Session V1 — reprovisionamento governado + settlement

Status: contrato, mecanismo e wiring vivo implementados e verdes; **sem prova viva** (nenhum Pod
criado nesta sessão). A próxima ação é um único GO humano para a prova consolidada. Complementa
[`provisionamento-lease-seguranca.md`](provisionamento-lease-seguranca.md),
[`orquestracao-de-trabalho.md`](orquestracao-de-trabalho.md) e o registro
[`2026-09-10-runpod-readiness-camadas-e-barreira-endpoint-unpublished.md`](../registros/2026-09-10-runpod-readiness-camadas-e-barreira-endpoint-unpublished.md).

## Problema

Até aqui, uma volta cloud provisionava **uma** máquina; qualquer falha (inclusive
`endpoint_unpublished` — Pod `RUNNING` mas endpoint SSH nunca publicado na janela) **terminava a
execução inteira**. E a reserva conservadora do ledger (o teto da lease, ex.: 30 min) virava
`committed` integral sem **settlement** do excesso, reduzindo artificialmente o budget. Para uma
próxima prova consolidada, uma autorização humana deve abrir uma **sessão resiliente**: o Anima
troca de máquina/GPU sozinho, dentro do envelope, até obter um Pod saudável — e liquida o custo real
de cada máquina que descartou.

A escolha **CLOUD × LOCAL × API de terceiros continua HUMANA**. A troca de **máquina/placement
DENTRO de cloud self-hosted** é autônoma, sempre dentro do envelope já autorizado.

## 1. Classificação de falha de machine provisioning

`classifyCloudProvisionFailure(reason)` (core, puro, fail-closed) mapeia a razão do
`ProvisionOutcome`/preparação para uma disposição de sessão:

| razão | classe | disposição | exclui placement? |
|---|---|---|---|
| `endpoint_unpublished` | `endpoint_publication_timeout` (D) | `reprovision` | sim |
| `capacity_unavailable` | `candidate_capacity_absent` (A) | `reprovision` | sim |
| `health_failed`, `provision_failed` | `placement_unhealthy` (C) | `reprovision` | sim |
| `provider_unreachable`, `rate_limited` | `provider_unavailable` (B) | `halt_provider_unavailable` | não |
| auth/quota/identidade/**desconhecido** | `non_recoverable` | `halt_terminal` | não |

`endpoint_unpublished` após `RUNNING` deixa de colapsar em `capacity_unavailable`: é **placement
recuperável** enquanto houver outro recurso elegível e budget. Só razões **provadamente**
recuperáveis reprovisionam (allowlist); o desconhecido é terminal (não queima budget em retry cego).

## 2. Reprovisionamento dentro da MESMA sessão

`runResilientCloudSession` (web, composição sobre portas injetáveis — não cria Pod, não gasta, não
persiste por si) dirige o loop:

```
selecionar candidato (matcher − placements excluídos)
  → planner puro decide provisionar × parar
    → attemptProvision (UMA máquina; reserva+provisiona; em falha LIQUIDA e faz teardown ANTES de retornar)
      → sucesso: DEVOLVE o Pod saudável ao caller (coder/gates/Verifier/review) — NÃO reprovisiona
      → falha:   classifica; exclui o placement se recuperável; relê committed (settlement já
                 liberou o excesso) e tenta o próximo candidato
```

`planNextCloudSessionAction` (core, puro) aplica as barreiras nesta ordem — **governança real
precede a rede defensiva**:

1. última falha terminal → `terminal_failure`;
2. provider global fora → `provider_unavailable` (não martelar);
3. deadline da sessão vencido → `session_deadline_reached`;
4. sem candidato elegível → `no_more_candidates`;
5. teto de custo (fail-closed): estimativa ausente → `cost_estimate_unavailable`; moeda divergente
   → `currency_mismatch`; `committed + estimativa > teto` → `session_budget_exhausted`;
6. rede defensiva de tentativas → `attempt_limit_reached`;
7. caso contrário → **provision**.

O bound principal é **governança**: custo total, duração da sessão, candidatos disponíveis, saúde do
provider. O contador de tentativas (`DEFAULT_MAX_PROVISION_ATTEMPTS=16`) é só **rede defensiva** —
numa sessão pequena o esgotamento de candidatos (`no_more_candidates`) para antes.

## 3. Um Pod por vez / reutilização do Pod saudável

O loop é **sequencial** e `attemptProvision` só retorna **depois** do teardown do Pod que falhou —
`maxConcurrentNodes` é **fixo em 1**; nunca há dois Pods simultâneos. Ao obter endpoint→TCP→SSH→túnel
saudável, o orquestrador **DEVOLVE** o runtime + `finish` e **não reprovisiona**: o mesmo Pod serve
Ollama→qwen3-coder→health→attempt→coder→gates→Verifier→review.

## 4. Deadline de publicação do endpoint (política explícita)

`endpointPublicationDeadlineMs` (provisioner) é a janela para o Pod, uma vez `RUNNING`, publicar
`publicIp`+porta 22. **Separado** de `tunnelReadyTimeoutMs` (TCP+ssh) e `tcpProbeTimeoutMs` (por
sonda). Env `ANIMA_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS` (precede o legado
`ANIMA_RUNPOD_MAX_PROVISION_MS`, mantido como alias retrocompatível).

**Default 540000 ms (9 min), justificado pela evidência 2026-09-10**: uma máquina publicou endpoint
em ~minutos e chegou ao TCP; outra ficou `RUNNING` sem mapping por toda a janela de 300s. O tempo de
publicação **varia por máquina** — 300s condena máquinas lentas-porém-boas; 540s dá folga
conservadora sem imobilizar a sessão. Crucialmente, **estourar o deadline HABILITA
reprovisionamento** (`endpoint_unpublished` → placement recuperável), não termina a sessão.

## 5. Settlement do ledger (append-only)

Cada reserva tem ciclo `reserved → (voided | settled)`. O evento `settled` grava `amount = EXCESSO
LIBERADO (R − S)` e `reason = cost_source` (`estimated` | `provider_confirmed`). O custo liquidado
S é derivável (`reserved.amount − settled.amount`). Logo:

```
committed = Σ reserved − Σ voided − Σ settled(excesso) = Σ_aberta R + Σ_liquidada S
```

- `settleNodeLeaseCost` (core, puro): S por tempo — custo confirmado do provider (source
  `provider_confirmed`, clampado a R) OU estimativa `preço/h × vida faturável` arredondada **para
  cima** (source `estimated`). Invariantes: `0 ≤ S ≤ R`; excesso `= R − S ≥ 0`; sem preço utilizável
  → conservador (mantém R, não inventa número menor).
- RPC `settle_paid_compute_budget_reservation` (migração `20260910000001`): write gate humano
  (role `authenticated`; `service_role` REVOGADO), serializa na linha da autorização, idempotente
  por reserva, impõe `0 ≤ S ≤ R`, bloqueia settle de reserva anulada e void de reserva liquidada.
  **NÃO exige autoridade vigente** — liberar excesso / registrar custo real é seguro pós-hoc.
- `reserve_paid_compute_budget` recompilada subtrai o excesso liberado do committed → o budget
  liberado reabre o envelope para a próxima máquina da sessão.

`estimated` vs `provider_confirmed` são distinguidos e auditáveis (`listPaidComputeBudgetAudit`
expõe `settledExcess`, `settledCost`, `costSource` por reserva).

### Não retroeditar histórico

O mecanismo permite settlement tardio de reservas antigas (append-only, seguro). **Não** aplicamos
settlement retroativo às duas reservas históricas (`94641959`+`0a85dc0f`) nesta sessão — só o
mecanismo foi implementado/testado. As execuções anteriores permanecem intactas.

## 6. Session budget

O teto financeiro cobre a **sessão**, não uma máquina. Dentro do envelope: Pod A falha endpoint →
teardown → **settlement** do custo parcial → committed cai → ainda há budget → Pod B permitido. Não
se reserva 30 min integralmente como committed por tentativa.

Envelope recomendado para a próxima prova (`deriveCloudSessionEnvelope`): `provider=runpod`,
`strategy=cloud_self_hosted`, `minimumVramGiB=24`, `cuda`, `maxNodes=1`, `maxHourlyPrice=US$0,55`,
teto agregado de **sessão** ≥ soma do custo real esperado de ~2–3 máquinas descartadas + 1 saudável.

## 7. Observabilidade de sessão

`runResilientCloudSession` devolve `cloudSessionId` + `trace[]` (por tentativa: placement,
`providerRef`, desfecho, `failureClass`, `settledCost`), reconstruindo o arco
`candidate 1 → providerRef 1 → endpoint timeout → teardown → settlement → candidate 2 → … → review →
final teardown`. Reutiliza o correlation id da autoridade/lease; **não** cria sistema paralelo.

## 8. REST v1 — dívida técnica

RunPod REST v1 tem aposentadoria indicada para **2026-11-15**. Não migramos para v2 agora. O
`endpointPublicationDeadlineMs` é o único lever de readiness in-API disponível na v1 (ela não expõe
sinal mais fino além de `publicIp`/`portMappings`). Toda a integração de transporte permanece atrás
do adapter `HttpClient` injetável — trocar v1→v2 é local ao provisioner, sem acoplar a governança.

## Wiring vivo (próximo GO) — o que acontece automaticamente

O orquestrador está pronto contra portas; o adapter vivo compõe as peças já existentes em
`resident-on-demand-node.ts`:

- `selectNextCandidate(excluded)` = `planCloudResourceProvisioning` sobre o inventário read-only,
  filtrando os `placementId` (`providerId:gpuTypeId`) já excluídos;
- `attemptProvision` = reserva no ledger (`reservePaidComputeBudget`) → provisão canônica (a lógica
  hoje em `prepareResidentOnDemandCoderNode`) → em falha: mede a vida faturável, `settleNodeLeaseCost`
  → `settlePaidComputeBudgetReservation` → teardown (`teardownKnownNode`) ANTES de retornar;
- `readCommittedCost` = projeção do ledger para a autoridade ativa.

Depois do próximo GO humano, **uma** autorização de sessão produz: escolha de recurso → cria Pod →
se não publicar endpoint no deadline: classifica placement recuperável, teardown, **settlement**
(committed vira custo real), escolhe outra máquina elegível, **continua a MESMA sessão** — até um Pod
saudável, então avança até coder/gates/Verifier/review nesse mesmo Pod. Sem nova autorização humana
por Pod intermediário; sempre com 1 Pod por vez e dentro do teto de custo/tempo da sessão.
