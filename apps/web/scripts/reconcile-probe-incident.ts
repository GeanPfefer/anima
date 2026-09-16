// OPERACIONAL (não commitar): reconciliação READ-ONLY do incidente do probe (Pod acidental).
// SOMENTE GET/GraphQL de leitura. Nenhum POST/DELETE. Chave NUNCA impressa.
import { readRunPodProvisionerConfig, fetchHttpClient } from '@/lib/work-orchestration/runpod-node-provisioner';

async function main(): Promise<void> {
  const cfg = readRunPodProvisionerConfig();
  if (!cfg) throw new Error('config null');
  const auth = { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' };
  const signal = new AbortController().signal;

  // 1) REST: pods ativos agora.
  const rest = await fetchHttpClient.send({ method: 'GET', url: `${cfg.apiBase}/pods`, headers: auth, signal });
  const pods = (() => { try { const j = JSON.parse(rest.body); return Array.isArray(j) ? j : (j.pods ?? j.data ?? []); } catch { return []; } })();
  console.log('REST /pods status:', rest.status, 'count:', pods.length);
  console.log('REST pods:', JSON.stringify(pods.map((p: any) => ({ id: p.id, name: p.name, desiredStatus: p.desiredStatus, costPerHr: p.costPerHr, gpu: p.machine?.gpuTypeId ?? null })), null, 2));

  // 2) GraphQL myself: gasto corrente + pods (inclui os que o cliente ainda possui).
  const base = process.env.ANIMA_RUNPOD_GRAPHQL_BASE?.trim() || 'https://api.runpod.io/graphql';
  const url = `${base.replace(/\/+$/, '')}?api_key=${encodeURIComponent(cfg.apiKey)}`;
  const q = { query: `query { myself { id currentSpendPerHr clientBalance pods { id name desiredStatus costPerHr gpuCount imageName machine { gpuDisplayName } runtime { uptimeInSeconds } } } }` };
  const gql = await fetchHttpClient.send({ method: 'POST', url, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q), signal });
  let parsed: any; try { parsed = JSON.parse(gql.body); } catch { parsed = gql.body.slice(0, 300); }
  const me = parsed?.data?.myself;
  console.log('GraphQL status:', gql.status);
  if (parsed?.errors) console.log('GraphQL errors:', JSON.stringify(parsed.errors).slice(0, 400));
  if (me) {
    console.log('currentSpendPerHr:', me.currentSpendPerHr, 'clientBalance:', me.clientBalance);
    console.log('myself.pods:', JSON.stringify((me.pods ?? []).map((p: any) => ({ id: p.id, name: p.name, desiredStatus: p.desiredStatus, costPerHr: p.costPerHr, gpu: p.machine?.gpuDisplayName ?? null, image: p.imageName, uptimeS: p.runtime?.uptimeInSeconds ?? null })), null, 2));
  }
  const activeCharging = (me?.pods ?? []).filter((p: any) => p.desiredStatus === 'RUNNING' || (typeof p.costPerHr === 'number' && p.costPerHr > 0 && p.runtime));
  console.log('VERDICT_incident_pod_active_or_charging:', activeCharging.length > 0 ? activeCharging : 'NONE (nenhum Pod ativo/cobrando)');
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
