/** @jest-environment node */
import { canonicalGpuResourceClass, readRunPodLivePriceQuote, readRunPodResourceInventory } from './runpod-price-quote';
import type { HttpClient, HttpRequestInput } from './runpod-node-provisioner';

const key = 'rp_quote_test_secret';
const config = { graphqlBase: 'https://api.runpod.io/graphql', apiKey: key, gpuTypeIds: ['A40', '4090'], gpuCount: 1,
  cloudType: 'SECURE' as const, resourceClass: 'gpu-24gb', freshnessMs: 60_000 };
const signal = () => new AbortController().signal;
const client = (handler: (input: HttpRequestInput) => { status: number; body: string }): HttpClient => ({ send: async input => handler(input) });
const okBody = (id: string, price: number) => JSON.stringify({ data: { gpuTypes: [{ id, lowestPrice: {
  stockStatus: 'High', uninterruptablePrice: price, availableGpuCounts: [1, 2],
} }] } });

test('consulta somente query GraphQL e escolhe o maior preço entre GPUs elegíveis', async () => {
  const calls: HttpRequestInput[] = [];
  const http = client(input => { calls.push(input); const vars = (JSON.parse(input.body!) as { variables: { id: string } }).variables; return { status: 200, body: okBody(vars.id, vars.id === 'A40' ? 0.4 : 0.7) }; });
  const result = await readRunPodLivePriceQuote(config, signal(), http, () => new Date('2026-08-31T12:00:00Z'));
  expect(result).toMatchObject({ ok: true, quote: { perHour: 0.7, currency: 'USD', resourceClass: 'gpu-24gb', validUntil: '2026-08-31T12:01:00.000Z' } });
  expect(calls).toHaveLength(2);
  expect(calls.every(c => c.method === 'POST' && c.url.startsWith('https://api.runpod.io/graphql?api_key='))).toBe(true);
  expect(calls.every(c => !c.body?.includes(key))).toBe(true);
});

test('availableGpuCounts null com estoque válido cota (resposta real do RunPod)', async () => {
  const body = JSON.stringify({ data: { gpuTypes: [{ id: 'A40', lowestPrice: {
    stockStatus: 'High', uninterruptablePrice: 0.49, availableGpuCounts: null,
  } }] } });
  const result = await readRunPodLivePriceQuote({ ...config, gpuTypeIds: ['A40'] }, signal(),
    client(() => ({ status: 200, body })), () => new Date('2026-09-08T12:00:00Z'));
  expect(result).toMatchObject({ ok: true, quote: { perHour: 0.49, currency: 'USD' } });
});

test.each([
  ['auth', 401, '{}', 'auth_invalid'], ['rate', 429, '{}', 'rate_limited'],
  ['server com segredo', 500, key, 'provider_unreachable'],
  ['json', 200, 'not-json', 'quote_invalid'], ['erro gql', 200, JSON.stringify({ errors: [{}] }), 'quote_unavailable'],
  ['sem estoque', 200, JSON.stringify({ data: { gpuTypes: [{ id: 'A40', lowestPrice: { stockStatus: 'None', uninterruptablePrice: 0.4, availableGpuCounts: [] } }] } }), 'quote_unavailable'],
] as const)('%s falha fechado sem expor segredo', async (_label, status, body, reason) => {
  const result = await readRunPodLivePriceQuote({ ...config, gpuTypeIds: ['A40'] }, signal(), client(() => ({ status, body })));
  expect(result).toEqual({ ok: false, reason }); expect(JSON.stringify(result)).not.toContain(key);
});

test('falha de rede é provider_unreachable', async () => {
  const http: HttpClient = { send: async () => { throw new Error(key); } };
  expect(await readRunPodLivePriceQuote(config, signal(), http)).toEqual({ ok: false, reason: 'provider_unreachable' });
});

// ---- Inventário normalizado (Cloud Resource Matching V1) ----------------------------------
const invConfig = { graphqlBase: 'https://api.runpod.io/graphql', apiKey: key, gpuTypeIds: ['NVIDIA A40', 'NVIDIA RTX A6000'], gpuCount: 1, cloudType: 'SECURE' as const };
const invBody = (id: string, displayName: string, memoryInGb: number, stockStatus: string | null, price: number | null, counts: number[] | null = [1]) =>
  JSON.stringify({ data: { gpuTypes: [{ id, displayName, memoryInGb, lowestPrice: { stockStatus, uninterruptablePrice: price, availableGpuCounts: counts } }] } });

test('canonicalGpuResourceClass casa com a SKU histórica (A40 48 → gpu-a40-48gb)', () => {
  expect(canonicalGpuResourceClass('A40', 48)).toBe('gpu-a40-48gb');
  expect(canonicalGpuResourceClass('NVIDIA RTX A6000', 48)).toBe('gpu-rtx-a6000-48gb');
});

test('normaliza candidatos com VRAM/preço/disponibilidade', async () => {
  const http = client(input => {
    const id = (JSON.parse(input.body!) as { variables: { id: string } }).variables.id;
    return id === 'NVIDIA A40'
      ? { status: 200, body: invBody('NVIDIA A40', 'A40', 48, 'High', 0.49) }
      : { status: 200, body: invBody('NVIDIA RTX A6000', 'RTX A6000', 48, 'High', 0.44) };
  });
  const result = await readRunPodResourceInventory(invConfig, signal(), http);
  expect(result).toEqual({ ok: true, candidates: [
    { providerId: 'runpod', resourceClass: 'gpu-a40-48gb', gpuTypeId: 'NVIDIA A40', displayName: 'A40', vramGiB: 48, gpuFeatures: ['cuda'], availability: 'available', perHour: { currency: 'USD', amount: 0.49 } },
    { providerId: 'runpod', resourceClass: 'gpu-rtx-a6000-48gb', gpuTypeId: 'NVIDIA RTX A6000', displayName: 'RTX A6000', vramGiB: 48, gpuFeatures: ['cuda'], availability: 'available', perHour: { currency: 'USD', amount: 0.44 } },
  ] });
});

test('12) availableGpuCounts null com estoque válido NÃO regride: candidato available', async () => {
  const http = client(() => ({ status: 200, body: invBody('NVIDIA A40', 'A40', 48, 'High', 0.49, null) }));
  const result = await readRunPodResourceInventory({ ...invConfig, gpuTypeIds: ['NVIDIA A40'] }, signal(), http);
  expect(result).toMatchObject({ ok: true, candidates: [{ availability: 'available', perHour: { amount: 0.49 } }] });
});

test('A40 indisponível vira candidato unavailable entre os demais (não interrompe)', async () => {
  const http = client(input => {
    const id = (JSON.parse(input.body!) as { variables: { id: string } }).variables.id;
    return id === 'NVIDIA A40'
      ? { status: 200, body: invBody('NVIDIA A40', 'A40', 48, 'None', null, []) }
      : { status: 200, body: invBody('NVIDIA RTX A6000', 'RTX A6000', 48, 'High', 0.44) };
  });
  const result = await readRunPodResourceInventory(invConfig, signal(), http);
  expect(result.ok && result.candidates.map(c => [c.gpuTypeId, c.availability])).toEqual([
    ['NVIDIA A40', 'unavailable'], ['NVIDIA RTX A6000', 'available'],
  ]);
});

test('13) cotação individual indisponível (erro gql) pula o SKU e continua nos outros', async () => {
  const http = client(input => {
    const id = (JSON.parse(input.body!) as { variables: { id: string } }).variables.id;
    return id === 'NVIDIA A40'
      ? { status: 200, body: JSON.stringify({ errors: [{ message: 'unavailable' }] }) }
      : { status: 200, body: invBody('NVIDIA RTX A6000', 'RTX A6000', 48, 'High', 0.44) };
  });
  const result = await readRunPodResourceInventory(invConfig, signal(), http);
  expect(result.ok && result.candidates.map(c => c.gpuTypeId)).toEqual(['NVIDIA RTX A6000']);
});

test('credencial inválida fecha globalmente sem expor segredo', async () => {
  const result = await readRunPodResourceInventory(invConfig, signal(), client(() => ({ status: 403, body: key })));
  expect(result).toEqual({ ok: false, reason: 'auth_invalid' });
  expect(JSON.stringify(result)).not.toContain(key);
});

test('todas as consultas falham no transporte → provider_unreachable', async () => {
  const http: HttpClient = { send: async () => { throw new Error(key); } };
  expect(await readRunPodResourceInventory(invConfig, signal(), http)).toEqual({ ok: false, reason: 'provider_unreachable' });
});
