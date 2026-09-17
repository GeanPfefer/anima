// OPERACIONAL (não commitar): rede de segurança de teardown. `list` (read-only) e
// `stop`/`destroy <podId>` diretos na REST API do RunPod, para garantir cessação de cobrança
// em qualquer falha. Chave NUNCA impressa. Usa a MESMA ANIMA_RUNPOD_API_KEY do adapter.
import { readRunPodProvisionerConfig, fetchHttpClient } from '@/lib/work-orchestration/runpod-node-provisioner';

async function main(): Promise<void> {
  const cfg = readRunPodProvisionerConfig();
  if (!cfg) throw new Error('config null (API key ausente)');
  const auth = { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' };
  const signal = new AbortController().signal;
  const [cmd, arg] = [process.argv[2] ?? 'list', process.argv[3]];

  if (cmd === 'list') {
    const res = await fetchHttpClient.send({ method: 'GET', url: `${cfg.apiBase}/pods`, headers: auth, signal });
    const pods = (() => { try { const j = JSON.parse(res.body); return Array.isArray(j) ? j : (j.pods ?? j.data ?? []); } catch { return []; } })();
    console.log(JSON.stringify({ status: res.status, count: pods.length, pods: pods.map((p: any) => ({
      id: p.id, name: p.name, desiredStatus: p.desiredStatus, costPerHr: p.costPerHr, publicIp: p.publicIp,
      gpu: p.machine?.gpuTypeId ?? p.gpuTypeId ?? null, portMappings: p.portMappings ?? null,
    })) }, null, 2));
    return;
  }
  if ((cmd === 'destroy' || cmd === 'stop') && arg) {
    const method = cmd === 'destroy' ? 'DELETE' : 'POST';
    const path = cmd === 'destroy' ? `/pods/${encodeURIComponent(arg)}` : `/pods/${encodeURIComponent(arg)}/stop`;
    const res = await fetchHttpClient.send({ method, url: `${cfg.apiBase}${path}`, headers: auth, signal });
    console.log(JSON.stringify({ cmd, podId: arg, status: res.status, ok: res.status === 404 || (res.status >= 200 && res.status < 300) }, null, 2));
    return;
  }
  console.log('uso: runpod-pods-admin.ts [list | stop <podId> | destroy <podId>]');
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
