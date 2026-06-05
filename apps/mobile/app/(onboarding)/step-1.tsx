import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { validateStep1 } from '@anima/core';
import { useOnboarding } from '@/contexts/onboarding-context';
import { colors, spacing, radius } from '@/constants/theme';

export default function Step1Screen() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const { state, setName } = useOnboarding();
  const [error, setError] = useState<string | null>(null);

  function handleContinue() {
    const err = validateStep1(state.name);
    if (err) { setError(err); return; }
    router.push('/(onboarding)/step-2');
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: top + spacing.md }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.progress}>
            {[1, 2, 3, 4, 5].map((n) => (
              <View
                key={n}
                style={[styles.dot, n === 1 && styles.dotActive]}
              />
            ))}
          </View>
          <Text style={styles.stepLabel}>Etapa 1 de 5</Text>
        </View>

        <Text style={styles.title}>Como você quer ser chamado?</Text>
        <Text style={styles.subtitle}>
          Esse é o nome do seu personagem. Pode ser seu nome real ou um apelido.
        </Text>

        <TextInput
          style={[styles.input, !!error && styles.inputError]}
          placeholder="Seu nome"
          placeholderTextColor={colors.textMuted}
          value={state.name}
          onChangeText={(v) => { setName(v); setError(null); }}
          maxLength={50}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleContinue}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, !state.name.trim() && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={!state.name.trim()}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Continuar →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  progress: { flexDirection: 'row', gap: spacing.xs },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: { backgroundColor: colors.accent, width: 24 },
  stepLabel: { color: colors.textMuted, fontSize: 13 },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  input: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 18,
    marginBottom: spacing.sm,
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.md },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
