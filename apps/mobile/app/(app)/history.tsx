import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  FlatList,
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
  duration_minutes: number;
  base_xp: number;
  bonus_multiplier: number;
  total_xp: number;
  bonuses: Enums<'activity_bonus'>[];
  note: string | null;
  created_at: string;
};

type DayGroup = {
  dateKey: string;
  dayXP: number;
  records: XPRecord[];
};

const BONUS_LABELS: Record<Enums<'activity_bonus'>, string> = {
  first_of_day:     'Primeiro do dia',
  forgotten_pillar: 'Pilar esquecido',
  active_streak:    'Sequência ativa',
  active_quest:     'Quest ativa',
};

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

export default function HistoryScreen() {
  const { top } = useSafeAreaInsets();
  const [groups, setGroups] = useState<DayGroup[]>([]);
  const [pillarMap, setPillarMap] = useState<Map<string, string>>(new Map());
  const [weeklyXP, setWeeklyXP] = useState(0);
  const [loading, setLoading] = useState(true);
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
          .select('id, pillar_id, duration_minutes, base_xp, bonus_multiplier, total_xp, bonuses, note, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(200),
      ]);

      const map = new Map((pillarsRes.data ?? []).map((p) => [p.id, p.name]));
      setPillarMap(map);

      const allRecords = (recordsRes.data ?? []) as XPRecord[];

      // XP semanal
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      setWeeklyXP(
        allRecords
          .filter((r) => new Date(r.created_at) >= weekAgo)
          .reduce((s, r) => s + r.total_xp, 0),
      );

      // Agrupar por dia
      const grouped = new Map<string, XPRecord[]>();
      for (const record of allRecords) {
        const key = record.created_at.slice(0, 10);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(record);
      }

      setGroups(
        Array.from(grouped.entries())
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([dateKey, records]) => ({
            dateKey,
            dayXP: records.reduce((s, r) => s + r.total_xp, 0),
            records,
          })),
      );
    } catch (e) {
      console.error('[History] erro ao carregar:', e);
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
    <FlatList
      style={styles.root}
      contentContainerStyle={[
        groups.length === 0 ? styles.emptyContainer : styles.list,
        { paddingTop: top + spacing.md },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.accent}
        />
      }
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
      data={groups}
      keyExtractor={(g) => g.dateKey}
      renderItem={({ item: group }) => (
        <View style={styles.dayGroup}>
          <View style={styles.dayHeader}>
            <Text style={styles.dayLabel}>{formatDateHeading(group.dateKey)}</Text>
            <Text style={styles.dayXP}>+{group.dayXP.toLocaleString('pt-BR')} XP</Text>
          </View>

          {group.records.map((record) => (
            <View key={record.id} style={styles.record}>
              <View style={styles.recordTop}>
                <Text style={styles.pillarName}>
                  {pillarMap.get(record.pillar_id) ?? 'Pilar'}
                </Text>
                <View style={styles.recordMeta}>
                  <Text style={styles.duration}>{formatDuration(record.duration_minutes)}</Text>
                  <Text style={styles.xp}>+{record.total_xp} XP</Text>
                </View>
              </View>

              {record.bonuses.length > 0 && (
                <View style={styles.bonuses}>
                  {record.bonuses.map((b) => (
                    <Text key={b} style={styles.bonusTag}>⚡ {BONUS_LABELS[b]}</Text>
                  ))}
                </View>
              )}

              {record.note ? (
                <Text style={styles.note}>"{record.note}"</Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.lg },
  emptyContainer: { flex: 1, padding: spacing.lg },
  header: { marginBottom: spacing.xl },
  title: { fontSize: 26, fontWeight: '700', color: colors.textPrimary },
  summary: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  emptyBox: { alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxl },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  dayGroup: { marginBottom: spacing.xl },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  dayLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  dayXP: { fontSize: 14, color: colors.accent, fontWeight: '600' },
  record: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pillarName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  recordMeta: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  duration: { fontSize: 13, color: colors.textMuted },
  xp: { fontSize: 14, color: colors.accent, fontWeight: '600' },
  bonuses: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  bonusTag: {
    fontSize: 11,
    color: colors.warning,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  note: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', marginTop: spacing.xs },
});
