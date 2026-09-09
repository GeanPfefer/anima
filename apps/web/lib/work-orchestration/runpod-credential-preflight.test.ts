/** @jest-environment node */
import { assessRunPodCredentialReadOnly } from './runpod-credential-preflight';
import type { HttpClient, HttpRequestInput } from './runpod-node-provisioner';

const config = { apiBase: 'https://rest.runpod.io/v1', apiKey: 'rp_secret_test' };
const signal = () => new AbortController().signal;

const recording = (status: number): { http: HttpClient; calls: HttpRequestInput[] } => {
  const calls: HttpRequestInput[] = [];
  return { calls, http: { send: async (input) => { calls.push(input); return { status, body: '[]' }; } } };
};

describe('assessRunPodCredentialReadOnly — preflight de credencial NUNCA faz write faturável', () => {
  test('emite SOMENTE GET; nunca POST/DELETE; nunca cria Pod; nunca reserva', async () => {
    const { http, calls } = recording(200);
    const report = await assessRunPodCredentialReadOnly(config, signal(), http);
    // Regressão do incidente: nenhuma requisição mutante, nenhum POST /pods.
    expect(calls.every(c => c.method === 'GET')).toBe(true);
    expect(calls.some(c => c.method === 'POST' || c.method === 'DELETE')).toBe(false);
    expect(calls.some(c => /\/pods\b/.test(c.url) && c.method !== 'GET')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://rest.runpod.io/v1/pods');
    // Estruturalmente jamais prova WRITE.
    expect(report.writeProbed).toBe(false);
    expect(report).toMatchObject({ restReadable: true, restStatus: 200, writeProbed: false });
  });

  test('403 na leitura => restReadable false, ainda sem qualquer write', async () => {
    const { http, calls } = recording(403);
    const report = await assessRunPodCredentialReadOnly(config, signal(), http);
    expect(report).toMatchObject({ restReadable: false, restStatus: 403, writeProbed: false });
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  test('a chave nunca aparece serializada no relatório', async () => {
    const { http } = recording(200);
    const report = await assessRunPodCredentialReadOnly(config, signal(), http);
    expect(JSON.stringify(report)).not.toContain(config.apiKey);
  });
});
