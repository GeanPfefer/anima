// OPERACIONAL (item-specific; não commitar): materializa a AUTORIDADE HUMANA paga
// `provider_api` (OpenAI FORTE) para a prova de MELHOR CAPACIDADE de self-dev do item
// 8a2515d8, via o mecanismo CANÔNICO (Bearer/GoTrue = identidade residente = dono do
// item; RPC SECURITY DEFINER grant_paid_compute_authorization; NUNCA service_role).
// Idempotente: se já existir uma autorização ATIVA que casa EXATAMENTE os filtros do
// runtime (provider=openai, node=openai-api, class=provider_api:<modelo>, item), NÃO
// cria outra. reserved ≠ settled. A credencial do provider NÃO é lida aqui.
//
// Autoridade desta prova (sob autorização humana explícita para MAXIMIZAR capacidade):
//   provider=openai  node=openai-api  class=provider_api:gpt-5.6-terra  item=8a2515d8…
//   teto ABSOLUTO=USD 1.00 (dentro do saldo OpenAI informado ~18.29)  max_duration=30min.
import { resolveCliIdentity } from '@/cli/identity';
import { openAIProviderResourceClass } from '@/lib/work-orchestration/openai-paid-compute';
import {
  grantPaidComputeAuthorization,
  readActivePaidComputeAuthorization,
} from '@/lib/work-orchestration/paid-compute-authorization-store';

const WORK_ITEM_ID = '8a2515d8-6967-463e-af2a-fd5d2b5e42a1';
const PROVIDER_ID = 'openai';
const NODE_ID = 'openai-api';
const MODEL = process.env.ANIMA_CODER_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
const RESOURCE_CLASS = openAIProviderResourceClass(MODEL);
const MAX_DURATION_MS = 1_800_000; // 30 min.
const MAX_COST = { currency: 'USD', amount: 1.0 } as const; // teto ABSOLUTO de exposição.
const VALID_DAYS = 1;

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;
  console.log(JSON.stringify({ step: 'identity', userId, resourceClass: RESOURCE_CLASS }, null, 2));

  const now = new Date();
  const existing = await readActivePaidComputeAuthorization(client, {
    providerId: PROVIDER_ID, nodeId: NODE_ID, resourceClass: RESOURCE_CLASS,
    workItemId: WORK_ITEM_ID, now,
  });
  if (existing) {
    console.log(JSON.stringify({
      step: 'already_present', authorizationId: existing.authorizationId,
      maxCost: existing.maxCostEstimate, validUntil: existing.validUntil,
      note: 'autorização provider_api ativa já casa a config do runtime; nada a fazer.',
    }, null, 2));
    return;
  }

  const validFrom = now.toISOString();
  const validUntil = new Date(now.getTime() + VALID_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const granted = await grantPaidComputeAuthorization(client, {
    providerId: PROVIDER_ID, nodeId: NODE_ID, resourceClass: RESOURCE_CLASS,
    workItemId: WORK_ITEM_ID, maxDurationMs: MAX_DURATION_MS, maxCost: MAX_COST,
    validFrom, validUntil,
  });
  if (!granted.ok) throw new Error(`${granted.code}: ${granted.message}`);
  console.log(JSON.stringify({ step: 'granted', authorizationId: granted.authorizationId }, null, 2));

  const confirm = await readActivePaidComputeAuthorization(client, {
    providerId: PROVIDER_ID, nodeId: NODE_ID, resourceClass: RESOURCE_CLASS,
    workItemId: WORK_ITEM_ID, now: new Date(),
  });
  console.log(JSON.stringify({
    step: 'confirm_runtime_match',
    matches: confirm?.authorizationId === granted.authorizationId,
    authorizationId: confirm?.authorizationId ?? null,
    providerId: confirm?.providerId, nodeId: confirm?.nodeId, resourceClass: confirm?.resourceClass,
    workItemId: confirm?.workItemId, maxDurationMs: confirm?.maxDurationMs,
    maxCost: confirm?.maxCostEstimate, validFrom: confirm?.validFrom, validUntil: confirm?.validUntil,
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
