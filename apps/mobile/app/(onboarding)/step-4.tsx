import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { buildActivePillars } from '@anima/core';
import type { PillarConfig } from '@anima/types';
import { useOnboarding } from '@/contexts/onboarding-context';
import { getQuestionsForPillar } from '@/lib/pillar-questions';
import type { PillarAnswers } from '@/contexts/onboarding-context';
import { colors, spacing, radius } from '@/constants/theme';

export default function Step4Screen() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { state, setPillarContext } = useOnboarding();

  const allPillars    = buildActivePillars(state.selectedPillarIds, state.customPillars as PillarConfig[]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers]           = useState<PillarAnswers>({});
  // Deve ficar antes de qualquer uso de customInputs
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

  const currentPillar = allPillars[currentIndex];
  const questions     = currentPillar ? getQuestionsForPillar(currentPillar.id) : [];
  const isLast        = currentIndex === allPillars.length - 1;

  const answeredCount = questions.filter((q) => {
    const chips: string[] = (answers[q.id] as string[]) ?? [];
    const typingNow = (customInputs[q.id] ?? '').trim();
    return chips.length > 0 || typingNow !== '';
  }).length;
  const canAdvance = answeredCount > 0;

  function toggleChip(questionId: string, option: string) {
    setAnswers((prev) => {
      const current: string[] = (prev[questionId] as string[]) ?? [];
      const next = current.includes(option)
        ? current.filter((v) => v !== option)
        : [...current, option];
      return { ...prev, [questionId]: next };
    });
  }

  function confirmCustom(questionId: string) {
    const value = (customInputs[questionId] ?? '').trim();
    if (!value) return;
    // Adiciona como chip selecionado
    setAnswers((prev) => {
      const existing: string[] = (prev[questionId] as string[]) ?? [];
      if (existing.includes(value)) return prev;
      return { ...prev, [questionId]: [...existing, value] };
    });
    // Limpa o input para permitir digitar mais
    setCustomInputs((prev) => ({ ...prev, [questionId]: '' }));
  }

  function removeChip(questionId: string, value: string) {
    setAnswers((prev) => {
      const existing: string[] = (prev[questionId] as string[]) ?? [];
      return { ...prev, [questionId]: existing.filter((v) => v !== value) };
    });
  }

  function handleNext() {
    // Confirma qualquer texto digitado nos inputs antes de avançar
    const finalAnswers = { ...answers };
    for (const q of questions) {
      const typing = (customInputs[q.id] ?? '').trim();
      if (typing) {
        const existing: string[] = (finalAnswers[q.id] as string[]) ?? [];
        if (!existing.includes(typing)) {
          finalAnswers[q.id] = [...existing, typing];
        }
      }
    }
    if (currentPillar) setPillarContext(currentPillar.id, finalAnswers);
    if (isLast) {
      router.push('/(onboarding)/step-5');
    } else {
      setCurrentIndex((i) => i + 1);
      setAnswers({});
      setCustomInputs({});
    }
  }

  function handleSkip() {
    if (isLast) {
      router.push('/(onboarding)/step-5');
    } else {
      setCurrentIndex((i) => i + 1);
      setAnswers({});
    }
  }

  if (!currentPillar) {
    router.push('/(onboarding)/step-5');
    return null;
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
            <View key={n} style={[styles.dot, n === 4 && styles.dotActive]} />
          ))}
        </View>
        <Text style={styles.stepLabel}>Etapa 4 de 5</Text>
      </View>

      {/* Indicador de pilar atual */}
      <View style={styles.pillarProgress}>
        {allPillars.map((p, i) => (
          <View
            key={p.id}
            style={[
              styles.pillarDot,
              i < currentIndex && styles.pillarDotDone,
              i === currentIndex && styles.pillarDotCurrent,
            ]}
          />
        ))}
      </View>

      <Text style={styles.title}>{currentPillar.name}</Text>
      <Text style={styles.subtitle}>
        Pilar {currentIndex + 1} de {allPillars.length} · suas respostas ajudam o app a te orientar melhor
      </Text>

      {/* Perguntas com chips */}
      <View style={styles.questions}>
        {questions.map((q) => {
          const selected: string[] = (answers[q.id] as string[]) ?? [];
          // Opções fixas do chip + opções customizadas já confirmadas
          const fixedOptions = new Set(q.options);
          const customChips = selected.filter((v) => !fixedOptions.has(v));

          return (
            <View key={q.id} style={styles.question}>
              <Text style={styles.questionText}>{q.text}</Text>
              <View style={styles.chips}>
                {/* Chips fixos */}
                {q.options.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.chip, selected.includes(opt) && styles.chipSelected]}
                    onPress={() => toggleChip(q.id, opt)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, selected.includes(opt) && styles.chipTextSelected]}>
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
                {/* Chips customizados confirmados */}
                {customChips.map((val) => (
                  <TouchableOpacity
                    key={`custom_${val}`}
                    style={[styles.chip, styles.chipSelected]}
                    onPress={() => removeChip(q.id, val)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, styles.chipTextSelected]}>{val} ×</Text>
                  </TouchableOpacity>
                ))}
                {/* Input "Outro" — confirma no Enter e abre novo campo */}
                <View style={styles.otherRow}>
                  <TextInput
                    style={styles.otherInput}
                    placeholder="Outro... (Enter para adicionar)"
                    placeholderTextColor={colors.textMuted}
                    value={customInputs[q.id] ?? ''}
                    onChangeText={(v) => setCustomInputs((prev) => ({ ...prev, [q.id]: v }))}
                    returnKeyType="done"
                    onSubmitEditing={() => confirmCustom(q.id)}
                    blurOnSubmit={false}
                  />
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={handleSkip} hitSlop={8}>
          <Text style={styles.skipBtn}>Pular</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, !canAdvance && styles.buttonDisabled]}
          onPress={handleNext}
          disabled={!canAdvance}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonText}>
            {isLast ? 'Ver resumo →' : 'Próximo pilar →'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  backBtn: { fontSize: 20, color: colors.textSecondary, paddingRight: spacing.xs },
  progress: { flexDirection: 'row', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.accent, width: 24 },
  stepLabel: { color: colors.textMuted, fontSize: 13 },

  pillarProgress: { flexDirection: 'row', gap: 6, marginBottom: spacing.xl },
  pillarDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  pillarDotDone: { backgroundColor: colors.accent, opacity: 0.4 },
  pillarDotCurrent: { backgroundColor: colors.accent, width: 24 },

  title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.xl, lineHeight: 18 },

  questions: { gap: spacing.xl },
  question: { gap: spacing.sm },
  questionText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.bgSurface,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  chipText: { color: colors.textSecondary, fontSize: 13 },
  chipTextSelected: { color: colors.accent, fontWeight: '600' },
  otherRow: { width: '100%', marginTop: spacing.xs },
  otherInput: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    color: colors.textPrimary,
    fontSize: 13,
  },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xxl },
  skipBtn: { color: colors.textMuted, fontSize: 15 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
});
