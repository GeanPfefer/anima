import { authenticateRequest } from '@/lib/supabase/request-auth';
import {
  grantPaidComputeAuthorization,
  listPaidComputeAuthorizations,
  type GrantPaidComputeAuthorizationInput,
  type PaidComputeStoreError,
} from '@/lib/work-orchestration/paid-compute-authorization-store';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS: Record<string, number> = { forbidden: 403, invalid_input: 400, not_found: 404, unavailable: 503 };
const errorResponse = (result: PaidComputeStoreError) =>
  Response.json({ ok: false, error: { code: result.code, message: result.message } }, { status: STATUS[result.code] ?? 503 });
const badRequest = (message: string) => Response.json({ ok: false, error: { code: 'invalid_input', message } }, { status: 400 });

/** Lista as autorizações de compute pago do usuário (owner-scoped por RLS). */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const result = await listPaidComputeAuthorizations(auth.client);
  if (!result.ok) return errorResponse(result);
  return Response.json({ ok: true, value: result.authorizations });
}

const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const optionalText = (v: unknown): string | null | 'invalid' => {
  if (v === undefined || v === null || v === '') return null;
  return typeof v === 'string' ? v.trim() : 'invalid';
};

/** Concede UMA autorização de compute pago. Ato humano explícito; nenhuma
 * credencial de provider trafega — só o envelope. A RPC (role authenticated) é a
 * autoridade final; aqui validamos a forma para recusar cedo. */
export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return badRequest('Corpo inválido.');

  if (!nonBlank(body.providerId)) return badRequest('providerId é obrigatório.');
  const nodeId = optionalText(body.nodeId);
  const resourceClass = optionalText(body.resourceClass);
  if (nodeId === 'invalid' || resourceClass === 'invalid') return badRequest('nodeId/resourceClass inválidos.');

  let workItemId: string | null = null;
  if (body.workItemId !== undefined && body.workItemId !== null && body.workItemId !== '') {
    if (!nonBlank(body.workItemId) || !UUID.test(body.workItemId.trim())) return badRequest('workItemId precisa ser um UUID.');
    workItemId = body.workItemId.trim();
  }

  const maxDurationMs = body.maxDurationMs;
  if (typeof maxDurationMs !== 'number' || !Number.isInteger(maxDurationMs) || maxDurationMs <= 0) {
    return badRequest('maxDurationMs precisa ser um inteiro positivo (ms).');
  }

  let maxCost: { currency: string; amount: number } | null = null;
  if (body.maxCost !== undefined && body.maxCost !== null) {
    const c = body.maxCost as Record<string, unknown>;
    const currency = c?.currency;
    const amount = c?.amount;
    if (!nonBlank(currency) || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      return badRequest('maxCost exige { currency, amount>=0 } ou ausência total.');
    }
    maxCost = { currency: currency.trim(), amount };
  }

  const validFrom = body.validFrom;
  const validUntil = body.validUntil;
  if (!nonBlank(validFrom) || !nonBlank(validUntil) || Number.isNaN(Date.parse(validFrom)) || Number.isNaN(Date.parse(validUntil))) {
    return badRequest('validFrom/validUntil precisam ser datas ISO.');
  }
  if (Date.parse(validUntil) <= Date.parse(validFrom)) return badRequest('validUntil precisa ser posterior a validFrom.');

  const input: GrantPaidComputeAuthorizationInput = {
    providerId: body.providerId.trim(), nodeId, resourceClass, workItemId, maxDurationMs, maxCost,
    validFrom: new Date(validFrom).toISOString(), validUntil: new Date(validUntil).toISOString(),
  };
  const result = await grantPaidComputeAuthorization(auth.client, input);
  if (!result.ok) return errorResponse(result);
  return Response.json({ ok: true, value: { authorizationId: result.authorizationId } });
}
