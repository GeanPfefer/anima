import type { WorkItem } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { projectAutonomousReadiness } from './autonomous-readiness';
import { readWorkRetryReadiness } from './retry-readiness';
import { serializeReconstructedWorkPresentation } from './serialize';
import { createWorkOrchestrationService } from './server';
import { createSupabaseWorkReferenceLookup, readWorkHumanReference, resolveWorkReference, type WorkReferenceAmbiguousCandidate, type WorkReferenceLookup } from './work-reference';

// Detalhe de um trabalho para /trabalhos/[referencia]. Reutiliza a MESMA reconstrução persistida de
// items/[id] (itens, eventos, contextos, elegibilidade, retry) e a MESMA resolução de referência da CLI
// (`resolveWorkReference`): UUID ou código legível; código ambíguo nunca escolhe um item em silêncio.

export type WorkDetailResult =
  | { readonly kind: 'ok'; readonly workItemId: string; readonly reference: string | null; readonly title: string; readonly presentation: unknown }
  | { readonly kind: 'ambiguous'; readonly reference: string; readonly candidates: readonly WorkReferenceAmbiguousCandidate[] }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'error' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WorkDetailDeps {
  readonly lookup?: WorkReferenceLookup;
}

async function loadPresentation(client: SupabaseClient<Database>, id: string): Promise<WorkDetailResult> {
  const service = createWorkOrchestrationService(client);
  const item = await service.getItem(id);
  if (!item.ok) return { kind: item.error.code === 'work_item_not_found' ? 'not_found' : 'error' };
  const [events, contexts] = await Promise.all([service.listEvents(id), service.listContexts(id)]);
  if (!events.ok || !contexts.ok) return { kind: 'error' };
  const readiness = await projectAutonomousReadiness(client, [item.value as WorkItem]);
  const retryReadiness = await readWorkRetryReadiness(client, id);
  const presentation = {
    ...serializeReconstructedWorkPresentation(item.value, events.value, contexts.value),
    autonomousReadiness: readiness.get(id), retryReadiness,
  };
  const human = readWorkHumanReference(item.value.intent);
  const summary = (item.value.proposal as { data?: { summary?: unknown } } | undefined)?.data?.summary;
  return {
    kind: 'ok', workItemId: id, reference: human?.reference ?? null,
    title: human?.title ?? (typeof summary === 'string' ? summary : 'Trabalho'),
    presentation: JSON.parse(JSON.stringify(presentation)) as unknown,
  };
}

/**
 * `param` = segmento da URL (UUID ou código legível). `itemHint` (query `item`) desambigua sucessores que partilham o código:
 * só vale se o item tiver exatamente aquele código (nunca abre outro trabalho por engano).
 */
export async function loadWorkDetail(client: SupabaseClient<Database>, param: string, itemHint?: string, deps: WorkDetailDeps = {}): Promise<WorkDetailResult> {
  try {
    if (UUID.test(param)) return await loadPresentation(client, param.toLowerCase());
    if (itemHint !== undefined) {
      if (!UUID.test(itemHint)) return { kind: 'invalid' };
      const loaded = await loadPresentation(client, itemHint.toLowerCase());
      if (loaded.kind !== 'ok') return loaded;
      return loaded.reference === param ? loaded : { kind: 'not_found' };
    }
    const resolved = await resolveWorkReference(deps.lookup ?? createSupabaseWorkReferenceLookup(client), param);
    if (resolved.ok) return await loadPresentation(client, resolved.workItemId);
    if (resolved.code === 'invalid_work_reference') return { kind: 'invalid' };
    if (resolved.code === 'work_reference_not_found') return { kind: 'not_found' };
    return { kind: 'ambiguous', reference: param, candidates: resolved.candidates };
  } catch {
    return { kind: 'error' };
  }
}
