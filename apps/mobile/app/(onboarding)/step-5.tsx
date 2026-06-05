import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { buildActivePillars } from '@anima/core';
import type { PillarConfig } from '@anima/types';
import { supabase } from '@/lib/supabase';
import { useOnboarding } from '@/contexts/onboarding-context';
import { ARCHETYPES, getDominantArchetype } from '@/lib/archetypes';
import { colors, spacing, radius } from '@/constants/theme';

const WELCOME_PHRASES: Record<string, (name: string) => string> = {
  explorer:  (n) => `${n}, sua jornada vai ser ampla e cheia de descobertas. O Anima vai te acompanhar sem te prender — explore à vontade.`,
  focused:   (n) => `${n}, você sabe onde quer chegar. O Anima vai te ajudar a ir fundo e concluir o que importa.`,
  builder:   (n) => `${n}, consistência é sua força. O Anima vai registrar cada passo e mostrar o quanto você constrói com o tempo.`,
  visionary: (n) => `${n}, você pensa grande. O Anima vai conectar suas ações diárias com a visão de futuro que você carrega.`,
};

export default function Step5Screen() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { state, allPillarOptions } = useOnboarding();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const activePillars  = buildActivePillars(state.selectedPillarIds, state.customPillars as PillarConfig[]);
  const dominant       = state.archetypeResult ? getDominantArchetype(state.archetypeResult) : null;
  const archetype      = dominant ? ARCHETYPES[dominant] : null;
  const welcomePhrase  = dominant ? WELCOME_PHRASES[dominant]?.(state.name || 'Jogador') : null;

  async function handleStart() {
    setLoading(true);
    setError(null);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Usuário não autenticado.');

      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          name: state.name.trim(),
          onboarding_completed_at: new Date().toISOString(),
          archetype: state.archetypeResult ?? null,
        })
        .eq('id', user.id);
      if (profileError) throw profileError;

      const pillarRows = activePillars.map((pillar, index) => ({
        user_id:    user.id,
        catalog_id: pillar.isDefault ? pillar.id : null,
        name:       pillar.name,
        xp_rate:    pillar.xpRate,
        sort_order: index,
        context:    state.pillarContexts[pillar.id] ?? null,
      }));

      const { data: insertedPillars, error: pillarsError } = await supabase
        .from('user_pillars')
        .insert(pillarRows)
        .select('id, catalog_id, name');
      if (pillarsError) throw pillarsError;

      // Salva relações pai → filho para sub-pilares
      const relationships: { parent_id: string; child_id: string }[] = [];
      for (const custom of state.customPillars) {
        if (!custom.parentIds?.length) continue;
        const child = insertedPillars?.find((p) => p.name === custom.name);
        if (!child) continue;
        for (const parentLocalId of custom.parentIds) {
          const parent = insertedPillars?.find(
            (p) =>
              p.catalog_id === parentLocalId ||
              p.name === allPillarOptions.find((o) => o.id === parentLocalId)?.name
          );
          if (parent) relationships.push({ parent_id: parent.id, child_id: child.id });
        }
      }

      if (relationships.length > 0) {
        const { error: relError } = await supabase.from('pillar_relationships').insert(relationships);
        if (relError) throw relError;
      }

      // Tudo salvo — navega direto para home
      router.replace('/(app)/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo deu errado. Tente novamente.');
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, { paddingTop: top + spacing.md }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backBtn}>←</Text>
        </TouchableOpacity>
        <View style={styles.progress}>
          {[1, 2, 3, 4, 5].map((n) => (
            <View key={n} style={[styles.dot, n === 5 && styles.dotActive]} />
          ))}
        </View>
        <Text style={styles.stepLabel}>Etapa 5 de 5</Text>
      </View>

      <Text style={styles.title}>Pronto, {state.name || 'Jogador'}!</Text>
      <Text style={styles.subtitle}>Seu perfil está criado. Veja o que montamos para você.</Text>

      {/* Frase de boas-vindas */}
      {welcomePhrase && (
        <View style={styles.welcomeBox}>
          <Text style={styles.welcomePhrase}>{welcomePhrase}</Text>
        </View>
      )}

      {/* Card do personagem */}
      <View style={styles.characterCard}>
        <View style={styles.levelBadge}>
          <Text style={styles.levelNumber}>1</Text>
          <Text style={styles.levelLabel}>Nível</Text>
        </View>
        <View style={styles.characterInfo}>
          <Text style={styles.characterName}>{state.name || 'Jogador'}</Text>
          <Text style={styles.era}>Era: Despertar</Text>
        </View>
        {archetype && (
          <View style={styles.archetypeBadge}>
            <Text style={styles.archetypeEmoji}>{archetype.emoji}</Text>
            <Text style={styles.archetypeLabel}>{archetype.name}</Text>
          </View>
        )}
      </View>

      {/* Barras de arquétipo */}
      {archetype && state.archetypeResult && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Seu perfil</Text>
          <View style={styles.barsContainer}>
            {(Object.entries(state.archetypeResult) as [string, number][])
              .sort((a, b) => b[1] - a[1])
              .map(([id, pct]) => (
                <View key={id} style={styles.barRow}>
                  <Text style={styles.barLabel}>
                    {ARCHETYPES[id as keyof typeof ARCHETYPES]?.emoji}{' '}
                    {ARCHETYPES[id as keyof typeof ARCHETYPES]?.name}
                  </Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${pct}%` as `${number}%` }]} />
                  </View>
                  <Text style={styles.barPct}>{pct}%</Text>
                </View>
              ))}
          </View>
        </View>
      )}

      {/* Pilares com tags de contexto */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pilares ativos</Text>
        <View style={styles.pillarGrid}>
          {activePillars.map((pillar) => {
            const ctx = state.pillarContexts[pillar.id];
            const tags = ctx
              ? Object.values(ctx)
                  .flatMap((v) => (Array.isArray(v) ? v : [v]))
                  .filter(Boolean)
              : [];
            return (
              <View key={pillar.id} style={styles.pillarItem}>
                <Text style={styles.pillarName}>{pillar.name}</Text>
                {tags.length > 0 && (
                  <View style={styles.pillarTags}>
                    {tags.slice(0, 3).map((tag) => (
                      <View key={tag} style={styles.pillarTag}>
                        <Text style={styles.pillarTagText}>{tag}</Text>
                      </View>
                    ))}
                    {tags.length > 3 && (
                      <View style={styles.pillarTag}>
                        <Text style={styles.pillarTagText}>+{tags.length - 3}</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleStart}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading
          ? <ActivityIndicator color="#ffffff" />
          : <Text style={styles.buttonText}>Começar a jornada →</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl },
  backBtn: { fontSize: 20, color: colors.textSecondary, paddingRight: spacing.xs },
  progress: { flexDirection: 'row', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent, width: 24 },
  stepLabel: { color: colors.textMuted, fontSize: 13 },

  title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },

  welcomeBox: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    marginBottom: spacing.lg,
  },
  welcomePhrase: { fontSize: 14, color: colors.textSecondary, lineHeight: 22, fontStyle: 'italic' },

  characterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xl,
  },
  levelBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentSubtle,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelNumber: { fontSize: 22, fontWeight: '700', color: colors.accent },
  levelLabel: { fontSize: 9, color: colors.accentHover, fontWeight: '500' },
  characterInfo: { flex: 1 },
  characterName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  era: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  archetypeBadge: { alignItems: 'center', gap: 2 },
  archetypeEmoji: { fontSize: 24 },
  archetypeLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '500' },

  section: { marginBottom: spacing.xl },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.md,
  },

  barsContainer: { gap: spacing.sm },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barLabel: { fontSize: 13, color: colors.textSecondary, width: 130 },
  barTrack: {
    flex: 1,
    height: 5,
    backgroundColor: colors.bgElevated,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  barPct: { fontSize: 12, color: colors.textMuted, width: 36, textAlign: 'right' },

  pillarGrid: { gap: spacing.sm },
  pillarItem: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  pillarName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  pillarTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pillarTag: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  pillarTagText: { fontSize: 11, color: colors.textMuted },

  error: { color: colors.danger, fontSize: 13, textAlign: 'center', marginBottom: spacing.md },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});
