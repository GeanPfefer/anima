import { authenticateRequest } from '@/lib/supabase/request-auth';
import { revokePaidComputeAuthorization, type PaidComputeStoreError } from '@/lib/work-orchestration/paid-compute-authorization-store';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, number> = { forbidden: 403, invalid_input: 400, not_found: 404, unavailable: 503 };
const errorResponse = (result: PaidComputeStoreError) =>
  Response.json({ ok: false, error: { code: result.code, message: result.message } }, { status: STATUS[result.code] ?? 503 });

/** Revoga UMA autorização de compute pago (ato humano; idempotente; owner-scoped). */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });

  const { id } = await context.params;
  if (!id || !UUID.test(id)) {
    return Response.json({ ok: false, error: { code: 'invalid_input', message: 'id precisa ser um UUID.' } }, { status: 400 });
  }
  const result = await revokePaidComputeAuthorization(auth.client, id);
  if (!result.ok) return errorResponse(result);
  return Response.json({ ok: true, value: { authorizationId: result.authorizationId } });
}
