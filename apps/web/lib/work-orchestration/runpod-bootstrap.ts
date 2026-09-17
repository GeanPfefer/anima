// Geração PURA e testável do bootstrap do Pod RunPod (seam extraído de `runpod-node-provisioner`).
//
// INVARIANTE CENTRAL (endurecimento 2026-09-11 — regressão golden-vs-recente):
//   DEPOIS QUE O SSHD ESTÁ DE PÉ, FALHA EM NVIDIA/OLLAMA/PULL NÃO PODE MATAR O SSHD NEM O CONTAINER.
// O Pod golden que funcionou (`a48i7sr3kyym7s`, TCP PASS) rodava `sshd -D` em FOREGROUND como único
// workload — nada pesado depois podia derrubá-lo. O caminho canônico recente acoplava a vida do
// container a uma cadeia longa sob `set -e` (nvidia-smi → install Ollama → serve → pull de ~19 GB):
// qualquer step pós-sshd falho/lento encerrava o shell do container e levava junto o sshd e o mapping
// TCP publicado — explicando "mapping publicou-e-sumiu", tcp_unreachable e banner/connection refused.
//
// Arquitetura do script gerado (3 fases):
//   [1] CONTROL PLANE — `set -eu`, FATAL, pré-sshd: apt + authorized_keys + status=`pending`.
//       Falha aqui torna a caixa inalcançável de qualquer forma ⇒ fail-fast é correto.
//   [2] HEAVY WORKER — subshell ISOLADA (`bash -c`, `set +e`, `nohup … &`): espera o sshd aceitar
//       conexão e SÓ ENTÃO roda as etapas pesadas; cada falha grava um MARCADOR de classe distinto
//       em RUNPOD_BOOTSTRAP_STATUS_PATH e encerra o worker — sem tocar no container/sshd. NÃO usa
//       `|| true` cego: cada classe de falha é registrada e distinguível (GPU/instalação/serve/pull).
//   [3] DURÁVEL — `exec /usr/sbin/sshd -D`: âncora de vida do container. Como é a ÚLTIMA instrução e
//       está em foreground, o container vive enquanto (e somente enquanto) o canal de controle vive.

/** Caminho do marcador de bootstrap dentro do Pod. O host pode lê-lo por SSH para CLASSIFICAR a
 * falha pesada sem depender de logs — e sem que a falha derrube o canal de controle. */
export const RUNPOD_BOOTSTRAP_STATUS_PATH = '/var/run/anima-bootstrap.status';

/** Log agregado do worker pesado dentro do Pod (stdout+stderr). */
export const RUNPOD_BOOTSTRAP_WORKER_LOG = '/tmp/anima-bootstrap-worker.log';

/** Processo DURÁVEL do container: sshd em foreground (âncora de vida). Espelha o Pod golden. */
export const RUNPOD_BOOTSTRAP_DURABLE_COMMAND = 'exec /usr/sbin/sshd -D';

/** Endereço loopback do Ollama dentro do Pod (o túnel SSH encaminha o host até aqui). */
const OLLAMA_HOST = '127.0.0.1:11434';

/** Marcadores de progresso/falha do bootstrap. Ordem = progressão até `ready`. Cada `*_failed`
 * é uma CLASSE observável distinta — nunca um sucesso silencioso. */
export type RunPodBootstrapStatus =
  | 'pending'
  | 'gpu_check_failed'
  | 'ollama_install_failed'
  | 'ollama_serve_failed'
  | 'model_pull_failed'
  | 'ready';

export type RunPodHeavyStepName =
  | 'await_sshd'
  | 'gpu_check'
  | 'ollama_install'
  | 'ollama_serve'
  | 'model_ready'
  | 'record_ready';

export interface RunPodHeavyStep {
  /** Nome estável da etapa (para diagnóstico e teste). */
  readonly name: RunPodHeavyStepName;
  /** Marcador gravado se ESTA etapa falhar; `null` para etapas que não classificam falha
   * (`await_sshd` espera; `record_ready` marca sucesso). */
  readonly failureStatus: RunPodBootstrapStatus | null;
  /** Comando(s) shell da etapa (modelo já interpolado — validado por regex, sem espaço/aspas). */
  readonly script: string;
}

export interface RunPodBootstrapPlan {
  /** Fase 1: comandos FATAIS pré-sshd. Garantidamente SEM nenhuma etapa pesada. */
  readonly controlPlane: readonly string[];
  /** Fase 2: etapas do worker isolado, na ordem de execução. */
  readonly heavySteps: readonly RunPodHeavyStep[];
  /** Fase 3: comando durável (sshd -D foreground). */
  readonly durableCommand: string;
  readonly statusPath: string;
  readonly workerLogPath: string;
}

const SAFE_MODEL = /^[A-Za-z0-9._:/-]+$/;

/** `true` se o nome do modelo é seguro para interpolar no shell (sem espaço, aspas, `$`, etc.). */
export const isSafeRunPodModel = (model: string): boolean => SAFE_MODEL.test(model);

/** Comando que grava um marcador de status no Pod. */
const record = (status: RunPodBootstrapStatus): string => `echo ${status} > ${RUNPOD_BOOTSTRAP_STATUS_PATH}`;

/** Plano PURO do bootstrap, ou `null` para modelo inseguro (o caller emite `exit 64`). */
export function planRunPodBootstrap(model: string): RunPodBootstrapPlan | null {
  if (!isSafeRunPodModel(model)) return null;

  const controlPlane: readonly string[] = [
    // FATAL e pré-sshd: se o control plane falhar, a caixa é inalcançável de qualquer jeito.
    'set -eu',
    'apt-get update -qq',
    'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssh-server curl ca-certificates',
    'install -d -m 700 /root/.ssh /run/sshd',
    'test -n "${PUBLIC_KEY:-}"',
    'printf "%s\\n" "$PUBLIC_KEY" > /root/.ssh/authorized_keys',
    'chmod 600 /root/.ssh/authorized_keys',
    record('pending'),
  ];

  const heavySteps: readonly RunPodHeavyStep[] = [
    {
      // Espera o sshd ACEITAR conexão em 127.0.0.1:22 ANTES de qualquer etapa pesada — garante, em
      // runtime, que a preparação pesada nunca precede/atrasa o canal de controle. bash tem /dev/tcp.
      name: 'await_sshd',
      failureStatus: null,
      script: 'for i in $(seq 1 60); do (exec 3<>/dev/tcp/127.0.0.1/22) 2>/dev/null && { exec 3>&-; break; }; sleep 1; done',
    },
    {
      name: 'gpu_check',
      failureStatus: 'gpu_check_failed',
      script: `timeout 60 nvidia-smi >/tmp/anima-nvidia.log 2>&1 || { ${record('gpu_check_failed')}; exit 0; }`,
    },
    {
      name: 'ollama_install',
      failureStatus: 'ollama_install_failed',
      script: `command -v ollama >/dev/null 2>&1 || curl -fsSL https://ollama.com/install.sh | sh >/tmp/anima-ollama-install.log 2>&1 || { ${record('ollama_install_failed')}; exit 0; }`,
    },
    {
      name: 'ollama_serve',
      failureStatus: 'ollama_serve_failed',
      // `serve &` fica em background; espera bounded pelo /api/tags; classifica se nunca subir.
      script: [
        `ollama serve >/tmp/anima-ollama.log 2>&1 &`,
        `ok=0`,
        `for i in $(seq 1 60); do curl -fsS http://${OLLAMA_HOST}/api/tags >/dev/null 2>&1 && { ok=1; break; }; sleep 2; done`,
        `[ "$ok" = 1 ] || { ${record('ollama_serve_failed')}; exit 0; }`,
      ].join('\n'),
    },
    {
      name: 'model_ready',
      failureStatus: 'model_pull_failed',
      script: [
        `if ollama show ${model} >/dev/null 2>&1; then echo ANIMA_MODEL_CACHE=warm; else echo ANIMA_MODEL_CACHE=cold; timeout 1800 ollama pull ${model} >/tmp/anima-pull.log 2>&1 || { ${record('model_pull_failed')}; exit 0; }; fi`,
        `ollama show ${model} >/dev/null 2>&1 || { ${record('model_pull_failed')}; exit 0; }`,
      ].join('\n'),
    },
    {
      name: 'record_ready',
      failureStatus: null,
      script: record('ready'),
    },
  ];

  return {
    controlPlane,
    heavySteps,
    durableCommand: RUNPOD_BOOTSTRAP_DURABLE_COMMAND,
    statusPath: RUNPOD_BOOTSTRAP_STATUS_PATH,
    workerLogPath: RUNPOD_BOOTSTRAP_WORKER_LOG,
  };
}

/** Corpo do worker isolado (fase 2), sem o wrapper `bash -c '…'`. PURO — útil para `bash -n`. */
export function renderRunPodHeavyWorkerBody(plan: RunPodBootstrapPlan): string {
  // `set +e` + shell própria ⇒ falha pesada é tratada explicitamente (marcador + `exit 0`) e NUNCA
  // propaga para o shell do container. `export` do OLLAMA_HOST uma vez, no topo do worker.
  return ['set +e', `export OLLAMA_HOST=${OLLAMA_HOST}`, ...plan.heavySteps.map(step => step.script)].join('\n');
}

/** Renderiza o script final passado a `dockerStartCmd`. `exit 64` para modelo inseguro. */
export function renderRunPodBootstrapScript(model: string): string {
  const plan = planRunPodBootstrap(model);
  if (plan === null) return 'exit 64';
  const workerBody = renderRunPodHeavyWorkerBody(plan);
  // `nohup … &`: o worker sobrevive à troca de líder de sessão quando o `exec sshd` assume; e roda
  // concorrente ao sshd, jamais como pré-requisito dele.
  const launchWorker = `nohup bash -c '${workerBody}' >${plan.workerLogPath} 2>&1 &`;
  // Separador por NEWLINE (não `;`): `… &` seguido de `exec …` é válido; `… &; …` seria erro de sintaxe.
  return [...plan.controlPlane, launchWorker, plan.durableCommand].join('\n');
}
