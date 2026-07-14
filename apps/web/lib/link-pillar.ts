import { createClient } from '@/lib/supabase/server';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export type LinkResult =
  | { ok: true; parentId: string; parentName: string; createdParent: boolean }
  | { ok: false; reason: 'not_found' | 'self' | 'cycle' | 'error' };

// Adiciona um pai a um pilar (relação parent→child). Um pilar pode ter VÁRIOS
// pais (ex: "Idiomas" sob Mente e Relações) — vincular é aditivo, idempotente
// por aresta. Cria o pai por nome se ele não existir.
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

  // Múltiplos pais permitidos — percorre o grafo por TODAS as arestas.
  const { data: rels } = await supabase
    .from('pillar_relationships')
    .select('parent_id, child_id');
  const parentsOf = new Map<string, string[]>();
  for (const r of rels ?? []) {
    const list = parentsOf.get(r.child_id) ?? [];
    list.push(r.parent_id);
    parentsOf.set(r.child_id, list);
  }

  // Já vinculado a esse pai? idempotente, não duplica a aresta.
  if ((parentsOf.get(child.id) ?? []).includes(parent.id)) {
    return { ok: true, parentId: parent.id, parentName: parent.name, createdParent };
  }

  // Evita ciclo: subindo do pai proposto por qualquer caminho não pode alcançar o filho.
  const stack = [parent.id];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === child.id) return { ok: false, reason: 'cycle' };
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of parentsOf.get(cur) ?? []) stack.push(p);
  }

  const { error } = await supabase
    .from('pillar_relationships')
    .insert({ parent_id: parent.id, child_id: child.id });
  if (error) return { ok: false, reason: 'error' };

  // Confirmar o link confirma o próprio filho — se ele estava pendente
  // (criado na hora pelo chat para poder ser vinculado), vira ativo agora.
  await supabase
    .from('user_pillars')
    .update({ is_active: true, status: 'active' })
    .eq('id', child.id)
    .eq('status', 'pending');

  return { ok: true, parentId: parent.id, parentName: parent.name, createdParent };
}

// Remove o vínculo com um pai específico (parentId) ou, se omitido, com todos.
export async function unlinkPillar(childId: string, parentId?: string): Promise<boolean> {
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

  let q = supabase.from('pillar_relationships').delete().eq('child_id', childId);
  if (parentId) q = q.eq('parent_id', parentId);
  const { error } = await q;
  return !error;
}
