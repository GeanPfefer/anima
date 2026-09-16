// OPERACIONAL (não commitar): valida a NOVA ANIMA_RUNPOD_API_KEY com uma chamada AUTENTICADA
// READ-ONLY (cotação de preço/estoque A40 via GraphQL). NÃO cria Pod, NÃO reserva, US$0. A chave
// NUNCA é impressa. Distingue 401/403 (permissão faltando → PARAR) de cotação válida (PASS).
import { readRunPodProvisionerConfig } from '@/lib/work-orchestration/runpod-node-provisioner';
import { readRunPodLivePriceQuote } from '@/lib/work-orchestration/runpod-price-quote';

const CEILING_USD = 1.5;
const LEASE_MS = 1_800_000; // 30 min

async function main(): Promise<void> {
  const cfg = readRunPodProvisionerConfig();
  if (!cfg) throw new Error('readRunPodProvisionerConfig()==null (API key/config ausente)');
  const controller = new AbortController();
  const result = await readRunPodLivePriceQuote({
    graphqlBase: process.env.ANIMA_RUNPOD_GRAPHQL_BASE?.trim() || 'https://api.runpod.io/graphql',
    apiKey: cfg.apiKey, gpuTypeIds: cfg.gpuTypeIds, gpuCount: cfg.gpuCount,
    cloudType: cfg.cloudType, resourceClass: 'gpu-a40-48gb', freshnessMs: 60_000,
  }, controller.signal);

  if (!result.ok) {
    const stop = result.reason === 'auth_invalid';
    console.log(JSON.stringify({
      RUNPOD_NEW_KEY_LIVE_READ: stop ? 'FAIL_AUTH' : 'FAIL',
      reason: result.reason,
      gpuTypeIds: cfg.gpuTypeIds, cloudType: cfg.cloudType,
      note: stop
        ? '401/403: a nova key NAO tem permissao suficiente (ler GPU types/pricing). NAO usar a antiga como fallback. Verificar escopo/permissoes da key no RunPod.'
        : 'Cotacao indisponivel (estoque/id). Nao e erro de auth. Ver reason.',
    }, null, 2));
    process.exitCode = stop ? 2 : 1;
    return;
  }

  const q = result.quote;
  const reservedExposure = (q.perHour / 3_600_000) * LEASE_MS; // = perHour * 0.5h
  console.log(JSON.stringify({
    RUNPOD_NEW_KEY_LIVE_READ: 'PASS',
    keyAuthenticated: true, keyNeverPrinted: true,
    quote: { providerId: q.providerId, resourceClass: q.resourceClass, currency: q.currency,
      perHour: q.perHour, kind: q.kind, quotedAt: q.quotedAt, validUntil: q.validUntil },
    a40SecureAvailable: true,
    ceilingUSD: CEILING_USD,
    reservedExposureFor30minLeaseUSD: Number(reservedExposure.toFixed(4)),
    withinCeiling: reservedExposure <= CEILING_USD,
  }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
