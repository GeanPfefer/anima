// Concede EXATAMENTE UMA paid authority por-item para o successor 5895b59c (recovery_successor
// seq. 4, proposal v2), autorizada explicitamente pelo humano em chat nesta sessão. Guarda
// anti-duplicação: falha se já existir qualquer authority para este work item. Não aprova, não
// classifica, não executa, não chama provider e não liquida reservation.
//
// Envelope humano EXATO (2026-09-14): provider OpenAI, modelo gpt-5.6-terra, teto US$1,50,
// validade até 2026-09-14T23:59:59-03:00, max_duration 30 min, 1 attempt. US$1,50 = LIMITE DE
// EXPOSIÇÃO, não custo liquidado.
import { resolveCliIdentity } from '@/cli/identity';
import {
  grantPaidComputeAuthorization,
  readPaidComputeBudgetAudit,
} from '@/lib/work-orchestration/paid-compute-authorization-store';

const WORK_ITEM_ID = '5895b59c-0568-483a-9731-2abd45fb4b90';
const MODEL = 'gpt-5.6-terra';
const MAX_DURATION_MS = 1_800_000; // 30 minutos, exatamente o envelope aprovado.
const MAX_COST = { currency: 'USD', amount: 1.5 } as const;
const VALID_UNTIL_ISO = new Date('2026-09-14T23:59:59-03:00').toISOString(); // validade humana exata.
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
  const validUntil = VALID_UNTIL_ISO;
  if (new Date(validUntil).getTime() <= now) {
    throw new Error(`validUntil (${validUntil}) já expirou; abortando concessão`);
  }
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
