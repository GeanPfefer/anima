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
import { validateStep2 } from '@anima/core';
import { DEFAULT_PILLARS, MIN_ACTIVE_PILLARS } from '@anima/types';
import type { PillarId, PillarConfig } from '@anima/types';
import { useOnboarding } from '@/contexts/onboarding-context';
import { colors, spacing, radius } from '@/constants/theme';

export default function Step3Screen() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { state, setPillars, allPillarOptions } = useOnboarding();
  const [error, setError]             = useState<string | null>(null);
  const [newPillarName, setNewPillarName] = useState('');
  const [selectedParents, setSelectedParents] = useState<string[]>([]);
  const [showParentPicker, setShowParentPicker] = useState(false);

  const totalActive = state.selectedPillarIds.length + state.customPillars.length;

  function toggleDefault(id: PillarId) {
    const isSelected = state.selectedPillarIds.includes(id);
    const newIds = isSelected
      ? state.selectedPillarIds.filter((p) => p !== id)
      : [...state.selectedPillarIds, id];
    setError(null);
    setPillars(newIds, state.customPillars);
  }

  function toggleParent(id: string) {
    setSelectedParents((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  function addCustomPillar() {
    const name = newPillarName.trim();
    if (!name || name.length < 2) return;
    const id = `custom_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
    const pillar = {
      id,
      name,
      xpRate: 1.0,
      parentIds: selectedParents.length > 0 ? [...selectedParents] : undefined,
    };
    setPillars(state.selectedPillarIds, [...state.customPillars, pillar]);
    setNewPillarName('');
    setSelectedParents([]);
    setShowParentPicker(false);
  }

  function removeCustom(id: PillarId) {
    setPillars(
      state.selectedPillarIds,
      state.customPillars.filter((p) => p.id !== id),
    );
  }

  function handleContinue() {
    const err = validateStep2(state.selectedPillarIds, state.customPillars as PillarConfig[]);
    if (err) { setError(err); return; }
    router.push('/(onboarding)/step-4');
  }

  const canAddPillar = newPillarName.trim().length >= 2;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, { paddingTop: top + spacing.md }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backBtn}>←</Text>
        </TouchableOpacity>
        <View style={styles.progress}>
          {[1, 2, 3, 4, 5].map((n) => (
            <View key={n} style={[styles.dot, n === 3 && styles.dotActive]} />
          ))}
        </View>
        <Text style={styles.stepLabel}>Etapa 3 de 5</Text>
      </View>

      <Text style={styles.title}>Quais pilares você quer acompanhar?</Text>
      <Text style={styles.subtitle}>
        Selecione pelo menos {MIN_ACTIVE_PILLARS}. Você pode ajustar depois.
      </Text>

      {/* Pilares padrão */}
      <View style={styles.grid}>
        {DEFAULT_PILLARS.map((pillar) => {
          const selected = state.selectedPillarIds.includes(pillar.id);
          return (
            <TouchableOpacity
              key={pillar.id}
              style={[styles.pillarCard, selected && styles.pillarCardSelected]}
              onPress={() => toggleDefault(pillar.id)}
              activeOpacity={0.8}
            >
              <Text style={[styles.pillarName, selected && styles.pillarNameSelected]}>
                {pillar.name}
              </Text>
              <Text style={[styles.pillarRate, selected && styles.pillarRateSelected]}>
                {pillar.xpRate}× XP/min
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Pilares customizados */}
      {state.customPillars.length > 0 && (
        <View style={styles.customList}>
          {state.customPillars.map((p) => (
            <View key={p.id} style={styles.customTag}>
              <View style={styles.customTagInfo}>
                <Text style={styles.customTagText}>{p.name}</Text>
                {p.parentIds && p.parentIds.length > 0 && (
                  <Text style={styles.customTagParents}>
                    → {p.parentIds
                      .map((pid) => allPillarOptions.find((o) => o.id === pid)?.name ?? pid)
                      .join(', ')}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => removeCustom(p.id)} hitSlop={8}>
                <Text style={styles.removeBtn}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Adicionar pilar personalizado */}
      <View style={styles.addSection}>
        <View style={styles.addRow}>
          <TextInput
            style={styles.customInput}
            placeholder="Nome do pilar (ex: Skate, Música...)"
            placeholderTextColor={colors.textMuted}
            value={newPillarName}
            onChangeText={setNewPillarName}
            maxLength={30}
            returnKeyType="done"
            onSubmitEditing={() => canAddPillar && addCustomPillar()}
          />
          {canAddPillar && allPillarOptions.length > 0 && (
            <TouchableOpacity
              style={[styles.parentToggle, showParentPicker && styles.parentToggleActive]}
              onPress={() => setShowParentPicker((v) => !v)}
              activeOpacity={0.8}
            >
              <Text style={[styles.parentToggleText, showParentPicker && styles.parentToggleTextActive]}>
                ⬆ Pai
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {showParentPicker && allPillarOptions.length > 0 && (
          <View style={styles.parentPicker}>
            <Text style={styles.parentPickerLabel}>Faz parte de qual(is) pilar(es)?</Text>
            <View style={styles.parentChips}>
              {allPillarOptions.map((opt) => (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.parentChip, selectedParents.includes(opt.id) && styles.parentChipSelected]}
                  onPress={() => toggleParent(opt.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.parentChipText, selectedParents.includes(opt.id) && styles.parentChipTextSelected]}>
                    {opt.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {canAddPillar && (
          <TouchableOpacity style={styles.addBtn} onPress={addCustomPillar} activeOpacity={0.8}>
            <Text style={styles.addBtnText}>
              + Adicionar{selectedParents.length > 0 ? ' como sub-pilar' : ''}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Text style={styles.count}>
          {totalActive} pilar{totalActive !== 1 ? 'es' : ''} selecionado{totalActive !== 1 ? 's' : ''}
        </Text>
        <TouchableOpacity
          style={[styles.button, totalActive < MIN_ACTIVE_PILLARS && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={totalActive < MIN_ACTIVE_PILLARS}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Continuar →</Text>
        </TouchableOpacity>
      </View>
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

  title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 20 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  pillarCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: colors.bgSurface,
    minWidth: '44%',
    flex: 1,
  },
  pillarCardSelected: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  pillarName: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  pillarNameSelected: { color: colors.accent },
  pillarRate: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  pillarRateSelected: { color: colors.accentHover },

  customList: { gap: spacing.sm, marginBottom: spacing.md },
  customTag: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customTagInfo: { flex: 1, gap: 2 },
  customTagText: { color: colors.textPrimary, fontSize: 13, fontWeight: '500' },
  customTagParents: { color: colors.textMuted, fontSize: 11 },
  removeBtn: { color: colors.textMuted, fontSize: 20, paddingLeft: spacing.sm },

  addSection: { gap: spacing.sm, marginBottom: spacing.md },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  customInput: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.textPrimary,
    fontSize: 14,
  },
  parentToggle: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.bgSurface,
  },
  parentToggleActive: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  parentToggleText: { color: colors.textSecondary, fontSize: 13 },
  parentToggleTextActive: { color: colors.accent, fontWeight: '600' },

  parentPicker: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  parentPickerLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  parentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  parentChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.bgElevated,
  },
  parentChipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  parentChipText: { color: colors.textSecondary, fontSize: 13 },
  parentChipTextSelected: { color: colors.accent, fontWeight: '600' },

  addBtn: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  addBtnText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },

  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.md },
  footer: { marginTop: spacing.lg, gap: spacing.sm },
  count: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
