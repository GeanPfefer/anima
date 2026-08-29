import { createClient } from '@/lib/supabase/server';
import { correctReviewedWorkItem } from '@/lib/work-orchestration/review-correction-orchestration';

// POST /api/work-orchestration/review-corrections
// Correção governada por RETOMADA de um work item em `changes_requested`: quando a
// revisão humana pode ser satisfeita por um subconjunto ESTRITO do escopo (o que o
// checkpoint NÃO tocou) e existe checkpoint durável elegível, materializa (ou
// replaya) a menor unidade sucessora `proposed` que retoma do checkpoint,
// preservando a implementação já verificada. Owner-scoped por RLS. Desfecho máximo
// `proposed`: nunca aprova, classifica, executa nem amplia autoridade. Fail-closed
// em toda lacuna (sem checkpoint retomável ou sem escopo restante ⇒ recusa).
export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });

  const body = await request.json().catch(() => null) as { workItemId?: unknown } | null;
  const workItemId = typeof body?.workItemId === 'string' ? body.workItemId.trim() : '';
  if (!workItemId) return Response.json({ ok: false, error: { code: 'work_item_id_required' } }, { status: 400 });

  const result = await correctReviewedWorkItem(client, workItemId);
  // Bloqueios de infraestrutura (leitura/persistência) são 5xx; recusas de estado
  // ou de envelope são 422 (precondição não satisfeita, resposta honesta ao cliente).
  if (result.ok) return Response.json(result, { status: 200 });
  const infrastructure = result.reason === 'events_unavailable'
    || result.reason === 'lineage_read_failed'
    || result.reason === 'persistence_failed';
  return Response.json(result, { status: infrastructure ? 500 : 422 });
}
