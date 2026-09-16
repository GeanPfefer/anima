# Plano 005 — Provisionamento On-Demand V1

> Estado em 2026-08-30: primeiro recorte implementado e provado com processo local
> real; cloud real NÃO provisionada; nenhuma despesa externa realizada.

> Atualização 2026-09-08: bootstrap RunPod, transporte SSH privado e health Ollama semântico
> implementados e provados localmente (76/76). A prova viva permanece bloqueada antes do provider
> por ausência de credencial/identidade SSH e de autorização paga com teto numérico para o work
> item canônico. Ver `docs/registros/2026-09-08-runpod-autoprovisionamento-barreira-pre-provider.md`.

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

## Fechamento local da Resilient Cloud Session V1 — 2026-09-10

O caminho vivo agora usa `prepareCloudCoderNode`: com
`ANIMA_RESILIENT_CLOUD_SESSION=true`, RunPod pago entra na sessão resiliente; com o gate OFF, modos
owned/local e a tentativa única permanecem compatíveis. A próxima prova configura duas tentativas
por SKU (`ANIMA_RESILIENT_CLOUD_MAX_ATTEMPTS_PER_PLACEMENT=2`) e mantém 16 como rede defensiva
finita, subordinada a `maxNodes=1`, custo agregado, validade e deadline da sessão. A identidade
pré-create mais fina continua sendo `gpuTypeId`; não se inventa machine id.

A migration `20260910000001_paid_compute_budget_settlement.sql` está aplicada localmente. O store
usa a RPC tipada, authenticated/RLS, sem `service_role`. Testes provam settlement idempotente,
limites, exclusividade void/settle e late settlement após expiração ou revogação. O Pod saudável é
devolvido ao pipeline e não é destruído até coder, gates, Verifier e review terminarem; qualquer
desfecho chama `finish` em `finally`, liquida e derruba o mesmo `providerRef`. Nenhum Pod foi criado
nesse fechamento. Registro: `docs/registros/2026-09-10-fechamento-resilient-cloud-session-v1.md`.

## Retomada Cloud GPU Test #2 — 2026-09-09

O túnel de produção foi provado em Pod mínimo real: processo SSH vivo, listener loopback e TCP
local passaram; a falha HTTP foi a ausência deliberada de Ollama. O manager agora separa
`processAlive` de `listenerReady`, captura diagnóstico bounded, preserva exit/signal, sanitiza args
e faz teardown bounded. `HostKeyAlias=runpod-<podId>` evita colisão de host key quando o provider
recicla IP/porta sem afrouxar `StrictHostKeyChecking=accept-new`.

Duas retomadas canônicas falharam antes de `execution_started`: o endpoint surgiu, mas o sshd não
aceitou conexões dentro do teto (`banner exchange: Connection ... refused`). Ambas destruíram o
Pod e persistiram `shutdown_confirmed`. Como `nvidia-smi` ainda precedia o canal de controle, o
bootstrap foi reordenado para iniciar sshd antes da validação GPU, agora bounded em 60 s, e antes
de instalar/puxar Ollama. A prova paga seguinte não ocorreu porque o controle externo de aprovação
bloqueou a última criação; não contornar. Ledger líquido: US$ 1,25 de US$ 1,50. O item permanece
`approved v2`, sem attempts. Rotacionar a chave RunPod antes da retomada devido a exposição
acidental em output interno. Ver registro de 2026-09-09.

### Nova authority e barreira de cotação A40

A key rotacionada autenticou com sucesso quando o subprocesso deixou de herdar a credencial
antiga do processo do Codex. A RunPod confirmou zero Pods. A authority anterior foi revogada sem
alterar seu ledger de US$ 1,25 comprometidos, e uma nova authority de US$ 1,50 foi concedida ao
mesmo item/recurso. A volta canônica foi recusada antes de reserva e create porque a A40 retornou
sem preço/estoque em SECURE e COMMUNITY (`live_price:quote_unavailable`). O item permanece
`approved v2`, sem attempts, e a nova authority permanece integral. Retomar sem criar successor
quando a cotação A40 SECURE voltar a existir.

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

## Endurecimento de observabilidade e auditoria de crash (2026-09-01)

- Contador pago discriminado: zero observado é sucesso; erro é
  `paid_node_count_unavailable` e bloqueia antes de reserva/evidência/provider.
- Leitura de leases discriminada: indisponibilidade vira `observation: unavailable`, não relatório
  vazio observado nem convergência fabricada.
- A auditoria dos demais padrões `erro = vazio/zero/false` confirmou que negar autoridade em erro
  é corretamente fail-closed e que projeções somente de UI não participam dos write gates.
- A matriz focal cobre `provision_requested` com provider ausente; identidade persistida e recurso
  running; autoridade expirada; `shutdown_requested`; stop/destroy parcial; provider ausente ou
  inalcançável; falha/timeout de teardown; e replay sem efeito duplicado.
- Reserva sem `provision_requested` só é anulada com prova `provider_not_called`; create ambíguo
  conserva orçamento e converge por nome determinístico/`providerRef`.

## Prova capability-based live — 2026-09-10

A estratégia `cloud_self_hosted` foi autorizada com envelope capability-based (24 GiB/CUDA,
US$ 0,55/h, um node, 30 minutos, US$ 1,50). O inventário vivo ranqueou A40 SECURE a US$ 0,49/h
antes da RTX A6000; L40S e A100 ficaram fora do teto. O caminho canônico reservou US$ 0,245,
criou exatamente um Pod e persistiu sua identidade. O canal SSH publicado não respondeu dentro
do teto: `ssh` terminou 255 por `Connection timed out` em `194.68.245.239:22068`.

A falha voltou bounded como `provider_unreachable` / `coder_node_unavailable`, antes de claim,
attempt, coder, gate ou Verifier. O finally persistiu `shutdown_requested` e
`shutdown_confirmed`; a leitura final da RunPod confirmou zero Pods. O item segue `approved v2`.
Próxima ação mínima: investigar por que o endpoint TCP SSH publicado pelo Pod A40 não ficou
alcançável antes de autorizar outra execução paga. Ver
[registro da prova](../registros/2026-09-10-runpod-capability-live-ssh-timeout.md).
