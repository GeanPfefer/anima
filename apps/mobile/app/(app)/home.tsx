import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { getCharacterLevel, getEraForLevel, getTotalXPForLevel, getXPToNextLevel } from '@anima/core';
import LifeRadar from '@/components/LifeRadar';
import LogActivityModal from '@/components/LogActivityModal';
import { logPulso } from '@/lib/pulso';
import { extractEntitiesForRecord } from '@/lib/extract-entities';
import { embedEntryForRecord } from '@/lib/embed-entry';
import { colors, spacing, radius } from '@/constants/theme';

type PillarRow = {
  id: string;
  name: string;
  xp_rate: number;
  xp_total: number;
  level: number;
  is_priority: boolean;
};

type PillarWithChildren = PillarRow & { children: PillarRow[] };

type Profile = { name: string };

function PillarCard({ p, sub = false }: { p: PillarRow; sub?: boolean }) {
  const levelStart = getTotalXPForLevel(p.level);
  const levelEnd = getTotalXPForLevel(p.level + 1);
  const progress =
    levelEnd > levelStart
      ? Math.max(0, Math.min(1, (p.xp_total - levelStart) / (levelEnd - levelStart)))
      : 1;
  const xpToNext = getXPToNextLevel(p.xp_total);

  return (
    <View style={[
      sub ? styles.subPillarCard : styles.pillarCard,
      p.is_priority && !sub ? styles.pillarCardPriority : undefined,
    ]}>
      <View style={styles.pillarTop}>
        <Text style={sub ? styles.subPillarName : styles.pillarName}>{p.name}</Text>
        <Text style={styles.pillarLevel}>Nv. {p.level}</Text>
      </View>
      <View style={sub ? styles.subXpBarTrack : styles.xpBarTrack}>
        <View style={[styles.xpBarFill, { width: `${(progress * 100).toFixed(1)}%` as `${number}%` }]} />
      </View>
      <View style={styles.pillarBottom}>
        <Text style={styles.xpTotal}>
          {p.xp_total.toLocaleString('pt-BR')} XP
        </Text>
        {p.level < 50 && (
          <Text style={styles.xpToNext}>+{xpToNext} para Nv. {p.level + 1}</Text>
        )}
        {p.is_priority && !sub && <Text style={styles.priorityBadge}>foco</Text>}
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const { top } = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rootPillars, setRootPillars] = useState<PillarWithChildren[]>([]);
  const [allPillars, setAllPillars] = useState<PillarRow[]>([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Pulso do dia
  const [pulsoText, setPulsoText]   = useState('');
  const [pulsoSaving, setPulsoSaving] = useState(false);
  const [pulsoSaved, setPulsoSaved]   = useState(''); // nome do pilar onde foi salvo

  // Insight do dia
  const [insight, setInsight]       = useState<{ id: string; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) { setLoading(false); setRefreshing(false); return; }
      setUserId(user.id);

      const profileRes = await supabase
        .from('profiles').select('name').eq('id', user.id).single();

      const pillarsRes = await supabase
        .from('user_pillars')
        .select('id, name, xp_rate, xp_total, level, is_priority')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('sort_order');

      const pillars: PillarRow[] = pillarsRes.data ?? [];
      const roots: PillarWithChildren[] = pillars.map((p) => ({ ...p, children: [] }));

      setProfile(profileRes.data ?? null);
      setAllPillars(pillars);
      setRootPillars(roots);

      // Carrega insight mais recente não dispensado
      const { data: ins } = await supabase
        .from('insights')
        .select('id, text')
        .eq('user_id', user.id)
        .is('dismissed_at', null)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setInsight(ins ?? null);
    } catch (e) {
      // falha silenciosa — mostra tela vazia
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handlePulso() {
    if (!pulsoText.trim() || pulsoSaving || !userId) return;
    setPulsoSaving(true);
    try {
      const { pillarName, recordId } = await logPulso(
        pulsoText,
        userId,
        allPillars.map(p => ({ id: p.id, name: p.name })),
      );
      setPulsoSaved(pillarName);
      setPulsoText('');
      extractEntitiesForRecord(pulsoText, recordId, userId).catch(() => {});
      embedEntryForRecord(pulsoText, recordId, userId).catch(() => {});
      setTimeout(() => { setPulsoSaved(''); load(); }, 2500);
    } catch {
      // falha silenciosa
    } finally {
      setPulsoSaving(false);
    }
  }

  async function handleDismissInsight() {
    if (!insight) return;
    await supabase
      .from('insights')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', insight.id);
    setInsight(null);
  }

  // Radar e nível do personagem usam só pilares raiz
  const characterLevel = getCharacterLevel(rootPillars.map((p) => p.level));
  const era = getEraForLevel(characterLevel);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: top + spacing.md }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.accent}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.name}>{profile?.name ?? ''}</Text>
          <View style={styles.characterMeta}>
            <Text style={styles.level}>Nível {characterLevel}</Text>
            <Text style={styles.separator}>·</Text>
            <Text style={styles.era}>{era.name}</Text>
          </View>
        </View>

        {/* Pulso do dia */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.pulsoBox}>
            {pulsoSaved ? (
              <Text style={styles.pulsoSaved}>✓ Registrado em {pulsoSaved}</Text>
            ) : (
              <>
                <TextInput
                  style={styles.pulsoInput}
                  placeholder="O que está acontecendo?"
                  placeholderTextColor={colors.textMuted}
                  value={pulsoText}
                  onChangeText={setPulsoText}
                  onSubmitEditing={handlePulso}
                  returnKeyType="send"
                  multiline={false}
                  editable={!pulsoSaving}
                />
                {pulsoText.length > 0 && (
                  <TouchableOpacity
                    style={[styles.pulsoBtn, pulsoSaving && styles.pulsoBtnDisabled]}
                    onPress={handlePulso}
                    disabled={pulsoSaving}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.pulsoBtnText}>{pulsoSaving ? '…' : '↵'}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </KeyboardAvoidingView>

        {/* Insight automático */}
        {insight && (
          <View style={styles.insightCard}>
            <View style={styles.insightHeader}>
              <Text style={styles.insightLabel}>INSIGHT</Text>
              <TouchableOpacity onPress={handleDismissInsight} hitSlop={8}>
                <Text style={styles.insightDismiss}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.insightText}>{insight.text}</Text>
          </View>
        )}

        {/* Radar — só pilares raiz */}
        <Text style={styles.sectionLabel}>Radar de vida</Text>
        <View style={styles.radarWrapper}>
          {rootPillars.length >= 3
            ? <LifeRadar pillars={rootPillars} />
            : <Text style={styles.empty}>Nenhum pilar registrado.</Text>
          }
        </View>

        {/* Pilares */}
        <Text style={styles.sectionLabel}>Pilares</Text>
        {rootPillars.length === 0 ? (
          <Text style={styles.empty}>Complete o onboarding para ver seus pilares.</Text>
        ) : (
          <View style={styles.pillarList}>
            {rootPillars.map((p) => (
              <View key={p.id} style={styles.pillarGroup}>
                <PillarCard p={p} />
                {p.children.length > 0 && (
                  <View style={styles.subPillarList}>
                    {p.children.map((child) => (
                      <PillarCard key={child.id} p={child} sub />
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Espaço para o FAB não cobrir o último item */}
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

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  scroll:   { padding: spacing.lg },
  header:   { marginBottom: spacing.lg },

  // Pulso do dia
  pulsoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  pulsoInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingVertical: 4,
  },
  pulsoBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulsoBtnDisabled: { opacity: 0.4 },
  pulsoBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pulsoSaved: { color: colors.textSecondary, fontSize: 14, flex: 1, textAlign: 'center', paddingVertical: 6 },

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
  insightHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  insightLabel: { fontSize: 10, fontWeight: '700', color: colors.accent, letterSpacing: 0.8 },
  insightDismiss: { color: colors.textMuted, fontSize: 14 },
  insightText: { fontSize: 14, color: colors.textSecondary, lineHeight: 21 },

  name: { fontSize: 26, fontWeight: '700', color: colors.textPrimary },
  characterMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4 },
  level: { fontSize: 15, color: colors.accent, fontWeight: '600' },
  separator: { color: colors.textMuted, fontSize: 15 },
  era: { fontSize: 15, color: colors.textSecondary },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.md,
  },
  radarWrapper: { alignItems: 'center', marginBottom: spacing.xl },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginBottom: spacing.xl },

  /* ─── Pillar list ─── */
  pillarList: { gap: spacing.sm },
  pillarGroup: { gap: 4 },

  /* ─── Root pillar card ─── */
  pillarCard: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  pillarCardPriority: { borderColor: colors.accent },
  pillarTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  pillarName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  pillarLevel: { fontSize: 13, color: colors.textSecondary },
  xpBarTrack: {
    height: 4,
    backgroundColor: colors.bgElevated,
    borderRadius: 2,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  xpBarFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 2 },
  pillarBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  xpTotal: { fontSize: 13, color: colors.textSecondary },
  xpToNext: { fontSize: 12, color: colors.textMuted },
  priorityBadge: {
    fontSize: 11,
    color: colors.accent,
    backgroundColor: colors.accentSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },

  /* ─── Sub-pillar ─── */
  subPillarList: {
    marginLeft: 10,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    gap: 4,
  },
  subPillarCard: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm + 4,
    opacity: 0.85,
  },
  subPillarName: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  subXpBarTrack: {
    height: 3,
    backgroundColor: colors.bg,
    borderRadius: 2,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
});
