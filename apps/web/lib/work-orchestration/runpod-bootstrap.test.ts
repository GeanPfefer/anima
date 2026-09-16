/** @jest-environment node */
import {
  planRunPodBootstrap,
  renderRunPodBootstrapScript,
  renderRunPodHeavyWorkerBody,
  isSafeRunPodModel,
  RUNPOD_BOOTSTRAP_DURABLE_COMMAND,
  RUNPOD_BOOTSTRAP_STATUS_PATH,
  type RunPodBootstrapPlan,
  type RunPodBootstrapStatus,
} from './runpod-bootstrap';

const MODEL = 'qwen3-coder:latest';
const plan = (): RunPodBootstrapPlan => {
  const p = planRunPodBootstrap(MODEL);
  if (p === null) throw new Error('esperava plano para modelo seguro');
  return p;
};
const step = (name: string) => {
  const s = plan().heavySteps.find(x => x.name === name);
  if (!s) throw new Error(`etapa ausente: ${name}`);
  return s;
};

describe('runpod bootstrap — endurecimento: SSH/vida do container desacoplados das etapas pesadas', () => {
  // #1 — sshd sobe cedo e as operações pesadas NUNCA o precedem/atrasam.
  test('#1 sshd (durável) precede as operações pesadas; control plane não contém nada pesado', () => {
    const p = plan();
    const control = p.controlPlane.join('\n');
    // Control plane FATAL só prepara chaves/pacotes — sem GPU/Ollama/daemon sshd embutido.
    expect(control).toContain('chmod 600 /root/.ssh/authorized_keys');
    expect(control).toContain(`echo pending > ${RUNPOD_BOOTSTRAP_STATUS_PATH}`);
    expect(control).not.toMatch(/nvidia|ollama|\/usr\/sbin\/sshd/);
    // A 1ª etapa do worker ESPERA o sshd aceitar conexão em :22 antes de qualquer coisa pesada.
    const names = p.heavySteps.map(s => s.name);
    expect(names).toEqual(['await_sshd', 'gpu_check', 'ollama_install', 'ollama_serve', 'model_ready', 'record_ready']);
    expect(names.indexOf('await_sshd')).toBeLessThan(names.indexOf('gpu_check'));
    expect(step('await_sshd').script).toContain('/dev/tcp/127.0.0.1/22');
    // No script final, o comando DURÁVEL (sshd -D foreground) é a ÚLTIMA instrução.
    const script = renderRunPodBootstrapScript(MODEL);
    expect(script.trimEnd().endsWith(RUNPOD_BOOTSTRAP_DURABLE_COMMAND)).toBe(true);
    expect(RUNPOD_BOOTSTRAP_DURABLE_COMMAND).toBe('exec /usr/sbin/sshd -D');
  });

  // #2 — falha em nvidia-smi grava marcador e encerra só o WORKER (exit 0), nunca o container.
  test('#2 falha de GPU registra gpu_check_failed e não derruba container/SSH', () => {
    const gpu = step('gpu_check');
    expect(gpu.failureStatus).toBe<RunPodBootstrapStatus>('gpu_check_failed');
    expect(gpu.script).toContain('nvidia-smi');
    // Padrão de contenção: em falha, grava marcador e `exit 0` (encerra o subshell do worker, não o shell do container).
    expect(gpu.script).toContain(`echo gpu_check_failed > ${RUNPOD_BOOTSTRAP_STATUS_PATH}`);
    expect(gpu.script).toMatch(/\|\|\s*\{[^}]*exit 0;?\s*\}/);
  });

  // #3 — falha na instalação do Ollama não mata o SSH.
  test('#3 falha na instalação do Ollama registra ollama_install_failed e não mata SSH', () => {
    const s = step('ollama_install');
    expect(s.failureStatus).toBe<RunPodBootstrapStatus>('ollama_install_failed');
    expect(s.script).toContain(`echo ollama_install_failed > ${RUNPOD_BOOTSTRAP_STATUS_PATH}`);
    expect(s.script).toContain('exit 0');
    expect(s.script).toContain('install.sh');
  });

  // #4 — falha no pull do modelo não mata o SSH.
  test('#4 falha em ollama pull registra model_pull_failed e não mata SSH', () => {
    const s = step('model_ready');
    expect(s.failureStatus).toBe<RunPodBootstrapStatus>('model_pull_failed');
    expect(s.script).toContain(`timeout 1800 ollama pull ${MODEL}`);
    expect(s.script).toContain(`echo model_pull_failed > ${RUNPOD_BOOTSTRAP_STATUS_PATH}`);
    expect(s.script).toContain('exit 0');
  });

  // #5 — caminho de SUCESSO ainda chega ao estado Ollama-ready.
  test('#5 caminho feliz prepara Ollama/qwen3-coder e marca ready', () => {
    const p = plan();
    const serve = step('ollama_serve');
    expect(serve.script).toContain('ollama serve');
    expect(serve.script).toContain('/api/tags');
    const model = step('model_ready');
    expect(model.script).toContain('ANIMA_MODEL_CACHE=warm'); // cache quente evita re-pull
    expect(model.script).toContain('ANIMA_MODEL_CACHE=cold');
    expect(model.script).toContain(`ollama pull ${MODEL}`);
    expect(step('record_ready').script).toBe(`echo ready > ${RUNPOD_BOOTSTRAP_STATUS_PATH}`);
    // A última etapa do worker é o marcador de sucesso.
    expect(p.heavySteps.at(-1)?.name).toBe('record_ready');
  });

  // #6 — cada classe de falha pesada é OBSERVÁVEL/CLASSIFICÁVEL por um marcador DISTINTO (nada de `|| true` cego).
  test('#6 erro pesado permanece classificável: marcadores distintos por classe de falha', () => {
    const p = plan();
    const markers = p.heavySteps.map(s => s.failureStatus).filter((s): s is RunPodBootstrapStatus => s !== null);
    expect(markers).toEqual(['gpu_check_failed', 'ollama_install_failed', 'ollama_serve_failed', 'model_pull_failed']);
    expect(new Set(markers).size).toBe(markers.length); // todos distintos
    const script = renderRunPodBootstrapScript(MODEL);
    for (const m of [...markers, 'pending', 'ready']) {
      expect(script).toContain(`echo ${m} > ${RUNPOD_BOOTSTRAP_STATUS_PATH}`);
    }
    // Nenhum `|| true` que engula falhas silenciosamente.
    expect(script).not.toContain('|| true');
  });

  // #7 — o worker é ISOLADO do shell do container e o durável fica FORA do worker.
  test('#7 worker isolado (nohup bash -c, set +e) e durável fora do worker; sem `&;` inválido', () => {
    const script = renderRunPodBootstrapScript(MODEL);
    expect(script).toContain("nohup bash -c '");     // worker roda em shell própria
    const workerBody = renderRunPodHeavyWorkerBody(plan());
    expect(workerBody.startsWith('set +e')).toBe(true); // worker NÃO aborta no 1º erro; trata cada um
    expect(workerBody).not.toContain("'");             // embutível com segurança em bash -c '...'
    // O comando durável está DEPOIS do fechamento do worker (última aspa simples) ⇒ um exit do worker
    // jamais alcança o sshd durável.
    expect(script.lastIndexOf("'")).toBeLessThan(script.lastIndexOf(RUNPOD_BOOTSTRAP_DURABLE_COMMAND));
    // Regressão de sintaxe: `cmd &` seguido de `;` é erro de shell — usamos newline entre worker e durável.
    expect(script).not.toContain('&;');
    // A linha de lançamento do worker termina em `&` (background), não em `;`.
    const durableIdx = script.lastIndexOf(RUNPOD_BOOTSTRAP_DURABLE_COMMAND);
    expect(script.slice(0, durableIdx).trimEnd().endsWith('&')).toBe(true);
    // O durável não contém nada pesado.
    expect(RUNPOD_BOOTSTRAP_DURABLE_COMMAND).not.toMatch(/nvidia|ollama/);
  });

  test('modelo inseguro ⇒ exit 64 (fail-closed) e plano null', () => {
    expect(isSafeRunPodModel('bad model; rm -rf /')).toBe(false);
    expect(planRunPodBootstrap('bad model; rm -rf /')).toBeNull();
    expect(renderRunPodBootstrapScript('bad model; rm -rf /')).toBe('exit 64');
    expect(isSafeRunPodModel(MODEL)).toBe(true);
  });
});
