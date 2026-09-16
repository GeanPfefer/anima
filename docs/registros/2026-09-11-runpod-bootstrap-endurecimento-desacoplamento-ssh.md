# 2026-09-11 — RunPod: endurecimento do bootstrap (desacoplar SSH/vida do container das etapas pesadas de Ollama)

- **Tipo:** desenvolvimento local com regressão. ZERO Pod, ZERO provider write, ZERO gasto, ZERO fallback.
- **Git:** branch `dev`; HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51` (nenhum commit).
  `origin/main` `99bec54` intacta. WIP preservado (migration `20260910000003` + patch `tunnel_unavailable`
  presentes). Sem reset/stash/drop.
- **Motivação:** conclusão da arqueologia `2026-09-11-runpod-golden-vs-recente-diff-payload-bootstrap.md`
  (diff material = BOOTSTRAP; o Pod golden `a48i7sr3kyym7s`/TCP PASS rodava `sshd -D` foreground como
  único workload; o canônico acoplava a vida do container a uma cadeia `set -e` frágil).

## 1. Causa estrutural corrigida
No bootstrap canônico anterior, `sshd` (background) e as etapas pesadas (nvidia-smi, install Ollama,
`ollama serve`, `ollama pull` de ~19 GB, `wait`) rodavam TODAS no MESMO shell sob `set -euo pipefail`.
Qualquer step pós-sshd lento/falho encerrava o shell do container e derrubava JUNTO o sshd e o mapping
TCP já publicado — explicando `mapping_absent` (publicou-e-sumiu), `tcp_unreachable` e banner/connection
refused. O canal de controle estava acoplado demais à preparação pesada.

## 2. Nova arquitetura do bootstrap (seam PURO testável)
Extraída para `apps/web/lib/work-orchestration/runpod-bootstrap.ts` (função pura; `createPod` agora chama
`renderRunPodBootstrapScript(model)`). Três fases:
- **[1] CONTROL PLANE** (`set -eu`, FATAL, pré-sshd): apt + `authorized_keys` + `status=pending`. Falha
  aqui = caixa inalcançável de qualquer jeito ⇒ fail-fast correto. SEM nada pesado.
- **[2] HEAVY WORKER** (`nohup bash -c '…' &`, shell PRÓPRIA, `set +e`): espera o sshd aceitar conexão em
  `127.0.0.1:22` (via `/dev/tcp`) e SÓ ENTÃO roda as etapas pesadas. Cada falha grava um MARCADOR de
  classe distinto em `/var/run/anima-bootstrap.status` e `exit 0` (encerra só o worker), sem tocar no
  container/sshd. Não há `|| true` cego.
- **[3] DURÁVEL** (`exec /usr/sbin/sshd -D`): ÚLTIMA instrução, foreground ⇒ o container vive enquanto (e
  só enquanto) o canal de controle vive. Espelha o Pod golden.

## 3. Como o SSH permanece vivo quando Ollama/GPU falham
O worker roda numa subshell isolada (`bash -c`, `set +e`), lançada com `nohup … &` ANTES do `exec sshd -D`.
Como o durável está FORA do worker (depois da aspa de fechamento), um `exit` do worker jamais alcança o
sshd. Falha em GPU/instalação/serve/pull ⇒ marcador + fim do worker; sshd/foreground seguem de pé e a
caixa continua diagnosticável por SSH. Separador por NEWLINE entre worker e durável (evita o erro de
sintaxe `… &;`).

## 4. Como a falha pesada continua observável/classificável
Marcadores distintos em `/var/run/anima-bootstrap.status`: `pending → {gpu_check_failed |
ollama_install_failed | ollama_serve_failed | model_pull_failed} → ready`, mais logs por etapa
(`/tmp/anima-nvidia.log`, `/tmp/anima-ollama-install.log`, `/tmp/anima-ollama.log`, `/tmp/anima-pull.log`,
`/tmp/anima-bootstrap-worker.log`). O host pode ler o marcador por SSH e classificar sem depender de logs.
(Wiring automático host→marcador fica como seam futuro; hoje o marcador é o artefato verificável.)

## 5. Testes adicionados
- `runpod-bootstrap.test.ts` (novo, seam puro): #1 sshd durável precede pesado / control plane sem nada
  pesado / await_sshd antes de gpu; #2 GPU falha ⇒ `gpu_check_failed` + `exit 0` (não derruba container);
  #3 instalação Ollama falha ⇒ `ollama_install_failed`; #4 `ollama pull` falha ⇒ `model_pull_failed`;
  #5 caminho feliz chega a Ollama-ready (serve/api tags/pull/`record ready`); #6 marcadores distintos por
  classe (sem `|| true`); #7 worker isolado (`nohup bash -c`, `set +e`), durável fora do worker, sem
  `&;`; modelo inseguro ⇒ `exit 64`.
- `runpod-node-provisioner.test.ts` (atualizado): a asserção de ordem antiga (sshd-antes-de-nvidia) foi
  trocada por: `dockerStartCmd === [renderRunPodBootstrapScript(model)]` (wiring do seam) + durável
  (`exec /usr/sbin/sshd -D`) como ÚLTIMA instrução + `ollama pull` presente. Contrato de rede
  (`ports:["22/tcp"]` + `supportPublicIp:true`) inalterado.

## 6. Resultados (gates)
- Focais: `runpod-bootstrap.test.ts` + `runpod-node-provisioner.test.ts` = **49/49 PASS**.
- Sweep `lib/work-orchestration`: **77 suítes / 1017 testes PASS**.
- **Validação de sintaxe zero-gasto:** `bash -n` no script renderizado completo (`SCRIPT_SYNTAX_OK`) e no
  corpo isolado do worker (`WORKER_SYNTAX_OK`).
- `tsc --noEmit` (web): **EXIT 0, 0 erros** (barreira preexistente não reincide).
- `git diff --check`: só avisos CRLF (flake conhecido), nenhum erro real.
- `packages/core` NÃO tocado por esta tarefa ⇒ typecheck core não requerido.

## 7. Arquivos alterados
- NOVO `apps/web/lib/work-orchestration/runpod-bootstrap.ts` (seam puro).
- NOVO `apps/web/lib/work-orchestration/runpod-bootstrap.test.ts` (regressões #1–#7).
- MOD `apps/web/lib/work-orchestration/runpod-node-provisioner.ts` (import + `createPod` usa o seam;
  removido o método `bootstrapCommand` inline antigo).
- MOD `apps/web/lib/work-orchestration/runpod-node-provisioner.test.ts` (asserções à nova arquitetura).
- NOVO este registro. Payload do create INALTERADO (ports/imagem/cloudType/disk/supportPublicIp/authority).

## 8. Efeitos externos
ZERO Pods criados; ZERO provider write; ZERO gasto. Nenhuma API OpenAI/Anthropic; CLOUD SELF-HOSTED
mantido. `origin/main` intacta; nenhum commit/push; `.env.local` não editado; migration `000003` e patch
`tunnel_unavailable` preservados. Não reabertos: aggregate budget, tunnel_unavailable, resource matching.

## 9. Prontos para o A/B mínimo controlado?
SIM (código). O tratamento "canonical hardened" agora existe e está verde. Experimento (requer NOVO GO
humano; gasto = fronteira): mesma conta/SKU A40 SECURE, 1 Pod por vez, teardown garantido —
CONTROLE=`diagnose-runpod-tunnel.ts` (golden minimal) vs TRATAMENTO=1 Pod canônico endurecido; medir
time-to-publicIp / time-to-portMappings['22'] / TCP / banner SSH / se o mapping SOME e ler
`/var/run/anima-bootstrap.status` por SSH. Guardas: `MAX_PROVISION_MS=600000`; authority
`3b87224f` (remaining US$0,8832; maxHourly US$1,00; maxTotal US$1,50; maxNodes 1; validUntil 2026-09-17).
