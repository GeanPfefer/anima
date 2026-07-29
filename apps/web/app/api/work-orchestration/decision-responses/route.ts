import { mapSupabaseFailure } from '@anima/supabase';
import { createClient } from '@/lib/supabase/server';
import { operationResponse } from '@/lib/work-orchestration/http';

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const body = await request.json().catch(() => ({})) as {
    workItemId?: unknown; expectedProposalVersion?: unknown;
    inputRequestedEventId?: unknown; optionId?: unknown;
  };
  if (typeof body.workItemId !== 'string' || typeof body.expectedProposalVersion !== 'number'
    || typeof body.inputRequestedEventId !== 'string' || typeof body.optionId !== 'string'
    || !body.optionId.trim()) {
    return Response.json({ ok: false, error: { code: 'invalid_input', message: 'Resposta de decisão inválida.' } }, { status: 400 });
  }
  const { data, error } = await client.rpc('respond_to_work_decision', {
    p_work_item_id: body.workItemId,
    p_expected_proposal_version: body.expectedProposalVersion,
    p_input_requested_event_id: body.inputRequestedEventId,
    p_option_id: body.optionId,
  });
  if (error) return operationResponse(mapSupabaseFailure(error, false), value => value);
  return Response.json({ ok: true, value: data });
}
