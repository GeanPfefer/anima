import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useOnboarding } from '@/contexts/onboarding-context';
import {
  ARCHETYPE_QUESTIONS,
  ARCHETYPES,
  calculateArchetype,
  getDominantArchetype,
} from '@/lib/archetypes';
import type { ArchetypeResult } from '@/lib/archetypes';
import { colors, spacing, radius } from '@/constants/theme';

type Phase = 'quiz' | 'result';

export default function Step2Screen() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { setArchetype } = useOnboarding();

  const [phase, setPhase]     = useState<Phase>('quiz');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult]   = useState<ArchetypeResult | null>(null);

  const answeredCount = Object.keys(answers).length;
  const canSubmit     = answeredCount === ARCHETYPE_QUESTIONS.length;

  function selectOption(questionId: string, label: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: label }));
  }

  function handleSubmit() {
    const calc = calculateArchetype(answers);
    setResult(calc);
    setPhase('result');
  }

  function handleContinue() {
    if (!result) return;
    setArchetype(answers, result);
    router.push('/(onboarding)/step-3');
  }

  function ProgressHeader({ label }: { label: string }) {
    return (
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backBtn}>←</Text>
        </TouchableOpacity>
        <View style={styles.progress}>
          {[1, 2, 3, 4, 5].map((n) => (
            <View key={n} style={[styles.dot, n === 2 && styles.dotActive]} />
          ))}
        </View>
        <Text style={styles.stepLabel}>{label}</Text>
      </View>
    );
  }

  if (phase === 'result' && result) {
    const dominant  = getDominantArchetype(result);
    const archetype = ARCHETYPES[dominant];
    const sorted    = (Object.entries(result) as [keyof ArchetypeResult, number][])
      .sort((a, b) => b[1] - a[1]);

    return (
      <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, { paddingTop: top + spacing.md }]}>
        <ProgressHeader label="Etapa 2 de 5" />

        <Text style={styles.title}>Seu perfil</Text>
        <Text style={styles.subtitle}>Combinação única baseada nas suas respostas</Text>

        <View style={styles.resultCard}>
          <Text style={styles.emoji}>{archetype.emoji}</Text>
          <Text style={styles.archetypeName}>{archetype.name}</Text>
          <Text style={styles.archetypeDesc}>{archetype.description}</Text>
        </View>

        <View style={styles.barsContainer}>
          {sorted.map(([id, pct]) => (
            <View key={id} style={styles.barRow}>
              <Text style={styles.barLabel}>
                {ARCHETYPES[id].emoji} {ARCHETYPES[id].name}
              </Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${pct}%` as `${number}%` }]} />
              </View>
              <Text style={styles.barPct}>{pct}%</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.button} onPress={handleContinue} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Continuar →</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, { paddingTop: top + spacing.md }]}>
      <ProgressHeader label={`Etapa 2 de 5 · ${answeredCount}/${ARCHETYPE_QUESTIONS.length} respondidas`} />

      <Text style={styles.title}>Como você funciona?</Text>
      <Text style={styles.subtitle}>Selecione a opção que mais te representa em cada pergunta.</Text>

      <View style={styles.questions}>
        {ARCHETYPE_QUESTIONS.map((q) => (
          <View key={q.id} style={styles.question}>
            <Text style={styles.questionText}>{q.text}</Text>
            <View style={styles.options}>
              {q.options.map((opt) => (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.chip, answers[q.id] === opt.label && styles.chipSelected]}
                  onPress={() => selectOption(q.id, opt.label)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, answers[q.id] === opt.label && styles.chipTextSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.button, !canSubmit && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonText}>Ver meu perfil →</Text>
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
  stepLabel: { color: colors.textMuted, fontSize: 12, flex: 1 },

  title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.xl, lineHeight: 20 },

  questions: { gap: spacing.xl },
  question: { gap: spacing.sm },
  questionText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, lineHeight: 22 },
  options: { gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.bgSurface,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  chipText: { color: colors.textSecondary, fontSize: 14 },
  chipTextSelected: { color: colors.accent, fontWeight: '600' },

  /* resultado */
  resultCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  emoji: { fontSize: 40 },
  archetypeName: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  archetypeDesc: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  barsContainer: { gap: spacing.md, marginBottom: spacing.xl },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barLabel: { fontSize: 13, color: colors.textSecondary, width: 130 },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.bgElevated,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  barPct: { fontSize: 12, color: colors.textMuted, width: 36, textAlign: 'right' },

  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
