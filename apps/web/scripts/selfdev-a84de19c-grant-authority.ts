// OPERACIONAL (não commitar). Concede UMA authority paga exclusiva para a84de19c:
// OpenAI gpt-5.6-terra, maxCost USD 1.50, maxDurationMs 30 min (cap de compute).
// validUntil = agora + 60 min (janela de calendário; o cap real de compute é maxDurationMs),
// mesmo formato do grant provado de 7e0a75cf. NÃO cria segunda authority.
import { resolveCliIdentity } from '@/cli/identity';
import { grantPaidComputeAuthorization, readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

const ITEM = 'a84de19c-3766-44ed-8ce2-80e856ec2a38';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const existing = await client.from('paid_compute_authorizations').select('id').eq('work_item_id', ITEM);
  if (existing.error) throw new Error(existing.error.message);
  if ((existing.data?.length ?? 0) !== 0) throw new Error('authority já existe para o item — abortando');
  const validFrom = new Date(Date.now() - 30_000).toISOString();
  const validUntil = new Date(Date.now() + 60 * 60_000).toISOString();
  const grant = await grantPaidComputeAuthorization(client, {
    providerId: 'openai', nodeId: 'openai-api', resourceClass: 'provider_api:gpt-5.6-terra',
    workItemId: ITEM, maxDurationMs: 1_800_000, maxCost: { currency: 'USD', amount: 1.5 },
    validFrom, validUntil,
  });
  if (!grant.ok) throw new Error(`${grant.code}: ${grant.message}`);
  console.log(JSON.stringify({ grant, validFrom, validUntil, audit: await readPaidComputeBudgetAudit(client, grant.authorizationId) }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
