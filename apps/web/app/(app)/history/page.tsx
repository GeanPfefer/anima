import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Enums } from '@anima/types';
import styles from './history.module.css';

// ─── Helpers ──────────────────────────────────────────────────

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatDateHeading(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isToday =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isToday) return 'Hoje';
  if (isYesterday) return 'Ontem';

  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatWeekRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + 'T12:00:00');
  const end   = new Date(endDate   + 'T12:00:00');
  const startFmt = start.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
  const endFmt   = end.toLocaleDateString('pt-BR',   { day: 'numeric', month: 'short' });
  return `${startFmt} – ${endFmt}`;
}

// Retorna a segunda-feira da semana de uma data YYYY-MM-DD
function weekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=dom, 1=seg...
  const diff = (day + 6) % 7; // dias desde segunda
  const monday = new Date(d);
  monday.setDate(d.getDate() - diff);
  return monday.toISOString().slice(0, 10);
}

const BONUS_LABELS: Record<Enums<'activity_bonus'>, string> = {
  first_of_day:    'Primeiro do dia',
  forgotten_pillar:'Pilar esquecido',
  active_streak:   'Sequência ativa',
  active_quest:    'Quest ativa',
};

// ─── Tipos ────────────────────────────────────────────────────

type XPRecord = {
  id: string;
  pillar_id: string;
  duration_minutes: number;
  total_xp: number;
  bonuses: Enums<'activity_bonus'>[];
  note: string | null;
  activity_date: string;
};

type DayGroup = {
  dateKey: string;
  records: XPRecord[];
};

type WeekGroup = {
  weekStart: string;
  days: DayGroup[];
};


// ─── Page ─────────────────────────────────────────────────────

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: pillarsData } = await supabase
    .from('user_pillars')
    .select('id, name')
    .eq('user_id', user.id);

  const pillarMap = new Map((pillarsData ?? []).map(p => [p.id, p.name]));

  const { data: rawRecords } = await supabase
    .from('xp_records')
    .select('id, pillar_id, duration_minutes, total_xp, bonuses, note, activity_date')
    .eq('user_id', user.id)
    .order('activity_date', { ascending: false })
    .order('created_at',    { ascending: false })
    .limit(300);

  const allRecords = (rawRecords ?? []) as XPRecord[];

  // ── Resumo semanal ────────────────────────────────────────
  const weekAgoStr = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const weeklyXP   = allRecords.filter(r => r.activity_date >= weekAgoStr)
                               .reduce((s, r) => s + r.total_xp, 0);

  // ── Agrupar por semana → dia ─────────────────────────────
  const weekMap = new Map<string, Map<string, XPRecord[]>>();
  for (const record of allRecords) {
    const wk  = weekKey(record.activity_date);
    const day = record.activity_date;
    if (!weekMap.has(wk))  weekMap.set(wk, new Map());
    const dayMap = weekMap.get(wk)!;
    if (!dayMap.has(day))  dayMap.set(day, []);
    dayMap.get(day)!.push(record);
  }

  const sortedWeeks: WeekGroup[] = Array.from(weekMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([weekStart, dayMap]) => ({
      weekStart,
      days: Array.from(dayMap.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([dateKey, records]) => ({ dateKey, records })),
    }));

  return (
    <main className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Histórico</h1>
        {weeklyXP > 0 && (
          <p className={styles.summary}>
            {weeklyXP.toLocaleString('pt-BR')} XP nos últimos 7 dias
          </p>
        )}
      </div>

      {allRecords.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nenhuma atividade ainda</p>
          <p className={styles.emptyText}>
            Registre sua primeira atividade na tela inicial para começar a construir seu histórico.
          </p>
          <a href="/home" className={styles.emptyLink}>Ir para Home →</a>
        </div>
      ) : (
        <div className={styles.timeline}>
          {sortedWeeks.map(({ weekStart, days }) => {
            // Calcula totais da semana
            const allDayRecords = days.flatMap(d => d.records);
            const weekXP        = allDayRecords.reduce((s, r) => s + r.total_xp, 0);
            const weekMins      = allDayRecords.reduce((s, r) => s + r.duration_minutes, 0);
            const weekPillars   = [...new Set(allDayRecords.map(r => pillarMap.get(r.pillar_id) ?? ''))].filter(Boolean);
            const lastDay       = days[0]?.dateKey ?? weekStart;
            const isCurrentWeek = weekStart === weekKey(new Date().toISOString().slice(0, 10));

            return (
              <div key={weekStart} className={styles.weekGroup}>
                {/* Cabeçalho de semana */}
                <div className={styles.weekHeader}>
                  <span className={styles.weekLabel}>
                    {isCurrentWeek ? 'Esta semana' : formatWeekRange(weekStart, lastDay)}
                  </span>
                  <span className={styles.weekStats}>
                    {formatDuration(weekMins)}
                    {weekPillars.length > 0 && (
                      <span className={styles.weekPillars}> · {weekPillars.slice(0, 3).join(' · ')}</span>
                    )}
                    <span className={styles.weekXP}> · +{weekXP.toLocaleString('pt-BR')} XP</span>
                  </span>
                </div>

                {/* Dias dentro da semana */}
                {days.map(({ dateKey, records }) => {
                  const dayMins = records.reduce((s, r) => s + r.duration_minutes, 0);
                  const dayXP   = records.reduce((s, r) => s + r.total_xp, 0);

                  return (
                    <div key={dateKey} className={styles.dayGroup}>
                      <div className={styles.dayHeader}>
                        <span className={styles.dayLabel}>{formatDateHeading(dateKey)}</span>
                        <span className={styles.dayMeta}>
                          {formatDuration(dayMins)}
                          <span className={styles.dayXP}> · +{dayXP.toLocaleString('pt-BR')} XP</span>
                        </span>
                      </div>

                      <div className={styles.entryList}>
                        {records.map(record => (
                          <div key={record.id} className={styles.entry}>
                            {/* Nota como conteúdo principal */}
                            {record.note ? (
                              <p className={styles.entryNote}>{record.note}</p>
                            ) : (
                              <p className={styles.entryNotePlaceholder}>—</p>
                            )}

                            {/* Metadata secundária */}
                            <div className={styles.entryMeta}>
                              <span className={styles.entryPillar}>
                                {pillarMap.get(record.pillar_id) ?? 'Pilar'}
                              </span>
                              {record.duration_minutes > 0 && (
                                <span className={styles.entryDuration}>
                                  {formatDuration(record.duration_minutes)}
                                </span>
                              )}
                              <span className={styles.entryXP}>+{record.total_xp} XP</span>

                              {record.bonuses.map(b => (
                                <span key={b} className={styles.bonusTag}>
                                  ⚡ {BONUS_LABELS[b]}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
