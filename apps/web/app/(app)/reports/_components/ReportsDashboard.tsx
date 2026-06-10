'use client';

import styles from './ReportsDashboard.module.css';

const MONTH_NAMES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];

const NOTE_TYPE_LABELS: Record<string, string> = {
  food:    'Alimentação',
  expense: 'Gastos',
  mood:    'Humor',
  idea:    'Ideias',
  other:   'Outros',
};

function MonthNav({ year, month }: { year: number; month: number }) {
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return (
    <div className={styles.monthNav}>
      <a href={`?year=${prev.year}&month=${prev.month}`} className={styles.navBtn}>←</a>
      <h2 className={styles.monthTitle}>{MONTH_NAMES[month - 1]} {year}</h2>
      <a href={`?year=${next.year}&month=${next.month}`} className={styles.navBtn}>→</a>
    </div>
  );
}

function XPBarChart({ data }: { data: { date: string; xp: number }[] }) {
  const maxXP = Math.max(...data.map(d => d.xp), 1);
  const W = 580; const H = 80;
  const barW = Math.max(2, Math.floor((W - 20) / data.length) - 1);
  const labelStep = data.length <= 31 ? 7 : 14;

  return (
    <svg viewBox={`0 0 ${W} ${H + 20}`} className={styles.xpChart}>
      {data.map((d, i) => {
        const barH   = Math.max(2, Math.round((d.xp / maxXP) * H));
        const x      = 10 + i * (barW + 1);
        const y      = H - barH;
        const active = d.xp > 0;
        const dayNum = parseInt(d.date.slice(8), 10);
        return (
          <g key={d.date}>
            <rect
              x={x} y={y} width={barW} height={barH}
              fill={active ? 'var(--accent)' : 'var(--border)'}
              opacity={active ? 0.85 : 0.35}
              rx={1}
            >
              <title>{d.date}: {d.xp} XP</title>
            </rect>
            {(dayNum === 1 || dayNum % labelStep === 0) && (
              <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize="9" fill="var(--text-muted)">
                {dayNum}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

type Props = {
  year:           number;
  month:          number;
  totalXP:        number;
  totalMinutes:   number;
  activeDays:     number;
  notesCount:     number;
  dailyXP:        { date: string; xp: number }[];
  xpByPillar:     Record<string, number>;
  minsByPillar:   Record<string, number>;
  pillarMap:      Record<string, string>;
  notesByType:    Record<string, { count: number; xp: number }>;
  topActivities:  { pillar: string; minutes: number; xp: number; note: string | null; date: string }[];
};

export default function ReportsDashboard({
  year, month, totalXP, totalMinutes, activeDays, notesCount,
  dailyXP, xpByPillar, minsByPillar, pillarMap, notesByType, topActivities,
}: Props) {
  const maxPillarXP = Math.max(...Object.values(xpByPillar), 1);

  const sortedPillars = Object.entries(xpByPillar)
    .sort(([, a], [, b]) => b - a)
    .map(([id, xp]) => ({ id, name: pillarMap[id] ?? id, xp, mins: minsByPillar[id] ?? 0 }));

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
  }

  return (
    <main className={styles.container}>
      <MonthNav year={year} month={month} />

      {/* Summary */}
      <div className={styles.summary}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryValue}>{totalXP.toLocaleString('pt-BR')}</span>
          <span className={styles.summaryLabel}>XP total</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryValue}>{Math.round(totalMinutes / 60)}h {totalMinutes % 60}m</span>
          <span className={styles.summaryLabel}>tempo registrado</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryValue}>{activeDays}</span>
          <span className={styles.summaryLabel}>dias ativos</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryValue}>{notesCount}</span>
          <span className={styles.summaryLabel}>notas capturadas</span>
        </div>
      </div>

      {/* XP por dia */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>XP por dia</h3>
        {totalXP === 0
          ? <p className={styles.empty}>Nenhuma atividade registrada neste mês.</p>
          : <XPBarChart data={dailyXP} />}
      </section>

      {/* XP por pilar */}
      {sortedPillars.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Tempo por pilar</h3>
          <div className={styles.pillarBars}>
            {sortedPillars.map(p => (
              <div key={p.id} className={styles.pillarBarRow}>
                <span className={styles.pillarBarName}>{p.name}</span>
                <div className={styles.pillarBarTrack}>
                  <div
                    className={styles.pillarBarFill}
                    style={{ width: `${((p.xp / maxPillarXP) * 100).toFixed(1)}%` }}
                  />
                </div>
                <span className={styles.pillarBarValue}>{p.xp.toLocaleString('pt-BR')} XP</span>
                <span className={styles.pillarBarMins}>{p.mins}min</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Notas por tipo */}
      {Object.keys(notesByType).length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Notas capturadas</h3>
          <div className={styles.noteTypes}>
            {Object.entries(notesByType).sort(([,a],[,b]) => b.count - a.count).map(([type, data]) => (
              <div key={type} className={styles.noteTypeCard}>
                <span className={styles.noteTypeLabel}>{NOTE_TYPE_LABELS[type] ?? type}</span>
                <span className={styles.noteTypeCount}>{data.count}</span>
                <span className={styles.noteTypeXP}>+{data.xp} XP</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top atividades */}
      {topActivities.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Maiores sessões</h3>
          <div className={styles.topTable}>
            <div className={styles.topHeader}>
              <span>Data</span>
              <span>Pilar</span>
              <span>Duração</span>
              <span>XP</span>
            </div>
            {topActivities.map((a, i) => (
              <div key={i} className={styles.topRow}>
                <span className={styles.topDate}>{formatDate(a.date)}</span>
                <span className={styles.topPillar}>{a.pillar}</span>
                <span className={styles.topValue}>{a.minutes}min</span>
                <span className={styles.topValue}>{a.xp.toLocaleString('pt-BR')}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {totalXP === 0 && notesCount === 0 && (
        <p className={styles.empty}>Nenhum dado para este mês ainda.</p>
      )}
    </main>
  );
}
