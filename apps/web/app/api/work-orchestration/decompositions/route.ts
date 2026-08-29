import { createClient } from '@/lib/supabase/server';
import { decomposeFailedWorkItem } from '@/lib/work-orchestration/decomposition-orchestration';

// POST /api/work-orchestration/decompositions
// Decomposição governada, sob demanda, de um work item FALHO cuja recuperação
// recomenda `decompose`: materializa (ou replaya) a menor unidade sucessora
// `proposed` que retoma do checkpoint durável. Owner-scoped por RLS — o usuário
// só decompõe os PRÓPRIOS itens. Desfecho máximo `proposed`: nunca aprova,
// classifica, executa nem amplia autoridade. Fail-closed em toda lacuna.
export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });

  const body = await request.json().catch(() => null) as { workItemId?: unknown } | null;
  const workItemId = typeof body?.workItemId === 'string' ? body.workItemId.trim() : '';
  if (!workItemId) return Response.json({ ok: false, error: { code: 'work_item_id_required' } }, { status: 400 });

  const result = await decomposeFailedWorkItem(client, workItemId);
  // Bloqueios de infraestrutura (leitura/persistência) são 5xx; recusas de estado
  // ou de envelope são 422 (precondição não satisfeita, resposta honesta ao cliente).
  if (result.ok) return Response.json(result, { status: 200 });
  const infrastructure = result.reason === 'events_unavailable'
    || result.reason === 'lineage_read_failed'
    || result.reason === 'persistence_failed';
  return Response.json(result, { status: infrastructure ? 500 : 422 });
}
