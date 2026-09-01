# Plano 005 — Provisionamento On-Demand V1

> Estado em 2026-08-30: primeiro recorte implementado e provado com processo local
> real; cloud real NÃO provisionada; nenhuma despesa externa realizada.

## Objetivo

Evoluir de "existe um endpoint remoto previamente configurado" ([Plano 004](004-execution-placement-v0.md))
para "quando um node remoto for necessário, o Anima possui um lifecycle governado para
disponibilizá-lo e desligá-lo de novo". A Goma continua sendo o ambiente principal; cloud é
apenas músculo computacional temporário, alugado por hora e desligável. O Anima **não** move
worktree, Git, gates, Verifier, banco nem Anima Web para o node remoto.

## Princípio econômico inegociável

`necessidade de recurso ≠ autorização de gasto`. Pressão de RAM nunca se converte
automaticamente em autorização financeira. O caminho autônomo não fabrica sua própria
autorização de compute pago — isso é sempre um ato humano explícito. Esta invariante já
existia no repo e foi preservada/estendida:

- `recovery-successor.ts`: um sucessor governado nunca introduz
  `financial_authorization|paid_compute|auto.?provision` (gap `financial_authority_introduced`).
- `autonomous-authorization.ts`: impacto `financial` está fora da classe auto-aprovável.
- Placement V0: `paidComputeAuthorized` permanecia `false` no caminho vivo por falta de gate
  financeiro canônico. Este plano cria o gate; o caminho vivo segue inalterado até o recorte
  de wiring (abaixo).

## Recorte implementado (core puro + prova controlada)

### Primitivas puras (`packages/core/src/work-orchestration`)

- **`node-lifecycle`** — máquina de estados mínima e geral:
  `offline → provisioning → ready → busy → idle → shutting_down → offline`, com falhas
  distintas `provision_failed` (não subiu), `health_failed` (subiu sem saúde ou caiu em uso)
  e `shutdown_failed` (stop falhou — node pode seguir custando). Idempotente por construção
  (dois polls que observam o mesmo estado não disparam dupla provisão) e fail-closed
  (transição fora da tabela é ilegal). Distingue node configurado / disponível / saudável /
  reservado / executando / desligável.
- **`paid-compute-authorization`** — autorização financeira fail-closed com proveniência:
  quem autorizou (humano), para qual provider/node/classe/trabalho, teto de duração e custo,
  validade temporal. Substitui o `boolean allowPaid` por decisão determinística. Node não-pago
  dispensa autorização; node `paid` exige autorização humana compatível ou fica negado.
- **`node-lease`** — envelope temporal V0: duração ativa máxima, idle timeout, prazo absoluto,
  correlação de trabalho/tentativa, referência de autorização (obrigatória para `paid`) e
  price hint opcional. `evaluateLeaseStatus` dá a resposta determinística "este node deve
  seguir ativo?"; `estimateLeaseCost` deriva custo (nunca inventa) quando há price hint.
- **`node-provisioner`** — contrato provider-agnóstico (`provision`/`inspect`/`stop`/`destroy?`).
  Só a porta e seus tipos; nenhuma API real. A mesma porta servirá VM/GPU cloud, Wake-on-LAN,
  PC da rede ou datacenter sem mudar placement.
- **`provisioning-decision`** — separa placement de provisionamento: **depois** que o placement
  decide "remote", esta camada decide `execute | provision | await_provisioning |
  waiting_authorization | defer`, subordinada à autorização e ao estado do lifecycle.
  `decideCoderPlacement` segue sendo só decisão — nunca cria servidores.
- **`node-lifecycle-evidence`** — evidência host-observed V1 (a Goma é a fonte da saúde/custo,
  não o node): transição, health, duração ativa, billing, referência de autorização, custo
  estimado, correlação. `build`/`parse`/`project` fail-closed.

### Prova controlada sem cloud paga (`apps/web/lib/work-orchestration`)

- **`local-process-node-provisioner`** — implementa `NodeProvisioner` iniciando um **processo
  real** local (não mock puro): sobe um endpoint, health-check por HTTP de fora, teardown por
  sinal com espera do exit. Modos de falha injetáveis para as provas negativas.
- **`provisioning-on-demand-v1.test`** — atravessa o lifecycle completo pela MESMA interface
  que um provider real usará: `offline → provision (processo real) → ready → placement remoto
  confirmado → coder REAL no endpoint → Goma aplica a operação no Git, checkpoint e gate real →
  idle → stop → offline`, com evidência host-observed preservada e a workspace original
  intocada. Recovery: `provision_failed` sem auto-retry (sem laço de gasto), `health_failed`
  com teardown ainda possível, `shutdown_failed`, idempotência de provisão e lease expirado
  forçando shutdown.

## Fronteiras preservadas

Worktree, filesystem, Git, aplicação das operações, scope/stale enforcement, checkpoint,
gates, Verifier, state machine, banco e Anima Web permanecem na Goma. Compute pago permanece
fail-closed no caminho vivo. Nenhuma cloud real, VM/GPU, deploy, merge, credencial ou gasto.

## Gaps registrados para a evolução (próximos recortes)

1. **Persistência da evidência de lifecycle.** Falta o `work_event_type`
   `host_observed_node_lifecycle_recorded` + RPC host-observed + migration/RLS + regeneração
   de tipos. `projectNodeLifecycleEvidence` já está pronto e desacoplado do enum até lá.
2. **Persistência da autorização financeira.** A `PaidComputeAuthorizationV1` é pura; falta a
   tabela/RPC autenticada (autoria humana `user`, RLS, sem `service_role`) que a materializa,
   e a UI pela qual o humano a concede. Só então o caminho vivo pode ler uma autorização real.
3. **Wiring vivo.** `autonomous-backlog-deps.ts` ainda injeta `paidComputeAuthorized=false`.
   Ligar `decideCoderProvisioning` + provisioner + lease ao Resident Host é o próximo recorte,
   preferindo primeiro um node **não pago** (owned) provisionado on-demand.
4. **Prova viva** pelo Resident Host com Ollama real em segundo processo/túnel, ainda pendente
   desde o Plano 004.

## Comparação de providers reais (investigação — NÃO provisionar ainda)

Critérios: cobrança por hora/minuto; GPU/RAM adequadas ao `qwen3-coder` (30B-A3B, ~19 GB;
confortável em 24 GB VRAM, viável em 16 GB); boot rápido; API de start/stop; storage/model
caching; custo previsível; sem lock-in arquitetural. Latência não é prioridade (coder é
assíncrono).

| Provider | Cobrança | GPU/RAM p/ qwen3-coder | Start/stop API | Model cache | Boot | Lock-in | Nota |
|---|---|---|---|---|---|---|---|
| **RunPod** | por segundo | RTX 4090/A5000 24 GB baratos | sim (REST + SDK) | network volume persistente | rápido (pods) | baixo (Docker) | Forte candidato V0: barato, volume p/ cache, start/stop limpo |
| **fly.io Machines** | por segundo | A10/L40S | sim (Machines API start/stop) | volumes | muito rápido (máquinas param, não destroem) | baixo | Bom p/ "servidor que liga/desliga"; região flexível |
| **Vast.ai** | por hora (spot) | mercado, 16–24 GB muito barato | sim (CLI/API) | depende do host | médio | baixo | Mais barato, confiabilidade variável (marketplace) |
| **Lambda Cloud** | por hora | A10/A100 | sim (API) | disco da instância | médio/lento | baixo | Simples, mas granularidade horária encarece bursts curtos |
| **Modal** | por segundo | serverless GPU | serverless (sem gerência de node) | volumes/imagem | cold-start ótimo | médio (SDK Python) | Excelente ergonomia, porém modelo serverless ≠ node com lifecycle explícito |
| **AWS EC2 g5** | por segundo (após 1º min) | A10G 24 GB | sim (API pesada) | EBS/snapshot | boot lento | médio | Poderoso, porém API/IAM pesados p/ o V0 |

**Recomendação para quando houver autorização:** começar por **RunPod** (por segundo,
network volume para cache do modelo, start/stop simples, custo previsível) ou **fly.io
Machines** (semântica start/stop de "node que liga e desliga"). Ambos preservam o contrato
`NodeProvisioner` sem mudar placement. **Nenhum provider será provisionado sem autorização
financeira explícita e separada.**

## Definição de sucesso (V1)

`remote needed → node offline → lifecycle governado → autorização/policy validada → node
iniciado → health ready → coder remoto executa → resultado volta à Goma → node desligado →
evidence preservada`, sem mover worktree/Git/gates/Verifier/banco/Anima Web. O recorte atual
prova essa cadeia com um processo local real; falta a prova com provider pago (bloqueada por
autorização financeira persistida, deliberadamente).

## Teto agregado por autorização (2026-08-31)

`maxCostEstimate` passou a significar **teto agregado da autorização**, não teto independente
por request. O write gate autoritativo é `reserve_paid_compute_budget`: numa transação, bloqueia
a linha da autorização, revalida owner/status/validade/escopo/moeda, soma o ledger append-only e
grava uma reserva idempotente antes do provider. Nova lease usa nova chave; replay da mesma lease
recupera a reserva. Autorizações históricas sem teto continuam legíveis/revogáveis, mas não
admitem compute pago; novas concessões exigem teto positivo.

Reservas permanecem comprometidas após término normal, falha ambígua ou crash. `voided` só é
permitido com prova de `provider_not_called` ou `provider_rejected_before_create`; não representa
reembolso nem custo final. A auditoria de Configurações projeta teto, reservado, anulado,
comprometido e restante, mas não participa da decisão (`READ MODEL != WRITE GATE`). Cloud paga e
primeira prova paga permanecem fora do escopo.

## Teardown independente e ausência comprovada (2026-08-31)

O signal cancelável da execução não governa mais o cleanup de um recurso conhecido. Teardown
imediato e reconciler usam signal próprio e timeout bounded; o watchdog da lease continua
best-effort e o reconciler durável é a segunda linha de defesa após crash/restart. Providers cuja
porta expõe `destroy` só convergem para `offline` depois de `stop + destroy`; falha ou timeout em
qualquer etapa preserva `shutdown_failed`/recovery elegível. Para RunPod, a documentação oficial
confirma que `stop` libera GPU, mas mantém o Pod e pode manter cobrança de storage, portanto não é
prova de ausência. Nenhuma garantia de TTL provider-side foi assumida ou implementada.
