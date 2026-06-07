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

  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}

const BONUS_LABELS: Record<Enums<'activity_bonus'>, string> = {
  first_of_day:    'Primeiro do dia',
  forgotten_pillar:'Pilar esquecido',
  active_streak:   'Sequência ativa',
  active_quest:    'Quest ativa',
};

// ─── Page ─────────────────────────────────────────────────────

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Pillar name map
  const { data: pillarsData } = await supabase
    .from('user_pillars')
    .select('id, name')
    .eq('user_id', user.id);

  const pillarMap = new Map((pillarsData ?? []).map(p => [p.id, p.name]));

  // XP records ordered by activity_date desc, então created_at desc
  const { data: records } = await supabase
    .from('xp_records')
    .select('id, pillar_id, duration_minutes, base_xp, bonus_multiplier, total_xp, bonuses, note, created_at, activity_date')
    .eq('user_id', user.id)
    .order('activity_date', { ascending: false })
    .order('created_at',    { ascending: false })
    .limit(200);

  const allRecords = (records ?? []) as Array<{
    id: string;
    pillar_id: string;
    duration_minutes: number;
    base_xp: number;
    bonus_multiplier: number;
    total_xp: number;
    bonuses: Enums<'activity_bonus'>[];
    note: string | null;
    created_at: string;
    activity_date: string;
  }>;

  // Weekly summary (últimos 7 dias de activity_date)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);
  const weeklyXP = allRecords
    .filter(r => r.activity_date >= weekAgoStr)
    .reduce((s, r) => s + r.total_xp, 0);

  // Group by activity_date (YYYY-MM-DD)
  const groups = new Map<string, typeof allRecords>();
  for (const record of allRecords) {
    const dateKey = record.activity_date;
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey)!.push(record);
  }

  const sortedDays = Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));

  return (
    <main className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Histórico</h1>
        {allRecords.length > 0 && (
          <p className={styles.summary}>
            {weeklyXP > 0
              ? `${weeklyXP.toLocaleString('pt-BR')} XP nos últimos 7 dias`
              : 'Nenhuma atividade esta semana'}
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
          {sortedDays.map(([dateKey, dayRecords]) => {
            const dayXP = dayRecords.reduce((s, r) => s + r.total_xp, 0);
            return (
              <div key={dateKey} className={styles.dayGroup}>
                <div className={styles.dayHeader}>
                  <span className={styles.dayLabel}>{formatDateHeading(dateKey)}</span>
                  <span className={styles.dayXP}>+{dayXP.toLocaleString('pt-BR')} XP</span>
                </div>

                <div className={styles.recordList}>
                  {dayRecords.map(record => (
                    <div key={record.id} className={styles.record}>
                      <div className={styles.recordTop}>
                        <span className={styles.pillarName}>
                          {pillarMap.get(record.pillar_id) ?? 'Pilar'}
                        </span>
                        <div className={styles.recordMeta}>
                          <span className={styles.duration}>
                            {formatDuration(record.duration_minutes)}
                          </span>
                          <span className={styles.xp}>+{record.total_xp} XP</span>
                        </div>
                      </div>

                      {record.bonuses.length > 0 && (
                        <div className={styles.bonuses}>
                          {record.bonuses.map(b => (
                            <span key={b} className={styles.bonusTag}>
                              ⚡ {BONUS_LABELS[b]}
                            </span>
                          ))}
                        </div>
                      )}

                      {record.note && (
                        <p className={styles.note}>"{record.note}"</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
