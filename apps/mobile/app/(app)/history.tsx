import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import type { Enums } from '@anima/types';
import { colors, spacing, radius } from '@/constants/theme';

type XPRecord = {
  id: string;
  pillar_id: string;
  pillar_name: string;   // resolvido via pillarMap durante load
  duration_minutes: number;
  total_xp: number;
  bonuses: Enums<'activity_bonus'>[];
  note: string | null;
  activity_date: string;
};

// Seção = uma semana
type Section = {
  title: string;       // "Esta semana" | "5 – 11 mai"
  stats: string;       // "2h30 · Saúde · Trabalho · +450 XP"
  data: DayGroup[];
};

type DayGroup = {
  dateKey: string;
  dayLabel: string;
  dayMins: number;
  dayXP: number;
  records: XPRecord[];
};

const BONUS_LABELS: Record<Enums<'activity_bonus'>, string> = {
  first_of_day:     'Primeiro do dia',
  forgotten_pillar: 'Pilar esquecido',
  active_streak:    'Sequência ativa',
  active_quest:     'Quest ativa',
};

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

  const sameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

  if (sameDay(date, today))     return 'Hoje';
  if (sameDay(date, yesterday)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });
}

function weekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const diff = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - diff);
  return monday.toISOString().slice(0, 10);
}

function formatWeekLabel(weekStart: string, lastDay: string, isCurrentWeek: boolean): string {
  if (isCurrentWeek) return 'Esta semana';
  const start = new Date(weekStart + 'T12:00:00');
  const end   = new Date(lastDay  + 'T12:00:00');
  return `${start.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`;
}

// ─── Componente principal ──────────────────────────────────────

export default function HistoryScreen() {
  const { top } = useSafeAreaInsets();
  const [sections, setSections] = useState<Section[]>([]);
  const [weeklyXP, setWeeklyXP] = useState(0);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;

      const [pillarsRes, recordsRes] = await Promise.all([
        supabase.from('user_pillars').select('id, name').eq('user_id', user.id),
        supabase
          .from('xp_records')
          .select('id, pillar_id, duration_minutes, total_xp, bonuses, note, activity_date')
          .eq('user_id', user.id)
          .order('activity_date', { ascending: false })
          .order('created_at',    { ascending: false })
          .limit(300),
      ]);

      const pillarMap = new Map((pillarsRes.data ?? []).map((p) => [p.id, p.name]));
      const rawRecords = (recordsRes.data ?? []) as Omit<XPRecord, 'pillar_name'>[];
      const allRecords: XPRecord[] = rawRecords.map(r => ({
        ...r,
        pillar_name: pillarMap.get(r.pillar_id) ?? 'Pilar',
      }));

      // XP semanal
      const weekAgoStr = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
      setWeeklyXP(allRecords.filter(r => r.activity_date >= weekAgoStr).reduce((s, r) => s + r.total_xp, 0));

      // Agrupa semana → dia
      const weekMap = new Map<string, Map<string, XPRecord[]>>();
      for (const record of allRecords) {
        const wk  = weekKey(record.activity_date);
        const day = record.activity_date;
        if (!weekMap.has(wk))  weekMap.set(wk, new Map());
        const dm = weekMap.get(wk)!;
        if (!dm.has(day)) dm.set(day, []);
        dm.get(day)!.push(record);
      }

      const currentWeekKey = weekKey(new Date().toISOString().slice(0, 10));
      const builtSections: Section[] = Array.from(weekMap.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([weekStart, dayMap]) => {
          const days: DayGroup[] = Array.from(dayMap.entries())
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([dateKey, records]) => ({
              dateKey,
              dayLabel: formatDateHeading(dateKey),
              dayMins:  records.reduce((s, r) => s + r.duration_minutes, 0),
              dayXP:    records.reduce((s, r) => s + r.total_xp, 0),
              records,
            }));

          const allRec    = days.flatMap(d => d.records);
          const weekMins  = allRec.reduce((s, r) => s + r.duration_minutes, 0);
          const weekXP    = allRec.reduce((s, r) => s + r.total_xp, 0);
          const pillars   = [...new Set(allRec.map(r => r.pillar_name))].filter(Boolean).slice(0, 3);
          const lastDay   = days[0]?.dateKey ?? weekStart;

          const statParts = [formatDuration(weekMins), ...pillars, `+${weekXP.toLocaleString('pt-BR')} XP`];

          return {
            title: formatWeekLabel(weekStart, lastDay, weekStart === currentWeekKey),
            stats: statParts.join(' · '),
            data:  days,
          };
        });

      setSections(builtSections);
    } catch (e) {
      console.error('[History] erro:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <SectionList
      style={styles.root}
      contentContainerStyle={[
        sections.length === 0 ? styles.emptyContainer : styles.list,
        { paddingTop: top + spacing.md },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.accent}
        />
      }
      stickySectionHeadersEnabled={false}
      sections={sections}
      keyExtractor={(item: DayGroup) => item.dateKey}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Histórico</Text>
          {weeklyXP > 0 && (
            <Text style={styles.summary}>
              {weeklyXP.toLocaleString('pt-BR')} XP nos últimos 7 dias
            </Text>
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>Nenhuma atividade ainda</Text>
          <Text style={styles.emptyText}>
            Registre sua primeira atividade na tela Home para começar a construir seu histórico.
          </Text>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.weekHeader}>
          <Text style={styles.weekLabel}>{section.title.toUpperCase()}</Text>
          <Text style={styles.weekStats}>{section.stats}</Text>
        </View>
      )}
      renderItem={({ item: day }: { item: DayGroup }) => (
        <View style={styles.dayGroup}>
          <View style={styles.dayHeader}>
            <Text style={styles.dayLabel}>{day.dayLabel}</Text>
            <Text style={styles.dayMeta}>
              {formatDuration(day.dayMins)}
              <Text style={styles.dayXP}> · +{day.dayXP.toLocaleString('pt-BR')} XP</Text>
            </Text>
          </View>

          {day.records.map((record) => (
            <View key={record.id} style={styles.entry}>
              {/* Nota como conteúdo principal */}
              {record.note ? (
                <Text style={styles.entryNote}>{record.note}</Text>
              ) : (
                <Text style={styles.entryNotePlaceholder}>—</Text>
              )}

              {/* Metadata compacta */}
              <View style={styles.entryMeta}>
                <View style={styles.pillarChip}>
                  <Text style={styles.pillarChipText}>{record.pillar_name}</Text>
                </View>
                {record.duration_minutes > 0 && (
                  <Text style={styles.metaDuration}>{formatDuration(record.duration_minutes)}</Text>
                )}
                <Text style={styles.metaXP}>+{record.total_xp} XP</Text>
                {record.bonuses.map(b => (
                  <Text key={b} style={styles.bonusTag}>⚡ {BONUS_LABELS[b]}</Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  root:           { flex: 1, backgroundColor: colors.bg },
  centered:       { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  list:           { padding: spacing.lg },
  emptyContainer: { flex: 1, padding: spacing.lg },
  header:         { marginBottom: spacing.xl },
  title:          { fontSize: 26, fontWeight: '700', color: colors.textPrimary },
  summary:        { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  emptyBox:       { alignItems: 'center', justifyContent: 'center', paddingTop: 64 },
  emptyTitle:     { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },
  emptyText:      { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  // Semana
  weekHeader: {
    marginBottom: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 2,
    borderColor: colors.border,
    gap: 2,
  },
  weekLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.6,
  },
  weekStats: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  // Dia
  dayGroup: { marginBottom: spacing.xl },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  dayLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  dayMeta:  { fontSize: 12, color: colors.textMuted },
  dayXP:    { color: colors.accent, fontWeight: '600' },

  // Entrada (formato narrativo)
  entry: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  entryNote:            { fontSize: 14, color: colors.textPrimary, lineHeight: 22 },
  entryNotePlaceholder: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },

  entryMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  pillarChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 1,
    backgroundColor: colors.bgElevated,
  },
  pillarChipText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  metaDuration:   { fontSize: 11, color: colors.textMuted },
  metaXP:         { fontSize: 11, fontWeight: '600', color: colors.accent },
  bonusTag:       { fontSize: 10, color: '#f59e0b' },
});
