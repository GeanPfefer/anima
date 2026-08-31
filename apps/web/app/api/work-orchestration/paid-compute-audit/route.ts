import { authenticateRequest } from '@/lib/supabase/request-auth';
import { readPaidComputeAudit } from '@/lib/work-orchestration/paid-compute-lease-reconciler-deps';

export const runtime = 'nodejs';

/** Auditoria READ-ONLY de compute pago do usuário (owner-scoped por RLS). NÃO provisiona, NÃO
 * chama provider, NÃO expõe segredo — só projeta o log durável de evidência de lifecycle. */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const records = await readPaidComputeAudit(auth.client);
  return Response.json({ ok: true, value: records });
}
