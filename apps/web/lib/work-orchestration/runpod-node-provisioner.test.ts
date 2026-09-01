/** @jest-environment node */
import type { NodeLeaseV0, NodeProvisionRequest, ProvisionedNodeHandle } from '@anima/core';
import {
  RunPodNodeProvisioner,
  classifyRunPodError,
  readRunPodProvisionerConfig,
  type HttpClient,
  type HttpRequestInput,
  type HttpResponse,
  type RunPodProvisionerConfig,
} from './runpod-node-provisioner';

const API_KEY = 'rp_secret_KEY_abc123';
const BASE = 'https://runpod.test/v1';

const config = (over: Partial<RunPodProvisionerConfig> = {}): RunPodProvisionerConfig => ({
  apiBase: BASE, apiKey: API_KEY, imageName: 'ollama/ollama:latest', gpuTypeIds: ['NVIDIA A40'],
  gpuCount: 1, cloudType: 'SECURE', containerDiskInGb: 50, volumeInGb: 0, networkVolumeId: null,
  inferencePort: 11434, healthPath: '/', podEnv: {}, ...over,
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
const runningPod = (over: Record<string, unknown> = {}) => ({ id: 'pod-1', name: 'anima-node-1', desiredStatus: 'RUNNING', publicIp: '1.2.3.4', portMappings: { '11434': 20000 }, costPerHr: 0.44, ...over });

const opts = { pollIntervalMs: 1, maxProvisionMs: 1_000, healthTimeoutMs: 50, sleep: async () => undefined, now: () => 1_000 } as const;
const request: NodeProvisionRequest = {
  nodeId: 'node-1', providerId: 'runpod', model: 'qwen3-coder:latest', resourceClass: 'gpu-a40',
  lease: { schemaVersion: 1, nodeId: 'node-1', providerId: 'runpod', billingMode: 'paid', workItemId: 'w1', attemptId: 'a1', maxActiveDurationMs: 1800000, idleTimeoutMs: 60000, leaseExpiresAt: '2030-01-01T00:00:00Z', authorizationRef: 'auth-1', priceHint: null } as NodeLeaseV0,
};
const handle: ProvisionedNodeHandle = { nodeId: 'node-1', providerId: 'runpod', endpoint: 'http://1.2.3.4:20000', providerRef: 'pod-1' };
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

describe('RunPodNodeProvisioner', () => {
  test('provision happy path: lista→cria→poll RUNNING→handle + price hint', async () => {
    const { client, calls } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, []);
      if (req.method === 'POST' && req.url.endsWith('/pods')) return json(201, { id: 'pod-1', name: 'anima-node-1', desiredStatus: 'CREATED' });
      if (req.method === 'GET' && req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      return json(404, {});
    });
    const p = new RunPodNodeProvisioner(config(), client, opts);
    const outcome = await p.provision(request, signal());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.handle).toMatchObject({ nodeId: 'node-1', providerId: 'runpod', providerRef: 'pod-1', endpoint: 'http://1.2.3.4:20000' });
    expect(p.priceHint()).toEqual({ currency: 'USD', perHour: 0.44 });
    // toda chamada carregou o Bearer; o corpo do POST tem o envelope (sem chave).
    expect(calls.every(c => c.hasAuth)).toBe(true);
    const post = calls.find(c => c.method === 'POST');
    expect(post?.body).toContain('anima-node-1');
    expect(JSON.stringify(calls)).not.toContain(API_KEY);
  });

  test('idempotência: replay reusa pod existente por nome, NÃO cria segundo (Missão 4)', async () => {
    let posts = 0;
    const { client } = fakeHttp((req) => {
      if (req.method === 'GET' && req.url.endsWith('/pods')) return json(200, [runningPod({ desiredStatus: 'RUNNING' })]);
      if (req.method === 'POST' && req.url.endsWith('/pods')) { posts += 1; return json(201, { id: 'pod-2', name: 'anima-node-1' }); }
      if (req.method === 'GET' && req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      return json(404, {});
    });
    const p = new RunPodNodeProvisioner(config(), client, opts);
    const outcome = await p.provision(request, signal());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.handle.providerRef).toBe('pod-1'); // reusou
    expect(posts).toBe(0); // nenhum recurso novo criado
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

  test('inspect: RUNNING + health externo 200 → healthy (Goma verifica por fora, Missão 7)', async () => {
    const { client, calls } = fakeHttp((req) => {
      if (req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      if (req.url === 'http://1.2.3.4:20000/') return json(200, 'ok');
      return json(404, {});
    });
    const report = await new RunPodNodeProvisioner(config(), client, opts).inspect(handle, signal());
    expect(report).toMatchObject({ nodeId: 'node-1', reachable: true, healthy: true });
    // fez as DUAS verificações: status do provider E endpoint externo.
    expect(calls.some(c => c.url.endsWith('/pods/pod-1'))).toBe(true);
    expect(calls.some(c => c.url === 'http://1.2.3.4:20000/')).toBe(true);
  });

  test('inspect: provider RUNNING mas endpoint externo cai → healthy=false', async () => {
    const { client } = fakeHttp((req) => {
      if (req.url.endsWith('/pods/pod-1')) return json(200, runningPod());
      return 'network'; // health externo inalcançável
    });
    const report = await new RunPodNodeProvisioner(config(), client, opts).inspect(handle, signal());
    expect(report).toMatchObject({ reachable: true, healthy: false });
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
