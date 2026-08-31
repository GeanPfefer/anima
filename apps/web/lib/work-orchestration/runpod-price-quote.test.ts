/** @jest-environment node */
import { readRunPodLivePriceQuote } from './runpod-price-quote';
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
