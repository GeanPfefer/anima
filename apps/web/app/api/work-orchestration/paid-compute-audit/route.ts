import { authenticateRequest } from '@/lib/supabase/request-auth';
import { readPaidComputeAudit } from '@/lib/work-orchestration/paid-compute-lease-reconciler-deps';
import { listPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';

export const runtime = 'nodejs';

/** Auditoria READ-ONLY de compute pago do usuário (owner-scoped por RLS). NÃO provisiona, NÃO
 * chama provider, NÃO expõe segredo — só projeta o log durável de evidência de lifecycle. */
export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const [audit, budgets] = await Promise.all([readPaidComputeAudit(auth.client), listPaidComputeBudgetAudit(auth.client)]);
  // Indisponibilidade de leitura NUNCA vira "nenhum compute pago": fail-closed com 503, como budgets.
  if (!audit.ok) return Response.json({ ok: false, error: { code: audit.reason, message: 'Auditoria de compute pago indisponível: o log durável não pôde ser lido.' } }, { status: 503 });
  if (!budgets.ok) return Response.json({ ok: false, error: { code: budgets.code, message: budgets.message } }, { status: 503 });
  return Response.json({ ok: true, value: { leases: audit.records, budgets: budgets.budgets } });
}
