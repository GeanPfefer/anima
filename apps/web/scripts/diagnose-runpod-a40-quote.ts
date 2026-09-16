// OPERACIONAL (não commitar): diagnóstico READ-ONLY da cotação A40 (id exato + estoque + preço,
// SECURE e COMMUNITY). Chave NUNCA impressa. US$0, sem Pod, sem reserva.
import { readRunPodProvisionerConfig, fetchHttpClient } from '@/lib/work-orchestration/runpod-node-provisioner';

async function query(apiKey: string, body: unknown): Promise<any> {
  const base = process.env.ANIMA_RUNPOD_GRAPHQL_BASE?.trim() || 'https://api.runpod.io/graphql';
  const url = `${base.replace(/\/+$/, '')}?api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetchHttpClient.send({ method: 'POST', url, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: new AbortController().signal });
  return { status: res.status, json: (() => { try { return JSON.parse(res.body); } catch { return res.body.slice(0, 300); } })() };
}

async function main(): Promise<void> {
  const cfg = readRunPodProvisionerConfig();
  if (!cfg) throw new Error('config null');
  const key = cfg.apiKey;

  // 1) Todos os gpuTypes com preço SECURE e COMMUNITY p/ gpuCount 1; filtramos A40 client-side.
  const q = { query: `query { gpuTypes { id displayName memoryInGb secure: lowestPrice(input:{gpuCount:1, secureCloud:true}) { stockStatus uninterruptablePrice minimumBidPrice availableGpuCounts } community: lowestPrice(input:{gpuCount:1, secureCloud:false}) { stockStatus uninterruptablePrice minimumBidPrice availableGpuCounts } } }` };
  const r = await query(key, q);
  console.log('status:', r.status);
  if (r.json?.errors) { console.log('GRAPHQL_ERRORS:', JSON.stringify(r.json.errors).slice(0, 500)); }
  const types: any[] = r.json?.data?.gpuTypes ?? [];
  console.log('total_gpu_types:', types.length);
  const a40 = types.filter(t => /a40/i.test(String(t.id)) || /a40/i.test(String(t.displayName)));
  console.log('A40_MATCHES:', JSON.stringify(a40, null, 2));
  // Também mostra alguns ids p/ referência de formato (sem preço), caso A40 não apareça.
  if (a40.length === 0) console.log('SAMPLE_IDS:', JSON.stringify(types.slice(0, 12).map(t => ({ id: t.id, name: t.displayName })), null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
