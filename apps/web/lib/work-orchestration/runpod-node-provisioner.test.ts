/** @jest-environment node */
import type { NodeLeaseV0, NodeProvisionRequest, ProvisionedNodeHandle } from '@anima/core';
import {
  RunPodNodeProvisioner,
  classifyRunPodError,
  fetchHttpClient,
  readRunPodProvisionerConfig,
  runpodHttpTimeoutMs,
  DEFAULT_RUNPOD_HTTP_TIMEOUT_MS,
  netTcpProbe,
  runpodEndpointPublicationDeadlineMs,
  DEFAULT_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS,
  type HttpClient,
  type HttpRequestInput,
  type HttpResponse,
  type RunPodProvisionerConfig,
} from './runpod-node-provisioner';
import type { RunPodTunnelManager, RunPodSshTarget } from './runpod-ssh-tunnel';
import type { TcpProbe, TcpReachability } from './runpod-node-provisioner';
import { renderRunPodBootstrapScript, RUNPOD_BOOTSTRAP_DURABLE_COMMAND } from './runpod-bootstrap';

const API_KEY = 'rp_secret_KEY_abc123';
const BASE = 'https://runpod.test/v1';

const config = (over: Partial<RunPodProvisionerConfig> = {}): RunPodProvisionerConfig => ({
  apiBase: BASE, apiKey: API_KEY, imageName: 'ollama/ollama:latest', gpuTypeIds: ['NVIDIA A40'],
  gpuCount: 1, cloudType: 'SECURE', containerDiskInGb: 50, volumeInGb: 0, networkVolumeId: null,
  inferencePort: 11434, healthPath: '/', podEnv: {},
  sshPrivateKeyPath: 'test-key', sshKnownHostsPath: 'test-known-hosts', sshPublicKey: 'ssh-ed25519 TEST', ...over,
});

interface Recorded { method: string; url: string; hasAuth: boolean; body?: string }

/** HTTP fake: `handler(req, calls)` devolve um HttpResponse ou 'network' (lança). Registra tudo. */
function fakeHttp(handler: (req: HttpRequestInput, prior: readonly Recorded[]) => HttpResponse | 'network'): { client: HttpClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client: HttpClient = {
    async send(req) {
      const record: Recorded = { method: req.method, url: req.url, hasAuth: (req.headers?.Authorization ?? '').includes('Bearer'), ...(req.body ? { body: req.body } : {}) };
      const result = handler(req, calls);
      calls.push(record);
      if (result === 'network') throw new Error('ECONNREFUSED');
      return result;
    },
  };
  return { client, calls };
}

const json = (status: number, value: unknown): HttpResponse => ({ status, body: JSON.stringify(value) });
const runningPod = (over: Record<string, unknown> = {}) => ({ id: 'pod-1', name: 'anima-node-1', desiredStatus: 'RUNNING', publicIp: '1.2.3.4', portMappings: { '22': 20022 }, costPerHr: 0.44, ...over });

const tunnelManager: RunPodTunnelManager = { open: async () => ({ endpoint: 'http://127.0.0.1:21434', close: async () => undefined }), closeAll: async () => undefined };
// Sonda TCP default dos testes: endpoint sempre roteável (o cold-start de TCP/mapping é exercitado
// explicitamente na suíte de readiness em camadas, com sondas dedicadas).
const reachableProbe: TcpProbe = { probe: async () => 'reachable' };
const opts = { pollIntervalMs: 1, maxProvisionMs: 1_000, healthTimeoutMs: 50, sleep: async () => undefined, now: () => 1_000, tunnelManager, tcpProbe: reachableProbe } as const;
const request: NodeProvisionRequest = {
  nodeId: 'node-1', providerId: 'runpod', model: 'qwen3-coder:latest', resourceClass: 'gpu-a40',
  lease: { schemaVersion: 1, nodeId: 'node-1', providerId: 'runpod', billingMode: 'paid', workItemId: 'w1', attemptId: 'a1', maxActiveDurationMs: 1800000, idleTimeoutMs: 60000, leaseExpiresAt: '2030-01-01T00:00:00Z', authorizationRef: 'auth-1', priceHint: null } as NodeLeaseV0,
};
const handle: ProvisionedNodeHandle = { nodeId: 'node-1', providerId: 'runpod', endpoint: 'http://127.0.0.1:21434', providerRef: 'pod-1' };
const signal = () => new AbortController().signal;

describe('readRunPodProvisionerConfig', () => {
  test('fail-closed sem API key (Missão 6)', () => {
    expect(readRunPodProvisionerConfig({ ANIMA_RUNPOD_IMAGE: 'i', ANIMA_RUNPOD_GPU_TYPE_IDS: 'A40' })).toBeNull();
  });
  test('fail-closed sem imagem/GPU', () => {
    expect(readRunPodProvisionerConfig({ ANIMA_RUNPOD_API_KEY: 'k', ANIMA_RUNPOD_GPU_TYPE_IDS: 'A40' })).toBeNull();
    expect(readRunPodProvisionerConfig({ ANIMA_RUNPOD_API_KEY: 'k', ANIMA_RUNPOD_IMAGE: 'i' })).toBeNull();
  });
  test('lê envelope completo do env (nunca devolve a chave por outra via além do adapter)', () => {
    const cfg = readRunPodProvisionerConfig({
      ANIMA_RUNPOD_API_KEY: 'k', ANIMA_RUNPOD_IMAGE: 'ollama/ollama', ANIMA_RUNPOD_GPU_TYPE_IDS: 'A40, A100',
      ANIMA_RUNPOD_CLOUD_TYPE: 'community', ANIMA_RUNPOD_INFERENCE_PORT: '11434', ANIMA_RUNPOD_API_BASE: 'https://x/v1/',
      ANIMA_RUNPOD_SSH_PRIVATE_KEY: 'key', ANIMA_RUNPOD_SSH_KNOWN_HOSTS: 'known', ANIMA_RUNPOD_SSH_PUBLIC_KEY: 'ssh-ed25519 pub',
    });
    expect(cfg).toMatchObject({ imageName: 'ollama/ollama', gpuTypeIds: ['A40', 'A100'], cloudType: 'COMMUNITY', inferencePort: 11434, apiBase: 'https://x/v1' });
  });
});

describe('classifyRunPodError (Missão 5)', () => {
  test('mapeia status/mensagem para códigos estáveis', () => {
    expect(classifyRunPodError(401, '')).toBe('auth_invalid');
    expect(classifyRunPodError(403, '')).toBe('auth_invalid');
    expect(classifyRunPodError(429, '')).toBe('rate_limited');
    expect(classifyRunPodError(402, '')).toBe('quota_exceeded');
    expect(classifyRunPodError(400, 'insufficient balance')).toBe('quota_exceeded');
    expect(classifyRunPodError(400, 'no available GPUs in this region')).toBe('capacity_unavailable');
    expect(classifyRunPodError(500, '')).toBe('provider_unreachable');
    expect(classifyRunPodError(400, 'weird')).toBe('provision_failed');
  });
});

// ============================================================
// ANTI-HANG: o transporte HTTP tem timeout POR REQUISIÇÃO. Sem ele, um único `fetch` cuja
// conexão abre e nunca responde (clássico em cold-start) penduraria o host-turn para sempre em
// `state=running` — os deadlines dos laços de provisão só são checados ENTRE requisições. Aqui
// provamos o boundary do transporte diretamente, mockando o `fetch` global.
// ============================================================
describe('fetchHttpClient — timeout por requisição (anti-hang)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; delete process.env.ANIMA_RUNPOD_HTTP_TIMEOUT_MS; });

  test('teto default e override por env (bounded, positivo)', () => {
    expect(runpodHttpTimeoutMs({})).toBe(DEFAULT_RUNPOD_HTTP_TIMEOUT_MS);
    expect(runpodHttpTimeoutMs({ ANIMA_RUNPOD_HTTP_TIMEOUT_MS: '1234' })).toBe(1234);
    expect(runpodHttpTimeoutMs({ ANIMA_RUNPOD_HTTP_TIMEOUT_MS: '0' })).toBe(DEFAULT_RUNPOD_HTTP_TIMEOUT_MS);
    expect(runpodHttpTimeoutMs({ ANIMA_RUNPOD_HTTP_TIMEOUT_MS: 'nope' })).toBe(DEFAULT_RUNPOD_HTTP_TIMEOUT_MS);
  });

  test('requisição pendurada é abortada dentro do teto → lança (não pendura o host-turn)', async () => {
    process.env.ANIMA_RUNPOD_HTTP_TIMEOUT_MS = '25';
    let aborted = false;
    // `fetch` que NUNCA responde mas HONRA o abort — como o fetch real do Node sob AbortSignal.
    global.fetch = ((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('The operation was aborted.', 'AbortError')); });
    })) as unknown as typeof fetch;
    const start = Date.now();
    await expect(fetchHttpClient.send({ method: 'GET', url: 'https://x/pods', signal: new AbortController().signal }))
      .rejects.toBeDefined();
    expect(aborted).toBe(true);
    expect(Date.now() - start).toBeLessThan(2_000); // bounded — jamais pendura
  });

  test('requisição normal NÃO é abortada (execução válida preservada)', async () => {
    process.env.ANIMA_RUNPOD_HTTP_TIMEOUT_MS = '10000';
    global.fetch = (async () => ({ status: 200, text: async () => 'ok' })) as unknown as typeof fetch;
    const res = await fetchHttpClient.send({ method: 'GET', url: 'https://x/pods', signal: new AbortController().signal });
    expect(res).toEqual({ status: 200, body: 'ok' });
  });

  test('cancelamento do chamador aborta a requisição (composição de sinais)', async () => {
    process.env.ANIMA_RUNPOD_HTTP_TIMEOUT_MS = '60000';
    const caller = new AbortController();
    global.fetch = ((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const pending = fetchHttpClient.send({ method: 'GET', url: 'https://x', signal: caller.signal });
    caller.abort();
    await expect(pending).rejects.toBeDefined();
  });
});

describe('RunPodNodeProvisioner', () => {
  test('provision happy path: lista→cria→poll RUNNING→handle + price hint', async () => {
    const { client, calls } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
      if (req.method === 'POST' && req.url.endsWith('/pods')) return json(201, { id: 'pod-1', name: 'anima-node-1', desiredStatus: 'CREATED' });
      if (req.method === 'GET' && req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      if (req.url === 'http://127.0.0.1:21434/api/tags') return json(200, { models: [{ name: 'qwen3-coder:latest' }] });
      return json(404, {});
    });
    const p = new RunPodNodeProvisioner(config(), client, opts);
    const outcome = await p.provision(request, signal());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.handle).toMatchObject({ nodeId: 'node-1', providerId: 'runpod', providerRef: 'pod-1', endpoint: 'http://127.0.0.1:21434' });
    expect(p.priceHint()).toEqual({ currency: 'USD', perHour: 0.44 });
    // toda chamada à API do RunPod carregou o Bearer; o corpo do POST tem o envelope (sem chave).
    // (o probe de modelo bate no endpoint loopback do Ollama pelo túnel, que NÃO leva Bearer.)
    expect(calls.filter(c => c.url.startsWith(BASE)).every(c => c.hasAuth)).toBe(true);
    expect(calls.some(c => c.url === 'http://127.0.0.1:21434/api/tags' && !c.hasAuth)).toBe(true);
    const post = calls.find(c => c.method === 'POST');
    expect(post?.body).toContain('anima-node-1');
    expect(JSON.stringify(calls)).not.toContain(API_KEY);
  });

  test('cold-start: túnel só aceita após N tentativas → openTunnel faz retry bounded e conclui', async () => {
    let tries = 0;
    const flakyTunnel: RunPodTunnelManager = {
      open: async () => { tries += 1; if (tries < 3) throw new Error('tunnel_failed'); return { endpoint: 'http://127.0.0.1:21434', close: async () => undefined }; },
      closeAll: async () => undefined,
    };
    const { client } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
      if (req.method === 'POST' && req.url.endsWith('/pods')) return json(201, { id: 'pod-1', name: 'anima-node-1' });
      if (req.method === 'GET' && req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      if (req.url === 'http://127.0.0.1:21434/api/tags') return json(200, { models: [{ name: 'qwen3-coder:latest' }] });
      return json(404, {});
    });
    const outcome = await new RunPodNodeProvisioner(config(), client, { ...opts, tunnelManager: flakyTunnel }).provision(request, signal());
    expect(outcome.ok).toBe(true);
    expect(tries).toBe(3); // tentou de novo até o sshd aceitar (cold-start)
  });

  test('cold-start: modelo só aparece após o pull → provision espera /api/tags conter o modelo', async () => {
    let tagCalls = 0;
    const { client } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
      if (req.method === 'POST' && req.url.endsWith('/pods')) return json(201, { id: 'pod-1', name: 'anima-node-1' });
      if (req.method === 'GET' && req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      if (req.url === 'http://127.0.0.1:21434/api/tags') { tagCalls += 1; return json(200, { models: tagCalls < 2 ? [] : [{ name: 'qwen3-coder:latest' }] }); }
      return json(404, {});
    });
    const outcome = await new RunPodNodeProvisioner(config(), client, opts).provision(request, signal());
    expect(outcome.ok).toBe(true);
    expect(tagCalls).toBeGreaterThanOrEqual(2); // esperou o pull terminar antes de reportar pronto
  });

  test('cold-start: modelo nunca fica pronto (deadline) → provision_failed (caller faz teardown)', async () => {
    let t = 0;
    const { client } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
      if (req.method === 'POST' && req.url.endsWith('/pods')) return json(201, { id: 'pod-1', name: 'anima-node-1' });
      if (req.method === 'GET' && req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      if (req.url === 'http://127.0.0.1:21434/api/tags') return json(200, { models: [{ name: 'outro:latest' }] });
      return json(404, {});
    });
    const p = new RunPodNodeProvisioner(config(), client, { ...opts, modelReadyTimeoutMs: 500, now: () => (t += 400) });
    expect(await p.provision(request, signal())).toEqual({ ok: false, reason: 'provision_failed' });
  });

  test('idempotência: replay reusa pod existente por nome, NÃO cria segundo (Missão 4)', async () => {
    let posts = 0;
    const { client } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, [runningPod({ desiredStatus: 'RUNNING' })]);
      if (req.method === 'POST' && req.url.endsWith('/pods')) { posts += 1; return json(201, { id: 'pod-2', name: 'anima-node-1' }); }
      if (req.method === 'GET' && req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      if (req.url === 'http://127.0.0.1:21434/api/tags') return json(200, { models: [{ name: 'qwen3-coder:latest' }] });
      return json(404, {});
    });
    const p = new RunPodNodeProvisioner(config(), client, opts);
    const outcome = await p.provision(request, signal());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.handle.providerRef).toBe('pod-1'); // reusou
    expect(posts).toBe(0); // nenhum recurso novo criado
  });

  test('create ambíguo: resposta perdida; replay encontra por nome, persiste identidade e não duplica', async () => {
    let exists = false; let posts = 0; let identifiedRef: string | null = null;
    const { client } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) {
        return json(200, exists ? [runningPod({ name: 'anima-node-1' })] : []);
      }
      if (req.method === 'POST' && req.url.endsWith('/pods')) {
        posts += 1; exists = true; return 'network'; // provider criou, resposta se perdeu
      }
      if (req.method === 'GET' && req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      if (req.url === 'http://127.0.0.1:21434/api/tags') return json(200, { models: [{ name: 'qwen3-coder:latest' }] });
      return json(404, {});
    });
    const provisioner = new RunPodNodeProvisioner(config(), client, opts);
    expect(await provisioner.provision(request, signal())).toEqual({ ok: false, reason: 'provider_unreachable' });
    const replay = await provisioner.provision(request, signal(), {
      providerIdentified: async identity => { identifiedRef = identity.providerRef; return true; },
    });
    expect(replay.ok).toBe(true);
    expect(identifiedRef).toBe('pod-1');
    expect(posts).toBe(1);
  });

  test('observer recebe o id ANTES do 1º poll de readiness; false → falha sem readiness', async () => {
    const { client, calls } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
      if (req.method === 'POST' && req.url.endsWith('/pods')) return json(201, { id: 'pod-1', name: 'anima-node-1', desiredStatus: 'CREATED' });
      if (req.method === 'GET' && req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      return json(404, {});
    });
    let identifiedRef: string | null = null;
    let readinessGetsAtIdentify = -1;
    const observer = { providerIdentified: async (identity: { nodeId: string; providerId: string; providerRef: string }) => {
      identifiedRef = identity.providerRef;
      readinessGetsAtIdentify = calls.filter(c => c.url.endsWith('/pods/pod-1')).length;
      return false; // identidade não ficou durável
    } };
    const outcome = await new RunPodNodeProvisioner(config(), client, opts).provision(request, signal(), observer);
    expect(identifiedRef).toBe('pod-1');
    expect(readinessGetsAtIdentify).toBe(0); // nenhum GET de readiness antes do observer
    expect(outcome).toEqual({ ok: false, reason: 'provider_identity_unpersisted' });
    expect(calls.some(c => c.url.endsWith('/pods/pod-1'))).toBe(false); // parou; não pollou readiness
  });

  test('replay: pod existente por nome → observer recebe id, sem POST create, segue se true', async () => {
    let posts = 0; let identifiedRef: string | null = null;
    const { client } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, [runningPod({ name: 'anima-node-1' })]);
      if (req.method === 'POST' && req.url.endsWith('/pods')) { posts += 1; return json(201, { id: 'pod-2', name: 'anima-node-1' }); }
      if (req.method === 'GET' && req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      if (req.url === 'http://127.0.0.1:21434/api/tags') return json(200, { models: [{ name: 'qwen3-coder:latest' }] });
      return json(404, {});
    });
    const observer = { providerIdentified: async (identity: { providerRef: string }) => { identifiedRef = identity.providerRef; return true; } };
    const outcome = await new RunPodNodeProvisioner(config(), client, opts).provision(request, signal(), observer);
    expect(identifiedRef).toBe('pod-1'); // do pod EXISTENTE, não um novo
    expect(posts).toBe(0); // nenhum recurso novo criado
    expect(outcome.ok).toBe(true);
  });

  test('auth inválida → auth_invalid, sem vazar a chave (Missões 5+6)', async () => {
    const { client } = fakeHttp(() => json(401, { error: `invalid key ${API_KEY}` }));
    const p = new RunPodNodeProvisioner(config(), client, opts);
    const outcome = await p.provision(request, signal());
    expect(outcome).toEqual({ ok: false, reason: 'auth_invalid' });
    expect(JSON.stringify(outcome)).not.toContain(API_KEY);
  });

  test('capacidade indisponível na criação → capacity_unavailable', async () => {
    const { client } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
      return json(400, { error: 'no available GPUs' });
    });
    const outcome = await new RunPodNodeProvisioner(config(), client, opts).provision(request, signal());
    expect(outcome).toEqual({ ok: false, reason: 'capacity_unavailable' });
  });

  test('rate limit → rate_limited', async () => {
    const { client } = fakeHttp(() => json(429, { error: 'too many requests' }));
    expect(await new RunPodNodeProvisioner(config(), client, opts).provision(request, signal())).toEqual({ ok: false, reason: 'rate_limited' });
  });

  test('rede indisponível → provider_unreachable', async () => {
    const { client } = fakeHttp(() => 'network');
    expect(await new RunPodNodeProvisioner(config(), client, opts).provision(request, signal())).toEqual({ ok: false, reason: 'provider_unreachable' });
  });

  test('provision nunca pronto (deadline) → capacity_unavailable', async () => {
    let t = 0;
    const { client } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
      if (req.method === 'POST' && req.url.endsWith('/pods')) return json(201, { id: 'pod-1', name: 'anima-node-1' });
      return json(200, runningPod({ desiredStatus: 'PENDING', publicIp: null, portMappings: {} }));
    });
    const p = new RunPodNodeProvisioner(config(), client, { ...opts, now: () => (t += 400) });
    expect(await p.provision(request, signal())).toEqual({ ok: false, reason: 'capacity_unavailable' });
  });

  test('RUNNING mas endpoint nunca publica dentro da janela → endpoint_unpublished (não capacity_unavailable)', async () => {
    // Reproduz a prova viva 2026-09-10: pod fica RUNNING com publicIp/portMappings vazios além do
    // deadline. A capacidade EXISTIU; a janela de publicação do endpoint foi curta. A atribuição
    // deixa de culpar falsamente a capacidade e emite diagnóstico estruturado.
    const errors: string[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ')); });
    try {
      let t = 0;
      const { client } = fakeHttp((req) => {
        if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
        if (req.method === 'POST' && req.url.endsWith('/pods')) return json(201, { id: 'pod-1', name: 'anima-node-1' });
        return json(200, runningPod({ desiredStatus: 'RUNNING', publicIp: '', portMappings: {} }));
      });
      const p = new RunPodNodeProvisioner(config(), client, { ...opts, now: () => (t += 400) });
      expect(await p.provision(request, signal())).toEqual({ ok: false, reason: 'endpoint_unpublished' });
      expect(errors.some(line => line.includes('runpod_endpoint_unpublished') && line.includes('"podId":"pod-1"'))).toBe(true);
    } finally { spy.mockRestore(); }
  });

  test('endpointPublicationDeadlineMs é a política explícita do deadline (precede o alias maxProvisionMs)', () => {
    // Default conservador documentado, na faixa 480–600s da evidência 2026-09-10.
    expect(runpodEndpointPublicationDeadlineMs({})).toBe(DEFAULT_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS);
    expect(DEFAULT_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS).toBeGreaterThanOrEqual(480_000);
    expect(DEFAULT_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS).toBeLessThanOrEqual(600_000);
    // Env explícito da nova política tem precedência sobre o legado ANIMA_RUNPOD_MAX_PROVISION_MS.
    expect(runpodEndpointPublicationDeadlineMs({ ANIMA_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS: '600000', ANIMA_RUNPOD_MAX_PROVISION_MS: '1' })).toBe(600_000);
    // Sem a nova, o legado ainda é honrado (retrocompat).
    expect(runpodEndpointPublicationDeadlineMs({ ANIMA_RUNPOD_MAX_PROVISION_MS: '480000' })).toBe(480_000);
  });

  test('opção endpointPublicationDeadlineMs governa awaitEndpoint (RUNNING sem endpoint → endpoint_unpublished ao estourá-la)', async () => {
    let t = 0;
    const { client } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
      if (req.method === 'POST' && req.url.endsWith('/pods')) return json(201, { id: 'pod-1', name: 'anima-node-1' });
      return json(200, runningPod({ desiredStatus: 'RUNNING', publicIp: '', portMappings: {} }));
    });
    // maxProvisionMs ausente; só a nova política define a janela (deadline 500ms, relógio +200/iter).
    const p = new RunPodNodeProvisioner(config(), client, {
      pollIntervalMs: 1, endpointPublicationDeadlineMs: 500, healthTimeoutMs: 50,
      sleep: async () => undefined, now: () => (t += 200), tunnelManager, tcpProbe: reachableProbe,
    });
    expect(await p.provision(request, signal())).toEqual({ ok: false, reason: 'endpoint_unpublished' });
  });

  test('inspect: RUNNING + health externo 200 → healthy (Goma verifica por fora, Missão 7)', async () => {
    const { client, calls } = fakeHttp((req) => {
      if (req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      if (req.url === 'http://127.0.0.1:21434/api/tags') return json(200, { models: [{ name: 'qwen3-coder:latest' }] });
      if (req.url === 'http://127.0.0.1:21434/api/chat') return json(200, { message: { content: 'OK' } });
      return json(404, {});
    });
    const report = await new RunPodNodeProvisioner(config(), client, opts).inspect(handle, signal());
    expect(report).toMatchObject({ nodeId: 'node-1', reachable: true, healthy: true });
    // fez as DUAS verificações: status do provider E endpoint externo.
    expect(calls.some(c => c.url.endsWith('/pods/pod-1'))).toBe(true);
    expect(calls.some(c => c.url === 'http://127.0.0.1:21434/api/tags')).toBe(true);
    expect(calls.some(c => c.url === 'http://127.0.0.1:21434/api/chat')).toBe(true);
  });

  test('inspect: provider RUNNING mas endpoint externo cai → healthy=false', async () => {
    const { client } = fakeHttp((req) => {
      if (req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      return 'network'; // health externo inalcançável
    });
    const report = await new RunPodNodeProvisioner(config(), client, opts).inspect(handle, signal());
    expect(report).toMatchObject({ reachable: true, healthy: false });
  });

  test('inspect: /api/tags sem qwen3-coder falha fechado antes de chat', async () => {
    const { client, calls } = fakeHttp((req) => {
      if (req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      if (req.url.endsWith('/api/tags')) return json(200, { models: [{ name: 'outro:latest' }] });
      return json(500, {});
    });
    const report = await new RunPodNodeProvisioner(config(), client, opts).inspect(handle, signal());
    expect(report).toMatchObject({ reachable: true, healthy: false, detail: 'model missing' });
    expect(calls.some(c => c.url.endsWith('/api/chat'))).toBe(false);
  });

  test('túnel falho impede runtime e não expõe Ollama por HTTP público', async () => {
    const { client, calls } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
      if (req.method === 'POST' && req.url.endsWith('/pods')) return json(201, { id: 'pod-1', name: 'anima-node-1' });
      return json(200, runningPod());
    });
    const failedTunnel: RunPodTunnelManager = { open: async () => { throw new Error('no route'); }, closeAll: async () => undefined };
    // tunnelReadyTimeoutMs:0 ⇒ uma única tentativa (sem retry) antes de desistir, com now constante.
    // Pod criado + REST alcançável, só o túnel desta máquina não subiu ⇒ tunnel_unavailable
    // (RECUPERÁVEL por placement), NÃO provider_unreachable (que é indisponibilidade GLOBAL da REST).
    expect(await new RunPodNodeProvisioner(config(), client, { ...opts, tunnelManager: failedTunnel, tunnelReadyTimeoutMs: 0 }).provision(request, signal()))
      .toEqual({ ok: false, reason: 'tunnel_unavailable' });
    const payload = JSON.parse(calls.find(c => c.method === 'POST')!.body!) as { ports: string[]; dockerStartCmd: string[] };
    expect(payload.ports).toEqual(['22/tcp']);
    // WIRING: createPod delega a geração do bootstrap à função PURA testável (seam). O contrato
    // estrutural do script (sshd durável, worker isolado, marcadores) é coberto por runpod-bootstrap.test.ts.
    expect(payload.dockerStartCmd).toEqual([renderRunPodBootstrapScript('qwen3-coder:latest')]);
    const bootstrap = payload.dockerStartCmd[0]!;
    // ENDURECIMENTO: o processo DURÁVEL (sshd -D foreground) é a ÚLTIMA instrução — nada pesado
    // depois pode encerrá-lo; e o pull do modelo ocorre num worker isolado, não no shell do container.
    expect(bootstrap.trimEnd().endsWith(RUNPOD_BOOTSTRAP_DURABLE_COMMAND)).toBe(true);
    expect(bootstrap).toContain('timeout 1800 ollama pull qwen3-coder:latest');
  });

  test('contrato de rede: node por SSH → create expõe EXATAMENTE TCP/22 + supportPublicIp, sem extras', async () => {
    // Este adapter SEMPRE acessa o node por SSH (SshRunPodTunnelManager) ⇒ o create tem de expor
    // TCP/22 e pedir IP público, e SÓ isso. Regressão contra: porta faltando, duplicada, ou extra.
    const { client, calls } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
      if (req.method === 'POST' && req.url.endsWith('/pods')) return json(201, { id: 'pod-1', name: 'anima-node-1' });
      if (req.method === 'GET' && req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      if (req.url === 'http://127.0.0.1:21434/api/tags') return json(200, { models: [{ name: 'qwen3-coder:latest' }] });
      return json(404, {});
    });
    const outcome = await new RunPodNodeProvisioner(config(), client, opts).provision(request, signal());
    expect(outcome.ok).toBe(true);
    const payload = JSON.parse(calls.find(c => c.method === 'POST')!.body!) as { ports: string[]; supportPublicIp?: boolean };
    expect(payload.ports).toEqual(['22/tcp']);                       // shape exato do provider (REST v1)
    expect(new Set(payload.ports).size).toBe(payload.ports.length);  // sem duplicação
    expect(payload.ports.filter(p => p !== '22/tcp')).toEqual([]);   // nenhuma porta adicional
    expect(payload.supportPublicIp).toBe(true);                      // IP público pedido explicitamente
  });

  test('stop encerra o túnel antes do provider call', async () => {
    let closed = 0;
    const managed: RunPodTunnelManager = { open: async () => ({ endpoint: handle.endpoint, close: async () => { closed += 1; } }), closeAll: async () => undefined };
    const { client } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, [runningPod()]);
      if (req.url.endsWith('/api/tags')) return json(200, { models: [{ name: 'qwen3-coder:latest' }] });
      if (req.method === 'GET') return json(200, runningPod());
      return json(200, {});
    });
    const provisioner = new RunPodNodeProvisioner(config(), client, { ...opts, tunnelManager: managed });
    const provisioned = await provisioner.provision(request, signal());
    expect(provisioned.ok).toBe(true);
    if (!provisioned.ok) return;
    expect((await provisioner.stop(provisioned.handle, signal())).ok).toBe(true);
    expect(closed).toBe(1);
  });

  test('inspect: pod inexistente → diagnóstico claro (Missão 4)', async () => {
    const { client } = fakeHttp(() => json(404, {}));
    expect(await new RunPodNodeProvisioner(config(), client, opts).inspect(handle, signal())).toMatchObject({ reachable: false, healthy: false, detail: 'pod not found' });
  });

  test('stop: 200 ok; 404 idempotente; 500 stop_failed; repetido seguro (Missão 4)', async () => {
    const p200 = new RunPodNodeProvisioner(config(), fakeHttp(() => json(200, {})).client, opts);
    expect(await p200.stop(handle, signal())).toEqual({ ok: true });
    expect(await p200.stop(handle, signal())).toEqual({ ok: true }); // repetido seguro
    expect(await new RunPodNodeProvisioner(config(), fakeHttp(() => json(404, {})).client, opts).stop(handle, signal())).toEqual({ ok: true });
    expect(await new RunPodNodeProvisioner(config(), fakeHttp(() => json(500, {})).client, opts).stop(handle, signal())).toEqual({ ok: false, reason: 'stop_failed' });
  });

  test('destroy: DELETE 200/404 ok; endpoint correto', async () => {
    const { client, calls } = fakeHttp(() => json(200, {}));
    expect(await new RunPodNodeProvisioner(config(), client, opts).destroy(handle, signal())).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: `${BASE}/pods/pod-1` });
    expect(await new RunPodNodeProvisioner(config(), fakeHttp(() => json(404, {})).client, opts).destroy(handle, signal())).toEqual({ ok: true });
  });

  test('locate: encontra o pod pelo nome determinístico (reconciliação de órfão)', async () => {
    const { client } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, [runningPod({ name: 'anima-burst-9' })]);
      return json(404, {});
    });
    const located = await new RunPodNodeProvisioner(config(), client, opts).locate('burst-9', signal());
    expect(located).toMatchObject({ ok: true, found: true, handle: { nodeId: 'burst-9', providerRef: 'pod-1' } });
  });

  test('locate: sem pod com o nome → found:false; erro de rede → ok:false', async () => {
    const empty = fakeHttp(() => json(200, []));
    expect(await new RunPodNodeProvisioner(config(), empty.client, opts).locate('burst-x', signal())).toEqual({ ok: true, found: false });
    const net = fakeHttp(() => 'network');
    expect(await new RunPodNodeProvisioner(config(), net.client, opts).locate('burst-x', signal())).toMatchObject({ ok: false });
  });

  test('locate: pod terminal (EXITED) não é reconciliável → found:false', async () => {
    const { client } = fakeHttp(() => json(200, [runningPod({ name: 'anima-burst-1', desiredStatus: 'EXITED' })]));
    expect(await new RunPodNodeProvisioner(config(), client, opts).locate('burst-1', signal())).toEqual({ ok: true, found: false });
  });

  test('segredo NUNCA aparece em nenhum reason/detail de erro (Missão 6)', async () => {
    // Provider ecoa a chave no corpo de erro; o adapter redige internamente e devolve só o código.
    for (const status of [400, 401, 402, 429, 500]) {
      const { client } = fakeHttp(() => json(status, { error: `boom key=${API_KEY} Bearer ${API_KEY}` }));
      const outcome = await new RunPodNodeProvisioner(config(), client, opts).provision(request, signal());
      expect(JSON.stringify(outcome)).not.toContain(API_KEY);
    }
  });
});

// ============================================================
// READINESS EM CAMADAS (Fases 2+3): o endpoint atravessa mapping corrente → TCP roteável → SSH.
// Cada iteração RECONSULTA o provider e segue mudanças de mapping, em vez de martelar um endpoint
// stale. A camada TCP torna "publicado mas não roteável" (a falha da última prova viva) atribuível
// por si, separada de "sshd/handshake ainda não pronto". Zero rede real: HTTP, túnel e sonda TCP
// são todos fakes determinísticos.
// ============================================================
describe('RunPodNodeProvisioner — readiness TCP/mapping em camadas', () => {
  const recordingTunnel = () => {
    const opens: RunPodSshTarget[] = [];
    const manager: RunPodTunnelManager = {
      open: async (target) => { opens.push(target); return { endpoint: 'http://127.0.0.1:21434', close: async () => undefined }; },
      closeAll: async () => undefined,
    };
    return { manager, opens };
  };
  const httpForRunningPod = (podFor: (getPodCall: number) => Record<string, unknown>) => {
    let getPodCalls = 0;
    return fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
      if (req.method === 'POST' && req.url.endsWith('/pods')) return json(201, { id: 'pod-1', name: 'anima-node-1', desiredStatus: 'CREATED' });
      if (req.method === 'GET' && req.url.endsWith('/pods/pod-1')) { getPodCalls += 1; return json(200, podFor(getPodCalls)); }
      if (req.url === 'http://127.0.0.1:21434/api/tags') return json(200, { models: [{ name: 'qwen3-coder:latest' }] });
      return json(404, {});
    });
  };

  test('Fase 3: mapping muda durante readiness → túnel segue o novo publicIp:port', async () => {
    // 1º getPod (awaitEndpoint) publica 1.2.3.4:20022; a partir daí o RunPod re-roteia para
    // 5.6.7.8:30033. Só o endpoint novo é roteável — martelar o antigo nunca abriria.
    const { client } = httpForRunningPod((n) => n <= 1
      ? runningPod({ publicIp: '1.2.3.4', portMappings: { '22': 20022 } })
      : runningPod({ publicIp: '5.6.7.8', portMappings: { '22': 30033 } }));
    const { manager, opens } = recordingTunnel();
    const probe: TcpProbe = { probe: async (_host, port) => (port === 30033 ? 'reachable' : 'timeout') };
    const outcome = await new RunPodNodeProvisioner(config(), client, { ...opts, tunnelManager: manager, tcpProbe: probe }).provision(request, signal());
    expect(outcome.ok).toBe(true);
    expect(opens).toHaveLength(1); // uma única abertura — no endpoint CORRENTE, não no stale
    expect(opens[0]).toMatchObject({ publicIp: '5.6.7.8', port: 30033 });
  });

  test('Fase 2: TCP nunca roteável → ssh NÃO é tentado; tunnel_unavailable (recuperável) com fase tcp_unreachable', async () => {
    const errors: string[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ')); });
    try {
      const { client } = httpForRunningPod(() => runningPod());
      const { manager, opens } = recordingTunnel();
      const probe: TcpProbe = { probe: async () => 'timeout' as TcpReachability };
      // tunnelReadyTimeoutMs:0 com now constante ⇒ exatamente uma passada antes de desistir.
      const outcome = await new RunPodNodeProvisioner(config(), client, { ...opts, tunnelManager: manager, tcpProbe: probe, tunnelReadyTimeoutMs: 0 }).provision(request, signal());
      expect(outcome).toEqual({ ok: false, reason: 'tunnel_unavailable' });
      expect(opens).toHaveLength(0); // TCP não roteável ⇒ o ssh jamais foi tentado
      expect(errors.some(line => line.includes('runpod_tunnel_open_failed') && line.includes('"phase":"tcp_unreachable"'))).toBe(true);
    } finally { spy.mockRestore(); }
  });

  test('cold-start TCP: roteável só após N sondas → abre o túnel na tentativa em que fica roteável', async () => {
    const { client } = httpForRunningPod(() => runningPod());
    const { manager, opens } = recordingTunnel();
    let n = 0;
    const probe: TcpProbe = { probe: async () => ((n += 1) < 3 ? 'timeout' : 'reachable') };
    const outcome = await new RunPodNodeProvisioner(config(), client, { ...opts, tunnelManager: manager, tcpProbe: probe }).provision(request, signal());
    expect(outcome.ok).toBe(true);
    expect(n).toBeGreaterThanOrEqual(3); // sondou até rotear (cold-start de roteamento)
    expect(opens).toHaveLength(1);
  });

  test('sonda TCP default classifica connect/refused/timeout sem abrir túnel', async () => {
    const { createServer } = await import('node:net');
    // Servidor efêmero: connect real → reachable.
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no port');
    try {
      expect(await netTcpProbe.probe('127.0.0.1', addr.port, 500, new AbortController().signal)).toBe('reachable');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    // Porta agora fechada no loopback → refused (rápido, determinístico).
    expect(await netTcpProbe.probe('127.0.0.1', addr.port, 500, new AbortController().signal)).toBe('refused');
    // signal já abortado → error sem tocar a rede.
    const aborted = new AbortController(); aborted.abort();
    expect(await netTcpProbe.probe('127.0.0.1', addr.port, 500, aborted.signal)).toBe('error');
  });
});
