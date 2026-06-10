import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import HomeDashboard from './_components/HomeDashboard';
import type { DisplayMode, Pillar, PillarWithChildren, PendingPillar, XPRecord } from './_components/HomeDashboard';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/chat');

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, display_mode')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/chat');

  // ── Insight mais recente não dispensado ───────────────────────
  const { data: latestInsight } = await supabase
    .from('insights')
    .select('id, text, generated_at')
    .eq('user_id', user.id)
    .is('dismissed_at', null)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: recentEntryCount } = await supabase
    .from('xp_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gt('created_at', latestInsight?.generated_at ?? new Date(0).toISOString());

  const shouldTriggerInsight = !latestInsight && (recentEntryCount ?? 0) >= 5;

  // ── Pilares pendentes ─────────────────────────────────────────
  const { data: pendingPillarsData } = await supabase
    .from('user_pillars')
    .select('id, name, pending_activity')
    .eq('user_id', user.id)
    .eq('status', 'pending');

  const pendingPillars = (pendingPillarsData ?? []) as PendingPillar[];

  // ── Pilares ativos ────────────────────────────────────────────
  const { data: pillarsData } = await supabase
    .from('user_pillars')
    .select('id, name, xp_rate, xp_total, level, is_active, is_priority')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('sort_order');

  const pillars: Pillar[] = pillarsData ?? [];

  const { data: relationsData } = await supabase
    .from('pillar_relationships')
    .select('parent_id, child_id')
    .in('parent_id', pillars.map(p => p.id));

  const relations  = relationsData ?? [];
  const childIds   = new Set(relations.map(r => r.child_id));
  const childrenByParent = new Map<string, string[]>();
  for (const r of relations) {
    const list = childrenByParent.get(r.parent_id) ?? [];
    list.push(r.child_id);
    childrenByParent.set(r.parent_id, list);
  }
  const pillarById = new Map(pillars.map(p => [p.id, p]));

  const rootPillars: PillarWithChildren[] = pillars
    .filter(p => !childIds.has(p.id))
    .map(p => ({
      ...p,
      children: (childrenByParent.get(p.id) ?? [])
        .map(cid => pillarById.get(cid))
        .filter((c): c is Pillar => c !== undefined),
    }));

  // ── Atividades recentes (para modo minimal) ───────────────────
  const { data: recentData } = await supabase
    .from('xp_records')
    .select('id, pillar_id, duration_minutes, total_xp, note, activity_date')
    .eq('user_id', user.id)
    .order('activity_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(8);

  const recentActivities = (recentData ?? []) as XPRecord[];

  // ── XP semanal por pilar + XP diário 30 dias (modo analítico) ──
  const weekAgo    = new Date(Date.now() -  7 * 86400_000).toISOString().slice(0, 10);
  const monthAgo   = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const [weeklyData, dailyData] = await Promise.all([
    supabase.from('xp_records').select('pillar_id, total_xp').eq('user_id', user.id).gte('activity_date', weekAgo),
    supabase.from('xp_records').select('activity_date, total_xp').eq('user_id', user.id).gte('activity_date', monthAgo).order('activity_date'),
  ]);

  const weeklyXpByPillar: Record<string, number> = {};
  for (const r of weeklyData.data ?? []) {
    weeklyXpByPillar[r.pillar_id] = (weeklyXpByPillar[r.pillar_id] ?? 0) + r.total_xp;
  }

  const dailyXpMap: Record<string, number> = {};
  for (const r of dailyData.data ?? []) {
    dailyXpMap[r.activity_date] = (dailyXpMap[r.activity_date] ?? 0) + r.total_xp;
  }
  const today    = new Date().toISOString().slice(0, 10);
  const dailyXP: { date: string; xp: number }[] = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 86400_000).toISOString().slice(0, 10);
    return { date: d, xp: dailyXpMap[d] ?? 0 };
  });
  void today;

  const pillarMap: Record<string, string> = Object.fromEntries(pillars.map(p => [p.id, p.name]));

  const allPillarsForModal = pillars.map(p => ({ id: p.id, name: p.name, xp_rate: p.xp_rate }));

  return (
    <HomeDashboard
      profileName={profile.name}
      initialMode={(profile.display_mode as DisplayMode) ?? 'game'}
      rootPillars={rootPillars}
      allPillarsForModal={allPillarsForModal}
      latestInsight={latestInsight ?? null}
      shouldTriggerInsight={shouldTriggerInsight}
      pendingPillars={pendingPillars}
      weeklyXpByPillar={weeklyXpByPillar}
      dailyXP={dailyXP}
      recentActivities={recentActivities}
      pillarMap={pillarMap}
    />
  );
}

