# 2026-09-11 — RunPod: arqueologia do Pod golden vs Pods recentes (diff de payload/bootstrap, zero gasto)

- **Tipo:** investigação read-only (arqueologia). ZERO Pod criado, ZERO provider write, ZERO gasto.
- **Git:** branch `dev`; HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51` (nenhum commit).
  `origin/main` `99bec54` intacta. WIP amplo preservado integralmente (inclui migration
  `20260910000003_fix_settlement_jwt_role_robust.sql` e o patch `tunnel_unavailable`). Sem reset/stash/drop.
- **Autorização de gasto:** authority `3b87224f-071f-486d-88b8-a9dfe0259747` (A40/SECURE, ≥24 GiB/cuda,
  ≤US$1,00/h, 1 node, teto US$1,50, `validUntil` 2026-09-17). Budget remanescente US$0,8832. NÃO usada nesta sessão.

## 1. Pod golden identificado

- **ID:** `a48i7sr3kyym7s` — **data** 2026-09-09 — **GPU** NVIDIA A40 — **provider** RunPod **SECURE**.
- **Criado por:** `apps/web/scripts/diagnose-runpod-tunnel.ts` (script de DIAGNÓSTICO, NÃO o caminho canônico).
- **Resultado (melhor da série RunPod-autoprov):** RUNNING → publicou `publicIp`+`portMappings['22']` →
  `SshRunPodTunnelManager` abriu na 1ª tentativa (PID 19052, listener `127.0.0.1:60852`) → **TCP PASS**.
  HTTP falhou SÓ porque o Ollama nunca foi instalado (by design). Manager seguiu vivo após o probe.
- Referências secundárias persistidas: `9jcyb…` publicou `194.68.245.239:22068` mas TCP falhou;
  `4rag1i9ly4ick4` (09-10) publicou `69.30.85.9:22132` e o mapping OSCILOU/sumiu (`mapping_absent`).
- Fonte primária = repo (código + registros 09-09/09-10). Não há linha de vida em DB: os proofs NUNCA
  reivindicaram o work item (`claimId/attemptId` null) ⇒ `record_host_observed_node_lifecycle` não gravou
  nada; e a identidade RESIDENTE (RLS) não é acessível ao Claude sem host residente (BLOQUEIO AUTH).
  Logo NÃO existe artefato por-Pod com o payload; a reconstrução abaixo vem de código+`.env.local`+registros.

## 2. Payload EFETIVO histórico (golden `a48i7sr3kyym7s`, via `diagnose-runpod-tunnel.ts`)

```
POST https://rest.runpod.io/v1/pods
{ name:"anima-tunnel-diag", imageName:"ollama/ollama:latest", computeType:"GPU",
  cloudType:"SECURE", gpuTypeIds:["NVIDIA A40"], gpuCount:1,
  containerDiskInGb:20, ports:["22/tcp"],
  dockerEntrypoint:["bash","-lc"], dockerStartCmd:[BOOT_MIN], env:{ PUBLIC_KEY } }
BOOT_MIN = set -euo pipefail; apt-get update -qq;
  apt-get install -y -qq openssh-server; install -d -m700 /root/.ssh /run/sshd;
  test -n "$PUBLIC_KEY"; write authorized_keys; chmod 600; /usr/sbin/sshd -D
```
SEM `supportPublicIp`. SEM `volumeInGb`/`networkVolumeId`. `sshd -D` em **FOREGROUND** como ÚNICO/terminal
workload do contêiner → nada depois dele pode falhar; contêiner permanece vivo enquanto o sshd viver.

## 3. Payload EFETIVO recente (canônico `RunPodNodeProvisioner.createPod`, WIP sobre d783a5d; `.env.local` disk=60)

```
POST https://rest.runpod.io/v1/pods
{ name:"anima-<nodeId>", imageName:"ollama/ollama:latest", computeType:"GPU",
  cloudType:"SECURE", gpuTypeIds:[<SKU casada, p.ex. "NVIDIA A40">], gpuCount:1,
  containerDiskInGb:60, ports:["22/tcp"], supportPublicIp:true,
  dockerEntrypoint:["bash","-lc"], dockerStartCmd:[BOOT_HEAVY],
  env:{ OLLAMA_KEEP_ALIVE:"30m", PUBLIC_KEY } }
BOOT_HEAVY (WIP) = set -euo pipefail; apt update; apt install openssh-server curl ca-certificates;
  install -d; test PUBLIC_KEY; authorized_keys; chmod; /usr/sbin/sshd  (BACKGROUND/daemoniza);
  command -v nvidia-smi; timeout 60 nvidia-smi; ollama install(se faltar);
  ollama serve & ; espera /api/tags(120s); ollama show || pull(timeout 1800s); ollama show; wait
```
Variante COMMITTED em HEAD (d783a5d): `nvidia-smi` **SEM timeout roda PRIMEIRO, antes do sshd** — e o
comentário do próprio HEAD afirma: *"o RunPod só publica portMappings['22'] quando o sshd escuta"*.

## 4. Diff campo-a-campo (material)

| Campo | Golden (TCP PASS) | Canônico recente |
|---|---|---|
| containerDiskInGb | **20** | **60** |
| supportPublicIp | **ausente** | **true** (campo NOVO no WIP) |
| dockerStartCmd/bootstrap | **minimal `sshd -D` foreground, terminal** | **cadeia `set -e` frágil (nvidia+ollama+pull 1800s) + `wait`; sshd em background** |
| env | { PUBLIC_KEY } | { OLLAMA_KEEP_ALIVE, PUBLIC_KEY } |
| gpuTypeIds | fixo "NVIDIA A40" | SKU casada (nos proofs persistidos, ainda A40) |

Iguais: `imageName` (ollama/ollama:latest), `computeType` (GPU), `cloudType` (SECURE), `gpuCount` (1),
`ports` (["22/tcp"]), `dockerEntrypoint`, ausência de `volumeInGb`/`networkVolumeId`, `apiBase` (v1),
mesma `fetchHttpClient`, mesma chave/`authorized_keys`.

## 5. Diff do resultado do provider

- **Golden:** time-to-RUNNING rápido; publicIp+port22 publicados; túnel na 1ª; TCP PASS; **estável**.
- **Recente:** RUNNING atingido, porém publicIp/port22 **nunca publicaram** em 300–600s
  (`yi133l1j51prjr`, `3q3ylg21mawaes` → `endpoint_unpublished`) OU **publicaram e SUMIRAM/oscilaram**
  (`4rag1i9ly4ick4` → `mapping_absent`) OU TCP/`banner exchange Connection refused` sem listener
  (`t0xu3raw8ft55w`). `ixtqdy8h91cftq` parou pré-attempt ~347s.

## 6. Causa mais provável (com confiança)

Duas causas coexistentes e **separáveis**:
- **(A) MÉDIA-ALTA — acoplamento de vida do contêiner/sshd à cadeia frágil do bootstrap.** No canônico,
  `set -e` + sshd em background + steps longos/falíveis (nvidia, install ollama, `pull` até 30 min) e
  `wait` fazem a vida do contêiner (e do sshd) depender do sucesso de tudo. Um step lento/falho ⇒ bash
  sai ⇒ contêiner morre ⇒ **leva junto o sshd e o mapping TCP publicado** ⇒ explica "publicou-e-sumiu"
  (`4rag1i`) e TCP/banner-refused (`t0xu3raw`). O golden nunca teve essa exposição (`sshd -D` foreground,
  nada depois). Fixável LOCALMENTE, zero-gasto para escrever; alinhado à crença do PRÓPRIO repo em HEAD.
- **(B) MÉDIA — variabilidade/lentidão de publicação do RunPod SECURE** para os que NUNCA publicaram em
  300–600s (`yi133`/`3q3ylg`). A evidência persistida NÃO separa "sshd nunca subiu (causa A)" de "placement
  SECURE genuinamente lento/nunca publica": REST v1 não expõe readiness além de publicIp+portMappings e NÃO
  há log interno do Pod (sem SSH = cego). Variabilidade é real (mesmo payload: `9jcyb` publicou, `yi133` não).

## 7. Descartado por evidência

`ports` (22/tcp idêntico — Adendo 09-10), imagem/template (mesma imagem; NENHUM `templateId` usado nos dois),
endpoint/API (ambos `rest.runpod.io/v1`, mesma `fetchHttpClient`), chave SSH/`authorized_keys` (golden provou
o mesmo caminho de chave funcionando), budget agregado (settlement/teardown funcionaram), Cloud Resource
Matching (matcher escolheu SKU corretamente), `env OLLAMA_KEEP_ALIVE` (irrelevante a rede).

## 8. Correção local segura sem gasto

SIM, uma — mas ela É a variável do experimento, então fica como **RECOMENDAÇÃO (não aplicada)** para não
contaminar o A/B nem o WIP: endurecer o bootstrap para que a sobrevivência do sshd/contêiner seja
INDEPENDENTE da cadeia nvidia/ollama/pull (espelhar o golden: processo durável segurando o sshd; steps
arriscados que NÃO abortem/matem a caixa antes do túnel conectar e diagnosticar). Regressão a fixar:
(a) create expõe exatamente `22/tcp` + `supportPublicIp` uma vez; (b) o bootstrap mantém o sshd vivo mesmo
se a cadeia ollama falhar. NÃO aplicado agora (preserva WIP; validação exige o A/B pago abaixo).

## 9. Próximo experimento mínimo (design; NÃO executado)

A/B controlado na MESMA conta/SKU (A40 SECURE ≤US$1,00/h), 1 Pod cada, ambos auto-destroem, total ≪US$0,20,
ambos os scripts JÁ EXISTEM:
- **Controle** = `diagnose-runpod-tunnel.ts` (golden minimal `sshd -D`, disk 20, sem supportPublicIp, sem pull).
- **Tratamento** = 1 Pod canônico com o step de `pull` neutralizado (ou flag de bootstrap minimal), disk 60,
  `supportPublicIp:true`.
Medir em cada: time-to-RUNNING, time-to-publicIp, time-to-portMappings['22'], TCP roteável, banner SSH, e se
o mapping SOME após aparecer.
- Controle estável e Tratamento some/nunca-publica ⇒ **causa (A) CONFIRMADA** ⇒ aplicar o fix de bootstrap.
- Ambos falham em publicar ⇒ **causa (B) CONFIRMADA** ⇒ escalar: COMMUNITY / `dataCenterId` diferente, ou 1
  Pod manual UI vs 1 Pod API com payload minimal idêntico (isola conta/template/provider).
Guardas: 1 Pod por vez; teardown antes do próximo; `ANIMA_RUNPOD_MAX_PROVISION_MS=600000`; authority
`3b87224f`; sem fallback; requer novo GO humano (gasto = fronteira).

## 10. Estado Git/WIP e efeitos externos

- `dev` @ `d783a5d`; `origin/main` `99bec54` intacta; WIP preservado (migration 000003 + patch
  `tunnel_unavailable`); nenhum reset/stash/drop/commit/push.
- **Zero Pods criados; zero provider write; zero gasto.** Leituras: git, arquivos-fonte, `.env.local`
  (API key redigida, nunca impressa), registros. Nenhuma API OpenAI/Anthropic; nenhum fallback.
