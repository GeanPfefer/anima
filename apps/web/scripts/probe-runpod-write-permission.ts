// OPERACIONAL (não commitar) — READ-ONLY. [CORRIGIDO 2026-09-09 após incidente: este script ANTES
// fazia POST /pods e criou um Pod acidental quando a key ganhou WRITE. A parte mutante foi REMOVIDA.]
//
// Preflight de credencial NUNCA prova WRITE (POST /pods é faturável e cria recurso). Só confirma
// LEITURA. A capacidade de WRITE é provada apenas pela 1a operação canônica governada
// (scripts/prove-runpod-autoprov-8a2515d8.ts), sob authority + budget + teardown.
import { readRunPodProvisionerConfig } from '@/lib/work-orchestration/runpod-node-provisioner';
import { assessRunPodCredentialReadOnly } from '@/lib/work-orchestration/runpod-credential-preflight';
import { readRunPodLivePriceQuote } from '@/lib/work-orchestration/runpod-price-quote';

async function main(): Promise<void> {
  const cfg = readRunPodProvisionerConfig();
  if (!cfg) throw new Error('config null (API key ausente)');
  const signal = new AbortController().signal;

  const cred = await assessRunPodCredentialReadOnly({ apiBase: cfg.apiBase, apiKey: cfg.apiKey }, signal);
  const quote = await readRunPodLivePriceQuote({
    graphqlBase: process.env.ANIMA_RUNPOD_GRAPHQL_BASE?.trim() || 'https://api.runpod.io/graphql',
    apiKey: cfg.apiKey, gpuTypeIds: cfg.gpuTypeIds, gpuCount: cfg.gpuCount, cloudType: cfg.cloudType,
    resourceClass: 'gpu-a40-48gb', freshnessMs: 60_000,
  }, signal);

  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    restReadable: cred.restReadable, restStatus: cred.restStatus, writeProbed: cred.writeProbed,
    quote: quote.ok ? { perHour: quote.quote.perHour, currency: quote.quote.currency } : { error: quote.reason },
    note: cred.note,
  }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
