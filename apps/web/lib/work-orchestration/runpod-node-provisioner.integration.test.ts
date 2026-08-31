/** @jest-environment node */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NodeLeaseV0, NodeProvisionRequest } from '@anima/core';
import { RunPodNodeProvisioner, fetchHttpClient, type RunPodProvisionerConfig } from './runpod-node-provisioner';

// ============================================================
// PROVA DO BOUNDARY (Missão 11) — test server local que EMULA a API do RunPod + o endpoint de
// inferência, exercitando o adapter pelo `fetchHttpClient` REAL. Sem cloud, sem gasto. Prova:
// adapter escolhido → requests corretos (Bearer + envelope) → providerRef persistível →
// inspect (health externo) → stop → destroy. Lifecycle/evidência continuam FORA do adapter
// (o adapter só devolve handle/status/outcome — nada de evidência).
// ============================================================

const API_KEY = 'rp_test_integration_key';
let server: Server;
let base: string;
const created: Array<Record<string, unknown>> = [];
const stopped: string[] = [];
const destroyed: string[] = [];
const authHeaders: string[] = [];
let serverLog = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    authHeaders.push(req.headers.authorization ?? '');
    const url = req.url ?? '';
    const method = req.method ?? 'GET';
    const port = (server.address() as AddressInfo).port;
    const jsonRes = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };

    if (url === '/' && method === 'GET') { res.writeHead(200); res.end('ok'); return; } // endpoint de inferência (health)
    if (url === '/v1/pods' && method === 'GET') { jsonRes(200, []); return; }
    if (url === '/v1/pods' && method === 'POST') {
      let body = ''; req.on('data', c => { body += c; });
      req.on('end', () => { const parsed = JSON.parse(body) as Record<string, unknown>; created.push(parsed); jsonRes(201, { id: 'pod-int', name: parsed.name, desiredStatus: 'RUNNING' }); });
      return;
    }
    const m = /^\/v1\/pods\/([^/]+)(\/stop)?$/.exec(url);
    if (m && !m[2] && method === 'GET') { jsonRes(200, { id: m[1], desiredStatus: 'RUNNING', publicIp: '127.0.0.1', portMappings: { '11434': port }, costPerHr: 0.5 }); return; }
    if (m && m[2] === '/stop' && method === 'POST') { stopped.push(m[1]!); jsonRes(200, {}); return; }
    if (m && !m[2] && method === 'DELETE') { destroyed.push(m[1]!); jsonRes(200, {}); return; }
    jsonRes(404, {});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

const config = (): RunPodProvisionerConfig => ({
  apiBase: base, apiKey: API_KEY, imageName: 'ollama/ollama:latest', gpuTypeIds: ['NVIDIA A40'],
  gpuCount: 1, cloudType: 'SECURE', containerDiskInGb: 50, volumeInGb: 0, networkVolumeId: null,
  inferencePort: 11434, healthPath: '/', podEnv: { OLLAMA_KEEP_ALIVE: '30m' },
});

const request: NodeProvisionRequest = {
  nodeId: 'node-int', providerId: 'runpod', model: 'qwen3-coder:latest', resourceClass: 'gpu-a40',
  lease: { schemaVersion: 1, nodeId: 'node-int', providerId: 'runpod', billingMode: 'paid', workItemId: 'w1', attemptId: 'a1', maxActiveDurationMs: 1800000, idleTimeoutMs: 60000, leaseExpiresAt: '2030-01-01T00:00:00Z', authorizationRef: 'auth-1', priceHint: null } as NodeLeaseV0,
};

test('boundary real: provision→inspect→stop→destroy contra servidor local (sem cloud)', async () => {
  const spy = jest.spyOn(console, 'log').mockImplementation((...a) => { serverLog += a.join(' '); });
  try {
    const provisioner = new RunPodNodeProvisioner(config(), fetchHttpClient, { pollIntervalMs: 1, sleep: async () => undefined });
    const signal = new AbortController().signal;

    const outcome = await provisioner.provision(request, signal);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.handle).toMatchObject({ nodeId: 'node-int', providerId: 'runpod', providerRef: 'pod-int' });
    expect(outcome.handle.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(provisioner.priceHint()).toEqual({ currency: 'USD', perHour: 0.5 });

    // Requests corretos: create com nome determinístico + envelope (imagem, ports, env do pod).
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: 'anima-node-int', imageName: 'ollama/ollama:latest', computeType: 'GPU', ports: ['11434/http'], env: { OLLAMA_KEEP_ALIVE: '30m' } });

    // inspect faz o health EXTERNO (Goma verifica por fora) contra o endpoint real.
    const report = await provisioner.inspect(outcome.handle, signal);
    expect(report).toMatchObject({ nodeId: 'node-int', reachable: true, healthy: true });

    // providerRef basta para stop/destroy (persistível; retoma após restart).
    expect((await provisioner.stop(outcome.handle, signal)).ok).toBe(true);
    expect(stopped).toContain('pod-int');
    expect((await provisioner.destroy(outcome.handle, signal)).ok).toBe(true);
    expect(destroyed).toContain('pod-int');

    // Bearer presente em toda chamada de controle; a API key NUNCA foi logada pelo adapter.
    expect(authHeaders.some(h => h.startsWith('Bearer '))).toBe(true);
    expect(serverLog).not.toContain(API_KEY);
  } finally {
    spy.mockRestore();
  }
});
