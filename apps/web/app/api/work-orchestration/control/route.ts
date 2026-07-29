import { mapSupabaseFailure } from '@anima/supabase';
import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';

// UX-01 — o usuário PEDE pausa/cancelamento de uma tentativa autônoma pelo
// cartão. Esta rota só persiste a intenção (request_work_control); o efeito real
// é aplicado cooperativamente pelo laço do Supervisor no próximo checkpoint
// seguro. Nada aqui mata execução nem muda estado.
export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    workItemId?: unknown; expectedProposalVersion?: unknown; attemptId?: unknown; action?: unknown;
  };
  if (typeof body.workItemId !== 'string' || typeof body.attemptId !== 'string'
    || typeof body.expectedProposalVersion !== 'number'
    || (body.action !== 'pause' && body.action !== 'cancel')) {
    return Response.json({ ok: false, error: { code: 'invalid_input', message: 'Pedido de controle inválido.' } }, { status: 400 });
  }

  const { data, error } = await client.rpc('request_work_control', {
    p_work_item_id: body.workItemId,
    p_expected_proposal_version: body.expectedProposalVersion,
    p_attempt_id: body.attemptId,
    p_action: body.action,
  });
  console.info('[work-orchestration]', { operation: 'requestWorkControl', workItemId: body.workItemId, attemptId: body.attemptId, action: body.action, result: error ? error.code : 'success' });
  if (error) return operationResponse(mapSupabaseFailure(error, false), value => value);
  return Response.json({ ok: true, value: data });
}
