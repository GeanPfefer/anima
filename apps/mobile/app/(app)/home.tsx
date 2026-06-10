import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { getCharacterLevel, getEraForLevel, getTotalXPForLevel, getXPToNextLevel } from '@anima/core';
import { confirmPendingPillar, dismissPendingPillar } from '@/lib/activity';
import LifeRadar from '@/components/LifeRadar';
import LogActivityModal from '@/components/LogActivityModal';
import { colors, spacing, radius } from '@/constants/theme';

// ─── Tipos ─────────────────────────────────────────────────────────────────────

type DisplayMode = 'game' | 'analytical' | 'minimal';

type PillarRow = {
  id: string;
  name: string;
  xp_rate: number;
  xp_total: number;
  level: number;
  is_priority: boolean;
};

type PendingPillar = {
  id: string;
  name: string;
  pending_activity: { durationMinutes: number; note?: string } | null;
};

type RecentActivity = {
  id: string;
  pillar_id: string;
  duration_minutes: number;
  total_xp: number;
  note: string | null;
  activity_date: string;
};

// ─── PillarCard ────────────────────────────────────────────────────────────────

function PillarCard({ p, sub = false }: { p: PillarRow; sub?: boolean }) {
  const levelStart = getTotalXPForLevel(p.level);
  const levelEnd   = getTotalXPForLevel(p.level + 1);
  const progress   = levelEnd > levelStart
    ? Math.max(0, Math.min(1, (p.xp_total - levelStart) / (levelEnd - levelStart)))
    : 1;
  const xpToNext = getXPToNextLevel(p.xp_total);

  return (
    <View style={[
      sub ? s.subPillarCard : s.pillarCard,
      p.is_priority && !sub ? s.pillarCardPriority : undefined,
    ]}>
      <View style={s.pillarTop}>
        <Text style={sub ? s.subPillarName : s.pillarName}>{p.name}</Text>
        <Text style={s.pillarLevel}>Nv. {p.level}</Text>
      </View>
      <View style={sub ? s.subXpBarTrack : s.xpBarTrack}>
        <View style={[s.xpBarFill, { width: `${(progress * 100).toFixed(1)}%` as `${number}%` }]} />
      </View>
      <View style={s.pillarBottom}>
        <Text style={s.xpTotal}>{p.xp_total.toLocaleString('pt-BR')} XP</Text>
        {p.level < 50 && (
          <Text style={s.xpToNext}>+{xpToNext} para Nv. {p.level + 1}</Text>
        )}
        {p.is_priority && !sub && <Text style={s.priorityBadge}>foco</Text>}
      </View>
    </View>
  );
}

// ─── ModeToggle ────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<DisplayMode, string> = {
  game:       'Game',
  analytical: 'Analítico',
  minimal:    'Minimal',
};

function ModeToggle({ mode, onChange }: { mode: DisplayMode; onChange: (m: DisplayMode) => void }) {
  return (
    <View style={s.modeToggle}>
      {(['game', 'analytical', 'minimal'] as DisplayMode[]).map((m) => (
        <TouchableOpacity
          key={m}
          style={[s.modeBtn, mode === m && s.modeBtnActive]}
          onPress={() => onChange(m)}
          activeOpacity={0.8}
        >
          <Text style={[s.modeBtnText, mode === m && s.modeBtnTextActive]}>
            {MODE_LABELS[m]}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── PendingPillarsWidget ──────────────────────────────────────────────────────

function PendingPillarsWidget({
  pillars,
  userId,
  onAction,
}: {
  pillars:  PendingPillar[];
  userId:   string;
  onAction: () => void;
}) {
  if (pillars.length === 0) return null;

  async function handleConfirm(p: PendingPillar) {
    await confirmPendingPillar(p.id, userId);
    onAction();
  }

  function handleDismiss(p: PendingPillar) {
    Alert.alert(
      'Ignorar pilar',
      `Remover "${p.name}" dos pilares detectados?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Ignorar',
          style: 'destructive',
          onPress: async () => {
            await dismissPendingPillar(p.id, userId);
            onAction();
          },
        },
      ],
    );
  }

  return (
    <View style={s.pendingWidget}>
      <Text style={s.pendingLabel}>Pilares detectados</Text>
      {pillars.map((p) => (
        <View key={p.id} style={s.pendingRow}>
          <View style={s.pendingInfo}>
            <Text style={s.pendingName}>{p.name}</Text>
            {p.pending_activity?.durationMinutes ? (
              <Text style={s.pendingMeta}>
                {p.pending_activity.durationMinutes} min
                {p.pending_activity.note ? ` · ${p.pending_activity.note}` : ''}
              </Text>
            ) : null}
          </View>
          <View style={s.pendingActions}>
            <TouchableOpacity
              style={s.pendingConfirmBtn}
              onPress={() => handleConfirm(p)}
              activeOpacity={0.8}
            >
              <Text style={s.pendingConfirmText}>Criar pilar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDismiss(p)} hitSlop={8}>
              <Text style={s.pendingDismissText}>Ignorar</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── GameView ──────────────────────────────────────────────────────────────────

function GameView({ rootPillars }: { rootPillars: PillarRow[] }) {
  return (
    <>
      <Text style={s.sectionLabel}>Radar de vida</Text>
      <View style={s.radarWrapper}>
        {rootPillars.length >= 3
          ? <LifeRadar pillars={rootPillars} />
          : <Text style={s.empty}>Nenhum pilar registrado.</Text>}
      </View>

      <Text style={s.sectionLabel}>Pilares</Text>
      {rootPillars.length === 0 ? (
        <Text style={s.empty}>Complete o onboarding para ver seus pilares.</Text>
      ) : (
        <View style={s.pillarList}>
          {rootPillars.map((p) => (
            <View key={p.id} style={s.pillarGroup}>
              <PillarCard p={p} />
            </View>
          ))}
        </View>
      )}
    </>
  );
}

// ─── AnalyticalView ────────────────────────────────────────────────────────────

function AnalyticalView({
  rootPillars,
  weeklyXp,
}: {
  rootPillars: PillarRow[];
  weeklyXp:    Record<string, number>;
}) {
  return (
    <>
      <Text style={s.sectionLabel}>Pilares — estatísticas</Text>
      <View style={s.statsTable}>
        <View style={s.statsHeader}>
          <Text style={[s.statsCell, s.statsCellPillar, s.statsHeaderText]}>Pilar</Text>
          <Text style={[s.statsCell, s.statsCellNum, s.statsHeaderText]}>Nível</Text>
          <Text style={[s.statsCell, s.statsCellNum, s.statsHeaderText]}>XP Total</Text>
          <Text style={[s.statsCell, s.statsCellNum, s.statsHeaderText]}>7 dias</Text>
        </View>
        {rootPillars.map((p) => (
          <View key={p.id} style={s.statsRow}>
            <Text style={[s.statsCell, s.statsCellPillar, s.statsPillarName]}>{p.name}</Text>
            <Text style={[s.statsCell, s.statsCellNum, s.statsValue]}>{p.level}</Text>
            <Text style={[s.statsCell, s.statsCellNum, s.statsValue]}>
              {p.xp_total.toLocaleString('pt-BR')}
            </Text>
            <Text style={[s.statsCell, s.statsCellNum, s.statsValue]}>
              {(weeklyXp[p.id] ?? 0) > 0
                ? `+${(weeklyXp[p.id] ?? 0).toLocaleString('pt-BR')}`
                : '—'}
            </Text>
          </View>
        ))}
      </View>
    </>
  );
}

// ─── MinimalView ───────────────────────────────────────────────────────────────

function MinimalView({
  rootPillars,
  recentActivities,
  pillarMap,
}: {
  rootPillars:      PillarRow[];
  recentActivities: RecentActivity[];
  pillarMap:        Record<string, string>;
}) {
  function formatDate(dateStr: string): string {
    const d    = new Date(dateStr + 'T12:00:00');
    const diff = Math.floor((Date.now() - d.getTime()) / 86400_000);
    if (diff === 0) return 'hoje';
    if (diff === 1) return 'ontem';
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
  }

  return (
    <>
      <Text style={s.sectionLabel}>Pilares</Text>
      <View style={s.minimalPillarList}>
        {rootPillars.map((p) => (
          <View key={p.id} style={s.minimalPillarRow}>
            <Text style={s.minimalPillarName}>{p.name}</Text>
            <Text style={s.minimalPillarLevel}>Nv. {p.level}</Text>
          </View>
        ))}
      </View>

      {recentActivities.length > 0 && (
        <>
          <Text style={[s.sectionLabel, { marginTop: spacing.xl }]}>Registros recentes</Text>
          <View style={s.minimalActivityList}>
            {recentActivities.map((r) => (
              <View key={r.id} style={s.minimalActivityRow}>
                <Text style={s.minimalDate}>{formatDate(r.activity_date)}</Text>
                <Text style={s.minimalPillarChip}>{pillarMap[r.pillar_id] ?? '?'}</Text>
                {r.note && <Text style={s.minimalNote} numberOfLines={1}>{r.note}</Text>}
              </View>
            ))}
          </View>
        </>
      )}
    </>
  );
}

// ─── HomeScreen ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { top } = useSafeAreaInsets();
  const [profile, setProfile]   = useState<{ name: string } | null>(null);
  const [rootPillars, setRootPillars] = useState<PillarRow[]>([]);
  const [allPillars, setAllPillars]   = useState<PillarRow[]>([]);
  const [userId, setUserId]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [insight, setInsight]   = useState<{ id: string; text: string } | null>(null);
  const [pendingPillars, setPendingPillars] = useState<PendingPillar[]>([]);
  const [mode, setMode]         = useState<DisplayMode>('game');
  const [weeklyXp, setWeeklyXp] = useState<Record<string, number>>({});
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [pillarMap, setPillarMap] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) { setLoading(false); setRefreshing(false); return; }
      setUserId(user.id);

      const [profileRes, pillarsRes, pendingRes, insightRes] = await Promise.all([
        supabase.from('profiles').select('name, display_mode').eq('id', user.id).single(),
        supabase.from('user_pillars')
          .select('id, name, xp_rate, xp_total, level, is_priority')
          .eq('user_id', user.id).eq('is_active', true).order('sort_order'),
        supabase.from('user_pillars')
          .select('id, name, pending_activity')
          .eq('user_id', user.id).eq('status', 'pending'),
        supabase.from('insights')
          .select('id, text').eq('user_id', user.id)
          .is('dismissed_at', null)
          .order('generated_at', { ascending: false }).limit(1).maybeSingle(),
      ]);

      const pillars: PillarRow[] = pillarsRes.data ?? [];
      setProfile(profileRes.data ? { name: profileRes.data.name } : null);
      setMode((profileRes.data?.display_mode as DisplayMode | null) ?? 'game');
      setRootPillars(pillars);
      setAllPillars(pillars);
      setPendingPillars((pendingRes.data ?? []) as PendingPillar[]);
      setInsight(insightRes.data ?? null);
      setPillarMap(Object.fromEntries(pillars.map((p) => [p.id, p.name])));

      // XP semanal por pilar (para modo analítico)
      const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
      const { data: weekData } = await supabase
        .from('xp_records').select('pillar_id, total_xp')
        .eq('user_id', user.id).gte('activity_date', weekAgo);
      const weekly: Record<string, number> = {};
      for (const r of weekData ?? []) {
        weekly[r.pillar_id] = (weekly[r.pillar_id] ?? 0) + r.total_xp;
      }
      setWeeklyXp(weekly);

      // Atividades recentes (para modo minimal)
      const { data: recentData } = await supabase
        .from('xp_records')
        .select('id, pillar_id, duration_minutes, total_xp, note, activity_date')
        .eq('user_id', user.id)
        .order('activity_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(8);
      setRecentActivities((recentData ?? []) as RecentActivity[]);
    } catch {
      // falha silenciosa
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleDismissInsight() {
    if (!insight) return;
    await supabase.from('insights')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', insight.id);
    setInsight(null);
  }

  async function handleModeChange(m: DisplayMode) {
    setMode(m);
    supabase.from('profiles').update({ display_mode: m }).eq('id', userId).then(() => {});
  }

  const characterLevel = getCharacterLevel(rootPillars.map((p) => p.level));
  const era            = getEraForLevel(characterLevel);

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: top + spacing.md }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.accent}
          />
        }
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.name}>{profile?.name ?? ''}</Text>
            {mode === 'game' && (
              <View style={s.characterMeta}>
                <Text style={s.level}>Nível {characterLevel}</Text>
                <Text style={s.separator}>·</Text>
                <Text style={s.era}>{era.name}</Text>
              </View>
            )}
          </View>
          <ModeToggle mode={mode} onChange={handleModeChange} />
        </View>

        {/* Pilares pendentes */}
        <PendingPillarsWidget
          pillars={pendingPillars}
          userId={userId}
          onAction={load}
        />

        {/* Insight automático */}
        {insight && (
          <View style={s.insightCard}>
            <View style={s.insightHeader}>
              <Text style={s.insightLabel}>INSIGHT</Text>
              <TouchableOpacity onPress={handleDismissInsight} hitSlop={8}>
                <Text style={s.insightDismiss}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.insightText}>{insight.text}</Text>
          </View>
        )}

        {mode === 'game' && <GameView rootPillars={rootPillars} />}
        {mode === 'analytical' && (
          <AnalyticalView rootPillars={rootPillars} weeklyXp={weeklyXp} />
        )}
        {mode === 'minimal' && (
          <MinimalView
            rootPillars={rootPillars}
            recentActivities={recentActivities}
            pillarMap={pillarMap}
          />
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {userId && (
        <LogActivityModal
          userId={userId}
          pillars={allPillars.map((p) => ({ id: p.id, name: p.name, xp_rate: p.xp_rate }))}
          onSuccess={load}
        />
      )}
    </View>
  );
}

// ─── Estilos ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  scroll:   { padding: spacing.lg },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  name:          { fontSize: 26, fontWeight: '700', color: colors.textPrimary },
  characterMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4 },
  level:         { fontSize: 15, color: colors.accent, fontWeight: '600' },
  separator:     { color: colors.textMuted, fontSize: 15 },
  era:           { fontSize: 15, color: colors.textSecondary },

  // Mode toggle
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 3,
    gap: 2,
  },
  modeBtn: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  modeBtnActive: {
    backgroundColor: colors.bgElevated,
  },
  modeBtnText:       { fontSize: 11, fontWeight: '500', color: colors.textMuted },
  modeBtnTextActive: { color: colors.textPrimary, fontWeight: '600' },

  // Pending pillars widget
  pendingWidget: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: colors.warning,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  pendingLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.warning,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  pendingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pendingInfo:    { flex: 1 },
  pendingName:    { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  pendingMeta:    { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  pendingActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pendingConfirmBtn: {
    backgroundColor: colors.warning,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
  },
  pendingConfirmText: { color: '#000', fontSize: 12, fontWeight: '700' },
  pendingDismissText: { color: colors.textMuted, fontSize: 12 },

  // Insight
  insightCard: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  insightHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  insightLabel:   { fontSize: 10, fontWeight: '700', color: colors.accent, letterSpacing: 0.8 },
  insightDismiss: { color: colors.textMuted, fontSize: 14 },
  insightText:    { fontSize: 14, color: colors.textSecondary, lineHeight: 21 },

  sectionLabel: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.md,
  },
  radarWrapper: { alignItems: 'center', marginBottom: spacing.xl },
  empty:        { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginBottom: spacing.xl },

  // Pillar list (game)
  pillarList:  { gap: spacing.sm },
  pillarGroup: { gap: 4 },

  pillarCard: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  pillarCardPriority: { borderColor: colors.accent },
  pillarTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  pillarName:  { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  pillarLevel: { fontSize: 13, color: colors.textSecondary },
  xpBarTrack: {
    height: 4, backgroundColor: colors.bgElevated,
    borderRadius: 2, marginBottom: spacing.sm, overflow: 'hidden',
  },
  xpBarFill:    { height: '100%', backgroundColor: colors.accent, borderRadius: 2 },
  pillarBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  xpTotal:  { fontSize: 13, color: colors.textSecondary },
  xpToNext: { fontSize: 12, color: colors.textMuted },
  priorityBadge: {
    fontSize: 11, color: colors.accent,
    backgroundColor: colors.accentSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },

  subPillarList: {
    marginLeft: 10, paddingLeft: spacing.md,
    borderLeftWidth: 2, borderLeftColor: colors.border, gap: 4,
  },
  subPillarCard: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, padding: spacing.sm + 4, opacity: 0.85,
  },
  subPillarName: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  subXpBarTrack: {
    height: 3, backgroundColor: colors.bg,
    borderRadius: 2, marginBottom: spacing.sm, overflow: 'hidden',
  },

  // Analytical view
  statsTable: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  statsHeader: {
    flexDirection: 'row',
    backgroundColor: colors.bgSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statsCell:       { },
  statsCellPillar: { flex: 1 },
  statsCellNum:    { width: 72, textAlign: 'right' },
  statsHeaderText: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  statsPillarName: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  statsValue:      { fontSize: 13, color: colors.textSecondary },

  // Minimal view
  minimalPillarList: { gap: 0, marginBottom: spacing.sm },
  minimalPillarRow:  {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  minimalPillarName:  { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
  minimalPillarLevel: { fontSize: 13, color: colors.textMuted },

  minimalActivityList: { gap: 0 },
  minimalActivityRow:  {
    flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  minimalDate:      { fontSize: 12, color: colors.textMuted, minWidth: 44, flexShrink: 0 },
  minimalPillarChip:{ fontSize: 12, fontWeight: '700', color: colors.accent, flexShrink: 0 },
  minimalNote:      { fontSize: 14, color: colors.textSecondary, flex: 1 },
});
