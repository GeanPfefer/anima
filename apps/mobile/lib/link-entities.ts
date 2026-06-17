import { supabase } from './supabase';
import type { DetectedEntity } from './detect-entities';
import { createPendingPillar } from './create-pending-pillar';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const VALID_TYPES = new Set(['pessoa', 'lugar', 'projeto', 'ferramenta', 'habito', 'conceito']);

// Persiste entidades detectadas em QUALQUER mensagem e as liga a um pilar
// (existente ou pendente) via entity_pillars — base da teia entidade↔pilar.
export async function linkEntitiesToPillars(
  userId: string,
  entities: DetectedEntity[],
): Promise<void> {
  if (entities.length === 0) return;

  // Resolve pillarHint → id consultando pilares de QUALQUER status (ativo ou
  // pendente) — senão cada mensagem recria "Música"/"Cultura" pendentes em vez
  // de reaproveitar o que já existe.
  const { data: allPillars } = await supabase
    .from('user_pillars')
    .select('id, name')
    .eq('user_id', userId);
  const pillarByNorm = new Map((allPillars ?? []).map(p => [norm(p.name), p.id]));

  for (const e of entities) {
    const name = e.name.trim().slice(0, 100);
    if (name.length < 2) continue;
    const type = VALID_TYPES.has(e.type) ? e.type : 'conceito';

    const { data: existing } = await supabase
      .from('semantic_entities')
      .select('id, occurrence_count')
      .eq('user_id', userId)
      .eq('name', name)
      .maybeSingle();

    let entityId: string | null;
    if (existing) {
      await supabase
        .from('semantic_entities')
        .update({
          entity_type:      type,
          last_seen_at:     new Date().toISOString(),
          occurrence_count: existing.occurrence_count + 1,
        })
        .eq('id', existing.id);
      entityId = existing.id;
    } else {
      const { data: created } = await supabase
        .from('semantic_entities')
        .insert({ user_id: userId, name, entity_type: type })
        .select('id')
        .single();
      entityId = created?.id ?? null;
    }
    if (!entityId) continue;

    if (!e.pillarHint) continue;
    const hintNorm = norm(e.pillarHint);
    let pillarId = pillarByNorm.get(hintNorm);

    // pilar inexistente: cria como pendente (tolerante a corrida com quest/atividade)
    if (!pillarId) {
      pillarId = (await createPendingPillar(userId, e.pillarHint)) ?? undefined;
      if (pillarId) pillarByNorm.set(hintNorm, pillarId);
    }
    if (!pillarId) continue;

    // liga entidade ao pilar (idempotente — PK (entity_id, pillar_id))
    await supabase
      .from('entity_pillars')
      .upsert(
        { user_id: userId, entity_id: entityId, pillar_id: pillarId },
        { onConflict: 'entity_id,pillar_id' },
      );
  }
}
