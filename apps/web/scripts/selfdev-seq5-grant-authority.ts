// Concede EXATAMENTE UMA paid authority por-item para o seq.5 (dae3be71), autorizada
// explicitamente pelo humano (Opção B, 2026-09-14). Guarda anti-duplicação. Não aprova, não
// classifica, não executa, não chama provider, não liquida.
// Envelope humano EXATO: OpenAI / gpt-5.6-terra / teto US$1,50 / 30 min / validade até
// 2026-09-14T23:59:59-03:00 / 1 attempt. US$1,50 = LIMITE DE EXPOSIÇÃO, não custo.
import { resolveCliIdentity } from '@/cli/identity';
import {
  grantPaidComputeAuthorization,
  readPaidComputeBudgetAudit,
} from '@/lib/work-orchestration/paid-compute-authorization-store';

const WORK_ITEM_ID = 'dae3be71-412d-4730-92ac-bf25b36af758';
const MODEL = 'gpt-5.6-terra';
const MAX_DURATION_MS = 1_800_000;
const MAX_COST = { currency: 'USD', amount: 1.5 } as const;
const VALID_UNTIL_ISO = new Date('2026-09-14T23:59:59-03:00').toISOString();
const CLOCK_TOLERANCE_MS = 30_000;

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;

  const existing = await client.from('paid_compute_authorizations').select('id').eq('work_item_id', WORK_ITEM_ID);
  if (existing.error) throw new Error(`${existing.error.code}: ${existing.error.message}`);
  if ((existing.data?.length ?? 0) !== 0) throw new Error(`authority já existente para ${WORK_ITEM_ID}; recusada`);

  const now = Date.now();
  const validFrom = new Date(now - CLOCK_TOLERANCE_MS).toISOString();
  if (new Date(VALID_UNTIL_ISO).getTime() <= now) throw new Error(`validUntil (${VALID_UNTIL_ISO}) expirou; abortando`);

  const grant = await grantPaidComputeAuthorization(client, {
    providerId: 'openai', nodeId: 'openai-api', resourceClass: `provider_api:${MODEL}`,
    workItemId: WORK_ITEM_ID, maxDurationMs: MAX_DURATION_MS, maxCost: MAX_COST,
    validFrom, validUntil: VALID_UNTIL_ISO,
  });
  if (!grant.ok) throw new Error(`${grant.code}: ${grant.message}`);

  const audit = await readPaidComputeBudgetAudit(client, grant.authorizationId);
  console.log(JSON.stringify({
    step: 'authority-granted', authorizationId: grant.authorizationId, workItemId: WORK_ITEM_ID,
    resourceClass: `provider_api:${MODEL}`, maxDurationMs: MAX_DURATION_MS, maxCost: MAX_COST,
    validFrom, validUntil: VALID_UNTIL_ISO, audit: audit.ok ? audit.budget : audit,
  }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
