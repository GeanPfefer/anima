# 2026-09-10 — RunPod: readiness em camadas + prova viva (barreira move para publicação do endpoint)

- **Tipo:** desenvolvimento + prova viva paga (uma única volta autorizada nesta sessão).
- **Objetivo:** exaurir o diagnóstico local da barreira SSH (`RUNPOD_AUTOPROVISION_END_TO_END=FAIL`
  no túnel, prova anterior desta data), reduzir o risco por correção local focal e — só então —
  executar uma única volta cloud governada aproveitando o MESMO Pod até `review` ou barreira real,
  sempre com teardown.
- **Git:** branch `dev`; HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51` (nenhum commit);
  `origin/dev=4ab99acf80ec69156f7155e203da1bd46dd96529`; `origin/main=main=99bec54…` intacta.
- **Commits/push:** nenhum. WIP amplo preexistente preservado; nenhum reset/stash/drop/merge.

## Diagnóstico local (Fase 1) e correções (zero gasto)

Duas correções focais no adapter, todas cobertas por teste, sem tocar o provider:

1. **Readiness em camadas no túnel** (`runpod-node-provisioner.ts` `openTunnel` +
   `runpod-ssh-tunnel` reuso). Antes, `openTunnel` fixava `publicIp:port` UMA vez e martelava um
   endpoint stale até o timeout, colapsando TCP/SSH num único `provider_unreachable`. Agora cada
   iteração **reconsulta o provider** (`getPod`), **segue mudança de mapping** (log
   `runpod_tunnel_mapping_changed`), faz uma **sonda TCP explícita** (`TcpProbe`/`netTcpProbe`
   injetável; env `ANIMA_RUNPOD_TCP_PROBE_TIMEOUT_MS`) ANTES do `ssh`, e no esgotamento emite UM
   diagnóstico estruturado com a fase exata: `mapping_absent | tcp_unreachable | ssh_not_ready`,
   mapping observado, nº de mudanças, tentativas, tempo. Cobre as hipóteses C/D/A/H da Fase 3.
2. **Atribuição pré-túnel** (`awaitEndpoint`). Novo código estável `endpoint_unpublished` distingue
   "ficou RUNNING mas o endpoint (publicIp + porta 22) nunca publicou dentro de `maxProvisionMs`" de
   `capacity_unavailable` ("nunca chegou a RUNNING"). Diagnóstico `runpod_endpoint_unpublished`.
   Não é produzido por `classifyRunPodError` (só pelo loop de readiness) ⇒ não colide com status HTTP.

## Gates locais

- `runpod-node-provisioner.test.ts` + `runpod-ssh-tunnel.test.ts`: **42/42 PASS** (inclui novas
  suítes de readiness TCP/mapping e o teste `endpoint_unpublished`).
- `resident-on-demand-node.test.ts` + `cloud-resource-plan.test.ts`: **35/35 PASS** (matching e nó
  on-demand intactos).
- `tsc --noEmit` (web): 2 erros, ambos PREEXISTENTES em `scripts/grant-paid-authority-8a2515d8.ts`
  (`null`→`string`, WIP); **zero** erros nos arquivos tocados. `git diff --check`: só CRLF.

## Preflight read-only (Fase 6, zero gasto)

Docker UP; Supabase local UP (auth 200); config RunPod presente em `.env.local`. RunPod: **0 Pods**;
key PASS (nunca impressa); A40 SECURE **US$ 0,49/h ≤ 0,55**; exposição 30min **US$ 0,245 ≤ 1,50**.
Authority `3b87224f-071f-486d-88b8-a9dfe0259747`: **ativa**, `validUntil` 2026-09-17, não revogada,
capability `{minVram 24, cuda, ≤US$0,55/h, maxNodes 1}`, item `8a2515d8`. Ledger antes: committed
US$ 0,245 (reserva `94641959`), remaining US$ 1,255. Nenhuma outra authority runpod ativa para o item.
Autenticação pelo residente (GoTrue→Bearer→RLS; nunca service_role).

## Prova viva (autorização humana explícita nesta sessão)

- Env do run: `ANIMA_RUNPOD_TUNNEL_READY_TIMEOUT_MS=300000`; `maxProvisionMs` no padrão **300s**.
- Pod `yi133l1j51prjr` (`anima-runpod-a40-test2`), US$ 0,49/h, exatamente 1 node, criado.
- Observado ao vivo (read-only): **`desiredStatus=RUNNING` com `publicIp:""` e `portMappings:null`**
  durante toda a janela — o provider reporta RUNNING ANTES de publicar o endpoint.
- Resultado: `outcome=selection_not_executable`; refusal `coder_node_unavailable` /
  `capacity_unavailable` (com o fix #2, a mesma condição passa a ser atribuída como
  `endpoint_unpublished`). Nenhum `mapping_changed`/`tunnel_open_failed` no log ⇒ **a camada de túnel
  nunca foi alcançada**. Nenhum claim/attempt/coder/read/edit/gate/Verifier. OpenAI/Anthropic = 0.
- **A barreira MOVEU**: prova anterior (pod `9jcyb…`) recebeu `194.68.245.239:22068` e falhou no TCP;
  esta NÃO publicou mapping algum em 300s. Não é "sem TCP SSH" categórico — é variabilidade do tempo
  de publicação do endpoint por máquina, e 300s foi insuficiente nesta A40.
- Duração: 11:33:05Z→11:43:11Z ≈ **606 s**. Teardown: **provider 0 Pods** confirmado (read-only).
- Ledger depois: nova reserva `0a85dc0f` US$ 0,245; committed **US$ 0,49**; remaining **US$ 1,01**;
  nenhuma reserva voidada.
- **RUNPOD_AUTOPROVISION_END_TO_END = FAIL**, agora na fase de **publicação do endpoint** (pré-túnel).

## Custo (Fase 10) — reportado, NÃO settled

Custo estimado real desta volta ~**US$ 0,0824** (606 s @ US$ 0,49/h) vs **US$ 0,245** reservados
(30 min conservador) ⇒ excesso ~US$ 0,16/volta **não liberado**. Settlement append-only
(reserved→actual→release do excesso→committed final) permanece **fronteira não implementada**
(exige recorte aprovado; `derived ≠ settled`). Saldo RunPod da conta não deve ser atribuído a esta
volta isolada.

## Segurança e efeitos externos

Um único Pod criado e destruído; provider final zero. Nenhuma API proprietária de modelo; nenhum
fallback estratégico (CLOUD SELF-HOSTED mantido). Nenhum accept/integrate/merge/publish/deploy;
`origin/main` intacta; nenhum commit/push. Chave nunca impressa/logada.

## Próximo ponto exato de retomada

1. **Não criar Pod sem novo `go` humano.** Barreira atual = janela de publicação do endpoint.
2. Numa próxima volta autorizada, setar `ANIMA_RUNPOD_MAX_PROVISION_MS` maior (ex.: `600000`) para dar
   mais tempo à publicação do endpoint em A40 SECURE lenta. Se o endpoint publicar, a camada
   TCP/mapping (fix #1, já pronta e verde) assume e produz atribuição precisa até SSH→túnel→Ollama.
3. Considerar (com recorte) elevar o default de `maxProvisionMs` com base nesta evidência.
4. Settlement de ledger reserved→actual continua fronteira aberta (Fase 10).
5. Reservas conservadoras acumulam (committed US$ 0,49 / teto US$ 1,50): ~4 voltas de folga antes de
   exaurir; reconciliar/void se necessário é ação com recorte humano.

## Adendo — auditoria focal do create payload (TCP/22) e `supportPublicIp`

Investigação para ELIMINAR a hipótese "o Pod foi criado sem expor TCP/22", antes de assumir atraso.
Fonte primária = repo; confirmação read-only na doc oficial RunPod (sem gasto, sem Pod).

- **O create pediu TCP/22? SIM.** `runpod-node-provisioner.ts` `createPod` envia `ports: ['22/tcp']`
  (agora via constante `SSH_TUNNEL_TCP_PORT`, modelada como requisito do túnel SSH).
- **Diferiu da prova que funcionou? NÃO.** `diagnose-runpod-tunnel.ts` (pod `a48i7sr3kyym7s`, TCP PASS)
  e o pod `9jcyb…` (que publicou `194.68.245.239:22068`) usaram o MESMÍSSIMO `ports: ['22/tcp']`.
  Testes já ancoravam o valor (`*.test.ts`, `*.integration.test.ts`). ⇒ hipótese REFUTADA.
- **Doc RunPod (REST v1):** `ports` = array `"[porta]/[protocolo]"` (`"22/tcp"` correto). `supportPublicIp`
  boolean, **default null** ("se null, o Pod pode não ter IP público"); **SECURE sempre recebe IP
  público** independente do flag; COMMUNITY exige `true`. `desiredStatus` é o estado DESEJADO (não
  readiness); **a REST v1 NÃO expõe `runtime`/campo de readiness** além de `publicIp`+`portMappings`
  ("empty enquanto inicializando"). REST v1 será aposentada em **2026-11-15** (migrar p/ v2).
- **Causa do `yi133`:** como usamos `SECURE` (IP público garantido pela doc), a omissão de
  `supportPublicIp` NÃO explica o `yi133`. Resta **atraso/stall de publicação** do endpoint naquela
  máquina; e como a REST v1 não tem sinal de readiness mais fino, o `awaitEndpoint` já espera o único
  sinal disponível (publicIp+port22).
- **Patch (robustez, na cadeia de networking):** `supportPublicIp: true` explícito no create
  (harmless em SECURE, correto em COMMUNITY, remove a ambiguidade "pode não ter IP público"). NÃO
  altera timeout. NÃO afirmado como correção do `yi133`.
- **Teste novo:** contrato de rede — node por SSH ⇒ create expõe EXATAMENTE `22/tcp` + `supportPublicIp`,
  sem duplicação e sem porta extra. Regressão do integration test (injeta `tcpProbe` roteável, pois a
  camada TCP cold-start é exercitada nas suítes de readiness). Gates: **79/79** (5 suítes) PASS; tsc
  meus arquivos clean (2 erros TS preexistentes em `scripts/grant-paid-authority-8a2515d8.ts`).
- **`maxProvisionMs`:** ainda faz sentido elevar — é o ÚNICO lever in-API para o caso de publicação
  lenta (REST v1 sem readiness). Mas não cegamente: tratar não-publicação persistente como candidato a
  RE-PROVISIONAR em outra máquina (fronteira futura), pois pode haver máquina que nunca publica.
- **Próxima prova live (consolidada, com novo go humano):** create (com `supportPublicIp:true`) →
  endpoint → TCP → SSH → túnel → Ollama → qwen3-coder → coder → gate → Verifier → review, no MESMO Pod,
  com `ANIMA_RUNPOD_MAX_PROVISION_MS` maior (ex.: 480000–600000). Sem "teste de endpoint" isolado.
