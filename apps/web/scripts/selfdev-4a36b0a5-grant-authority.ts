// Concede EXATAMENTE UMA paid authority, autorizada explicitamente pelo humano em chat, para o
// replacement 4a36b0a5 (recovery_successor seq 3, proposal v1). A guarda inicial falha se já
// existir qualquer authority para este work item. Não aprova, não classifica, não executa, não
// chama provider e não liquida reservation.
//
// Envelope humano exato (72h, 30 min, US$1,50); attempts=1; até 8 provider calls é autorização
// operacional do humano (não existe coluna de calls na authority).
import { resolveCliIdentity } from '@/cli/identity';
import {
  grantPaidComputeAuthorization,
  readPaidComputeBudgetAudit,
} from '@/lib/work-orchestration/paid-compute-authorization-store';

const WORK_ITEM_ID = '4a36b0a5-3be8-4431-a3fa-258be13917a3';
const MODEL = 'gpt-5.6-terra';
const MAX_DURATION_MS = 1_800_000; // 30 minutos, exatamente o envelope aprovado.
const MAX_COST = { currency: 'USD', amount: 1.5 } as const;
const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1_000;
const CLOCK_TOLERANCE_MS = 30_000;

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;

  const existing = await client
    .from('paid_compute_authorizations')
    .select('id, created_at, revoked_at')
    .eq('work_item_id', WORK_ITEM_ID);
  if (existing.error) throw new Error(`${existing.error.code}: ${existing.error.message}`);
  if ((existing.data?.length ?? 0) !== 0) {
    throw new Error(`authority já existente para ${WORK_ITEM_ID}; concessão duplicada recusada`);
  }

  const now = Date.now();
  const validFrom = new Date(now - CLOCK_TOLERANCE_MS).toISOString();
  const validUntil = new Date(now + SEVENTY_TWO_HOURS_MS).toISOString();
  const grant = await grantPaidComputeAuthorization(client, {
    providerId: 'openai',
    nodeId: 'openai-api',
    resourceClass: `provider_api:${MODEL}`,
    workItemId: WORK_ITEM_ID,
    maxDurationMs: MAX_DURATION_MS,
    maxCost: MAX_COST,
    validFrom,
    validUntil,
  });
  if (!grant.ok) throw new Error(`${grant.code}: ${grant.message}`);

  const audit = await readPaidComputeBudgetAudit(client, grant.authorizationId);
  console.log(JSON.stringify({
    step: 'authority-granted',
    authorizationId: grant.authorizationId,
    workItemId: WORK_ITEM_ID,
    providerId: 'openai',
    nodeId: 'openai-api',
    resourceClass: `provider_api:${MODEL}`,
    maxDurationMs: MAX_DURATION_MS,
    maxCost: MAX_COST,
    validFrom,
    validUntil,
    audit: audit.ok ? audit.budget : audit,
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
