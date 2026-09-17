// Concede a ÚNICA paid authority autorizada pelo humano para o coder do fe99e446 v3.
// NÃO chama provider; NÃO executa; NÃO liquida reserva. Apenas grava a authority (RLS).
// Parâmetros EXATOS autorizados: openai/openai-api/provider_api:gpt-5.6-terra, US$1,50,
// maxDurationMs 5_400_000, validFrom now-tolerância, validUntil now+7 dias.
import { resolveCliIdentity } from '@/cli/identity';
import { grantPaidComputeAuthorization, readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const WORK_ITEM_ID = 'fe99e446-9f14-45d0-97f5-764e9c2af8a9';
const MODEL = 'gpt-5.6-terra';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 30_000;
const log = (v: unknown) => console.log(JSON.stringify(v, null, 2));

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const now = Date.now();
  const grant = await grantPaidComputeAuthorization(client, {
    providerId: 'openai',
    nodeId: 'openai-api',
    resourceClass: `provider_api:${MODEL}`,
    workItemId: WORK_ITEM_ID,
    maxDurationMs: 5_400_000,
    maxCost: { currency: 'USD', amount: 1.5 },
    validFrom: new Date(now - CLOCK_TOLERANCE_MS).toISOString(),
    validUntil: new Date(now + SEVEN_DAYS_MS).toISOString(),
  });
  if (!grant.ok) throw new Error(`${grant.code}: ${grant.message}`);
  const audit = await readPaidComputeBudgetAudit(client, grant.authorizationId);
  log({
    step: 'authority-granted',
    authorizationId: grant.authorizationId,
    workItemId: WORK_ITEM_ID,
    resourceClass: `provider_api:${MODEL}`,
    validFrom: new Date(now - CLOCK_TOLERANCE_MS).toISOString(),
    validUntil: new Date(now + SEVEN_DAYS_MS).toISOString(),
    audit: audit.ok ? audit.budget : audit,
  });
}

void main().catch(e => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exitCode = 1; });
