import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ReportsDashboard from './_components/ReportsDashboard';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const params    = await searchParams;
  const now       = new Date();
  const year      = parseInt(params.year  ?? String(now.getFullYear()), 10);
  const month     = parseInt(params.month ?? String(now.getMonth() + 1), 10);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth  = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  const [xpRes, notesRes, pillarsRes] = await Promise.all([
    supabase
      .from('xp_records')
      .select('pillar_id, total_xp, duration_minutes, note, activity_date')
      .eq('user_id', user.id)
      .gte('activity_date', monthStart)
      .lt('activity_date', nextMonth)
      .order('activity_date'),
    supabase
      .from('notes')
      .select('note_type, xp_awarded, note_date, content')
      .eq('user_id', user.id)
      .gte('note_date', monthStart)
      .lt('note_date', nextMonth),
    supabase
      .from('user_pillars')
      .select('id, name')
      .eq('user_id', user.id)
      .eq('is_active', true),
  ]);

  const records  = xpRes.data    ?? [];
  const notes    = notesRes.data ?? [];
  const pillars  = pillarsRes.data ?? [];
  const pillarMap: Record<string, string> = Object.fromEntries(pillars.map(p => [p.id, p.name]));

  // Aggregate XP by day
  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyXP: { date: string; xp: number }[] = Array.from({ length: daysInMonth }, (_, i) => {
    const d = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    return { date: d, xp: 0 };
  });
  for (const r of records) {
    const day = parseInt(r.activity_date.slice(8, 10), 10) - 1;
    if (day >= 0 && day < dailyXP.length) dailyXP[day]!.xp += r.total_xp;
  }

  // XP by pillar
  const xpByPillar: Record<string, number> = {};
  const minsByPillar: Record<string, number> = {};
  for (const r of records) {
    xpByPillar[r.pillar_id]   = (xpByPillar[r.pillar_id]   ?? 0) + r.total_xp;
    minsByPillar[r.pillar_id] = (minsByPillar[r.pillar_id] ?? 0) + (r.duration_minutes ?? 0);
  }

  // Notes by type
  const notesByType: Record<string, { count: number; xp: number }> = {};
  for (const n of notes) {
    const t = n.note_type ?? 'other';
    if (!notesByType[t]) notesByType[t] = { count: 0, xp: 0 };
    notesByType[t]!.count += 1;
    notesByType[t]!.xp    += n.xp_awarded ?? 0;
  }

  // Top activities
  const topActivities = [...records]
    .sort((a, b) => b.duration_minutes - a.duration_minutes)
    .slice(0, 5)
    .map(r => ({
      pillar:   pillarMap[r.pillar_id] ?? '?',
      minutes:  r.duration_minutes,
      xp:       r.total_xp,
      note:     r.note,
      date:     r.activity_date,
    }));

  const totalXP      = records.reduce((s, r) => s + r.total_xp, 0);
  const totalMinutes = records.reduce((s, r) => s + (r.duration_minutes ?? 0), 0);
  const activeDays   = new Set(records.map(r => r.activity_date)).size;

  return (
    <ReportsDashboard
      year={year}
      month={month}
      totalXP={totalXP}
      totalMinutes={totalMinutes}
      activeDays={activeDays}
      notesCount={notes.length}
      dailyXP={dailyXP}
      xpByPillar={xpByPillar}
      minsByPillar={minsByPillar}
      pillarMap={pillarMap}
      notesByType={notesByType}
      topActivities={topActivities}
    />
  );
}
