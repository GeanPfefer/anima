import dynamic from 'next/dynamic';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { GraphNode, GraphEdge } from './_components/GraphClient';

const GraphClient = dynamic<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
  () => import('./_components/GraphClient'),
  { ssr: false },
);

export default async function GraphPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // ── Pillars ───────────────────────────────────────────────────
  const { data: pillarsData } = await supabase
    .from('user_pillars')
    .select('id, name, xp_total, level')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('level', { ascending: false });

  const pillars = pillarsData ?? [];
  const pillarIds = new Set(pillars.map(p => p.id));
  const ROOT_NAMES = new Set(['saúde', 'mente', 'relações']);

  const nodes: GraphNode[] = pillars.map(p => ({
    id:      p.id,
    name:    p.name,
    xpTotal: p.xp_total,
    level:   p.level,
    isRoot:  ROOT_NAMES.has(p.name.toLowerCase()),
  }));

  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  function addEdge(src: string, tgt: string, weight: number, type: GraphEdge['type']) {
    const key = [src, tgt].sort().join('|');
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source: src, target: tgt, weight, type });
  }

  // ── Edges 1: direct pillar relationships ──────────────────────
  const { data: relations } = await supabase
    .from('pillar_relationships')
    .select('parent_id, child_id')
    .in('parent_id', [...pillarIds]);

  for (const r of relations ?? []) {
    if (pillarIds.has(r.parent_id) && pillarIds.has(r.child_id)) {
      addEdge(r.parent_id, r.child_id, 3, 'relation');
    }
  }

  // ── Edges 2: XP co-occurrence (last 90 days) ──────────────────
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

  const { data: xpRecords } = await supabase
    .from('xp_records')
    .select('pillar_id, activity_date')
    .eq('user_id', user.id)
    .gte('activity_date', ninetyDaysAgo);

  const byDate: Record<string, string[]> = {};
  for (const r of xpRecords ?? []) {
    if (!pillarIds.has(r.pillar_id)) continue;
    (byDate[r.activity_date] ??= []).push(r.pillar_id);
  }

  const coCount: Record<string, number> = {};
  for (const pids of Object.values(byDate)) {
    const uniq = [...new Set(pids)];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const key = [uniq[i]!, uniq[j]!].sort().join('|');
        coCount[key] = (coCount[key] ?? 0) + 1;
      }
    }
  }

  for (const [key, count] of Object.entries(coCount)) {
    if (count < 2) continue;
    const [src, tgt] = key.split('|');
    if (src && tgt) addEdge(src, tgt, Math.min(count, 10), 'cooccurrence');
  }

  // ── Edges 3: note pillar_hint co-occurrence ───────────────────
  const { data: notesData } = await supabase
    .from('notes')
    .select('pillar_hint, note_date')
    .eq('user_id', user.id)
    .not('pillar_hint', 'is', null)
    .gte('note_date', ninetyDaysAgo);

  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pillarByNorm = new Map(nodes.map(n => [norm(n.name), n.id]));
  const noteCount: Record<string, number> = {};

  for (const note of notesData ?? []) {
    if (!note.pillar_hint) continue;
    const hintId = pillarByNorm.get(norm(note.pillar_hint));
    if (!hintId) continue;
    for (const pid of byDate[note.note_date] ?? []) {
      if (pid === hintId) continue;
      const key = [pid, hintId].sort().join('|');
      noteCount[key] = (noteCount[key] ?? 0) + 1;
    }
  }

  for (const [key, count] of Object.entries(noteCount)) {
    if (count < 2) continue;
    const [src, tgt] = key.split('|');
    if (src && tgt) addEdge(src, tgt, Math.min(count, 8), 'note');
  }

  return <GraphClient nodes={nodes} edges={edges} />;
}
