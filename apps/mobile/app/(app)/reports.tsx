import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { colors, spacing, radius } from '@/constants/theme';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const NOTE_TYPE_LABELS: Record<string, string> = {
  food:    'Alimentação',
  expense: 'Gastos',
  mood:    'Humor',
  idea:    'Ideias',
  other:   'Outros',
};

type DailyXP = { date: string; xp: number };
type PillarStat = { id: string; name: string; xp: number; mins: number };
type NoteTypeStat = { type: string; count: number };
type TopActivity = { pillar: string; minutes: number; xp: number; note: string | null; date: string };

type ReportData = {
  totalXP: number;
  totalMinutes: number;
  activeDays: number;
  notesCount: number;
  dailyXP: DailyXP[];
  sortedPillars: PillarStat[];
  notesByType: NoteTypeStat[];
  topActivities: TopActivity[];
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ─── Mini bar chart de XP por dia ─────────────────────────────

function XPBarChart({ data }: { data: DailyXP[] }) {
  const maxXP = Math.max(...data.map(d => d.xp), 1);
  const BAR_HEIGHT = 56;

  return (
    <View style={chart.container}>
      {data.map((d, i) => {
        const heightPct = d.xp / maxXP;
        const barH = Math.max(2, Math.round(heightPct * BAR_HEIGHT));
        const dayNum = parseInt(d.date.slice(8), 10);
        const showLabel = dayNum === 1 || dayNum % 7 === 0;
        const active = d.xp > 0;

        return (
          <View key={d.date} style={chart.col}>
            <View style={[chart.barTrack, { height: BAR_HEIGHT }]}>
              <View
                style={[
                  chart.bar,
                  {
                    height: barH,
                    backgroundColor: active ? colors.accent : colors.border,
                    opacity: active ? 0.85 : 0.4,
                  },
                ]}
              />
            </View>
            {showLabel && (
              <Text style={chart.label}>{dayNum}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const chart = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
    paddingBottom: spacing.sm,
  },
  col: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  barTrack: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: 1,
    minHeight: 2,
  },
  label: {
    fontSize: 8,
    color: colors.textMuted,
  },
});

// ─── Tela principal ───────────────────────────────────────────

export default function ReportsScreen() {
  const { top } = useSafeAreaInsets();

  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData]   = useState<ReportData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (y: number, m: number) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;

      const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
      const nextMonth  = m === 12
        ? `${y + 1}-01-01`
        : `${y}-${String(m + 1).padStart(2, '0')}-01`;

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
          .select('note_type')
          .eq('user_id', user.id)
          .gte('note_date', monthStart)
          .lt('note_date', nextMonth),
        supabase
          .from('user_pillars')
          .select('id, name')
          .eq('user_id', user.id)
          .eq('is_active', true),
      ]);

      const records = (xpRes.data ?? []) as {
        pillar_id: string;
        total_xp: number;
        duration_minutes: number;
        note: string | null;
        activity_date: string;
      }[];
      const notes   = (notesRes.data ?? []) as { note_type: string | null }[];
      const pillars = (pillarsRes.data ?? []) as { id: string; name: string }[];
      const pillarMap = Object.fromEntries(pillars.map(p => [p.id, p.name]));

      // XP por dia
      const daysInMonth = new Date(y, m, 0).getDate();
      const dailyXP: DailyXP[] = Array.from({ length: daysInMonth }, (_, i) => {
        const d = `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
        return { date: d, xp: 0 };
      });
      for (const r of records) {
        const day = parseInt(r.activity_date.slice(8, 10), 10) - 1;
        if (day >= 0 && day < dailyXP.length) dailyXP[day]!.xp += r.total_xp;
      }

      // Por pilar
      const xpByPillar: Record<string, number>   = {};
      const minsByPillar: Record<string, number> = {};
      for (const r of records) {
        xpByPillar[r.pillar_id]   = (xpByPillar[r.pillar_id]   ?? 0) + r.total_xp;
        minsByPillar[r.pillar_id] = (minsByPillar[r.pillar_id] ?? 0) + (r.duration_minutes ?? 0);
      }
      const sortedPillars: PillarStat[] = Object.entries(xpByPillar)
        .sort(([, a], [, b]) => b - a)
        .map(([id, xp]) => ({ id, name: pillarMap[id] ?? id, xp, mins: minsByPillar[id] ?? 0 }));

      // Notas por tipo
      const noteTypeMap: Record<string, number> = {};
      for (const n of notes) {
        const t = n.note_type ?? 'other';
        noteTypeMap[t] = (noteTypeMap[t] ?? 0) + 1;
      }
      const notesByType: NoteTypeStat[] = Object.entries(noteTypeMap)
        .sort(([, a], [, b]) => b - a)
        .map(([type, count]) => ({ type, count }));

      // Top atividades
      const topActivities: TopActivity[] = [...records]
        .sort((a, b) => b.duration_minutes - a.duration_minutes)
        .slice(0, 5)
        .map(r => ({
          pillar:  pillarMap[r.pillar_id] ?? '?',
          minutes: r.duration_minutes,
          xp:      r.total_xp,
          note:    r.note,
          date:    r.activity_date,
        }));

      setData({
        totalXP:       records.reduce((s, r) => s + r.total_xp, 0),
        totalMinutes:  records.reduce((s, r) => s + (r.duration_minutes ?? 0), 0),
        activeDays:    new Set(records.map(r => r.activity_date)).size,
        notesCount:    notes.length,
        dailyXP,
        sortedPillars,
        notesByType,
        topActivities,
      });
    } catch (e) {
      console.error('[Reports] erro:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(year, month); }, [load, year, month]));

  function prevMonth() {
    const nm = month === 1 ? 12 : month - 1;
    const ny = month === 1 ? year - 1 : year;
    setYear(ny);
    setMonth(nm);
    setLoading(true);
    load(ny, nm);
  }
  function nextMonthFn() {
    const nm = month === 12 ? 1 : month + 1;
    const ny = month === 12 ? year + 1 : year;
    setYear(ny);
    setMonth(nm);
    setLoading(true);
    load(ny, nm);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const maxPillarXP = Math.max(...(data?.sortedPillars.map(p => p.xp) ?? []), 1);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: top + spacing.md }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(year, month); }}
          tintColor={colors.accent}
        />
      }
    >
      {/* Cabeçalho */}
      <Text style={styles.screenTitle}>Relatórios</Text>

      {/* Navegação de mês */}
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={prevMonth} style={styles.navBtn}>
          <Text style={styles.navBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.monthTitle}>
          {MONTH_NAMES[month - 1]} {year}
        </Text>
        <TouchableOpacity onPress={nextMonthFn} style={styles.navBtn}>
          <Text style={styles.navBtnText}>→</Text>
        </TouchableOpacity>
      </View>

      {!data || (data.totalXP === 0 && data.notesCount === 0) ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>Nenhum dado este mês</Text>
          <Text style={styles.emptyText}>Registre atividades para ver seus relatórios aqui.</Text>
        </View>
      ) : (
        <>
          {/* Resumo */}
          <View style={styles.summary}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{data.totalXP.toLocaleString('pt-BR')}</Text>
              <Text style={styles.summaryLabel}>XP total</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>
                {Math.floor(data.totalMinutes / 60)}h {data.totalMinutes % 60}m
              </Text>
              <Text style={styles.summaryLabel}>tempo registrado</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{data.activeDays}</Text>
              <Text style={styles.summaryLabel}>dias ativos</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{data.notesCount}</Text>
              <Text style={styles.summaryLabel}>notas</Text>
            </View>
          </View>

          {/* XP por dia */}
          {data.totalXP > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>XP por dia</Text>
              <XPBarChart data={data.dailyXP} />
            </View>
          )}

          {/* Tempo por pilar */}
          {data.sortedPillars.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tempo por pilar</Text>
              {data.sortedPillars.map(p => (
                <View key={p.id} style={styles.pillarRow}>
                  <View style={styles.pillarRowTop}>
                    <Text style={styles.pillarName}>{p.name}</Text>
                    <Text style={styles.pillarMeta}>{p.mins}min · {p.xp.toLocaleString('pt-BR')} XP</Text>
                  </View>
                  <View style={styles.pillarTrack}>
                    <View
                      style={[
                        styles.pillarFill,
                        { width: `${((p.xp / maxPillarXP) * 100).toFixed(1)}%` as `${number}%` },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Notas por tipo */}
          {data.notesByType.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Notas capturadas</Text>
              <View style={styles.noteGrid}>
                {data.notesByType.map(({ type, count }) => (
                  <View key={type} style={styles.noteCard}>
                    <Text style={styles.noteCount}>{count}</Text>
                    <Text style={styles.noteLabel}>{NOTE_TYPE_LABELS[type] ?? type}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Maiores sessões */}
          {data.topActivities.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Maiores sessões</Text>
              {data.topActivities.map((a, i) => (
                <View key={i} style={styles.activityRow}>
                  <View style={styles.activityLeft}>
                    <Text style={styles.activityDate}>{formatDate(a.date)}</Text>
                    <View style={styles.pillarChip}>
                      <Text style={styles.pillarChipText}>{a.pillar}</Text>
                    </View>
                    {a.note ? (
                      <Text style={styles.activityNote} numberOfLines={1}>{a.note}</Text>
                    ) : null}
                  </View>
                  <View style={styles.activityRight}>
                    <Text style={styles.activityDuration}>{formatDuration(a.minutes)}</Text>
                    <Text style={styles.activityXP}>+{a.xp.toLocaleString('pt-BR')} XP</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  screenTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },

  // Navegação de mês
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  navBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  navBtnText:  { fontSize: 18, color: colors.textSecondary },
  monthTitle:  { fontSize: 17, fontWeight: '600', color: colors.textPrimary },

  // Summary cards
  summary: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
    gap: 2,
  },
  summaryValue: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  summaryLabel: { fontSize: 9, color: colors.textMuted, textAlign: 'center' },

  // Seções
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },

  // Pilares
  pillarRow: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  pillarRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  pillarName:  { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  pillarMeta:  { fontSize: 11, color: colors.textMuted },
  pillarTrack: {
    height: 6,
    backgroundColor: colors.bgElevated,
    borderRadius: 3,
    overflow: 'hidden',
  },
  pillarFill: {
    height: 6,
    backgroundColor: colors.accent,
    borderRadius: 3,
    opacity: 0.8,
  },

  // Notas por tipo
  noteGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  noteCard: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    minWidth: 72,
    gap: 2,
  },
  noteCount: { fontSize: 20, fontWeight: '700', color: colors.accent },
  noteLabel: { fontSize: 11, color: colors.textSecondary },

  // Top atividades
  activityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  activityLeft: {
    flex: 1,
    gap: 4,
    flexDirection: 'column',
  },
  activityDate: { fontSize: 11, color: colors.textMuted },
  pillarChip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 1,
    backgroundColor: colors.bgElevated,
  },
  pillarChipText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  activityNote:   { fontSize: 12, color: colors.textSecondary },
  activityRight:  { alignItems: 'flex-end', gap: 2 },
  activityDuration: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  activityXP:     { fontSize: 12, fontWeight: '600', color: colors.accent },

  // Empty state
  emptyBox:  { alignItems: 'center', paddingTop: 64, gap: spacing.sm },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
  emptyText:  { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
});
