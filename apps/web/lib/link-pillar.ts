import { createClient } from '@/lib/supabase/server';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export type LinkResult =
  | { ok: true; parentId: string; parentName: string; createdParent: boolean }
  | { ok: false; reason: 'not_found' | 'self' | 'cycle' | 'error' };

// Atribui um pai a um pilar (relação parent→child). Um pilar tem no máximo um pai:
// re-linkar substitui o vínculo anterior. Cria o pai por nome se ele não existir.
export async function linkPillar(input: {
  childId:     string;
  parentId?:   string | null;
  parentName?: string | null;
}): Promise<LinkResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'error' };

  const { data: pillars } = await supabase
    .from('user_pillars')
    .select('id, name')
    .eq('user_id', user.id);
  const all = pillars ?? [];

  const child = all.find(p => p.id === input.childId);
  if (!child) return { ok: false, reason: 'not_found' };

  // Resolve o pai: por id, por nome existente, ou cria um novo pilar ativo.
  let parent = input.parentId ? all.find(p => p.id === input.parentId) : undefined;
  let createdParent = false;

  if (!parent && input.parentName?.trim()) {
    const target = norm(input.parentName);
    parent = all.find(p => norm(p.name) === target);
    if (!parent) {
      const { data: created } = await supabase
        .from('user_pillars')
        .insert({
          user_id:    user.id,
          catalog_id: null,
          name:       input.parentName.trim().slice(0, 20),
          xp_rate:    1.0,
          is_active:  true,
          status:     'active',
          sort_order: all.length + 5,
        })
        .select('id, name')
        .single();
      if (!created) return { ok: false, reason: 'error' };
      parent = created;
      all.push(created);
      createdParent = true;
    }
  }

  if (!parent) return { ok: false, reason: 'not_found' };
  if (parent.id === child.id) return { ok: false, reason: 'self' };

  // Evita ciclo: o pai proposto não pode ser descendente do filho.
  const { data: rels } = await supabase
    .from('pillar_relationships')
    .select('parent_id, child_id');
  const parentOf = new Map<string, string>();
  for (const r of rels ?? []) parentOf.set(r.child_id, r.parent_id);

  let cursor: string | undefined = parent.id;
  for (let i = 0; i < 50 && cursor; i++) {
    if (cursor === child.id) return { ok: false, reason: 'cycle' };
    cursor = parentOf.get(cursor);
  }

  // Um pai por filho: remove vínculo anterior antes de inserir o novo.
  await supabase.from('pillar_relationships').delete().eq('child_id', child.id);

  const { error } = await supabase
    .from('pillar_relationships')
    .insert({ parent_id: parent.id, child_id: child.id });
  if (error) return { ok: false, reason: 'error' };

  return { ok: true, parentId: parent.id, parentName: parent.name, createdParent };
}

export async function unlinkPillar(childId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  // Garante posse do filho antes de remover.
  const { data: child } = await supabase
    .from('user_pillars')
    .select('id')
    .eq('id', childId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!child) return false;

  const { error } = await supabase
    .from('pillar_relationships')
    .delete()
    .eq('child_id', childId);
  return !error;
}
