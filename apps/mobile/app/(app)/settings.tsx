import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors, spacing, radius } from '@/constants/theme';

type Profile = { name: string; onboarding_completed_at: string | null };

export default function SettingsScreen() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);

  // Change password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
      if (!user) return;
      setEmail(user.email ?? '');

      const { data } = await supabase
        .from('profiles')
        .select('name, onboarding_completed_at')
        .eq('id', user.id)
        .single();

      setProfile(data ?? null);
      setLoading(false);
    })();
  }, []);

  async function handleChangePassword() {
    if (!newPassword || newPassword.length < 6) {
      setPwError('A nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    setPwLoading(true);
    setPwError('');
    setPwSuccess(false);

    // Re-autentica com a senha atual antes de atualizar
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });

    if (signInError) {
      setPwError('Senha atual incorreta.');
      setPwLoading(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwLoading(false);

    if (error) {
      setPwError(error.message);
    } else {
      setPwSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
    }
  }

  async function handleLogout() {
    Alert.alert('Sair', 'Tem certeza que quer sair?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, { paddingTop: top + spacing.md }]}>
      <Text style={styles.title}>Configurações</Text>

      {/* Conta */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Conta</Text>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Nome</Text>
          <Text style={styles.rowValue}>{profile?.name ?? '—'}</Text>
        </View>

        <View style={[styles.row, styles.rowLast]}>
          <Text style={styles.rowLabel}>E-mail</Text>
          <Text style={styles.rowValue} numberOfLines={1}>{email}</Text>
        </View>
      </View>

      {/* Alterar senha */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Alterar senha</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Senha atual</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            value={currentPassword}
            onChangeText={(v) => { setCurrentPassword(v); setPwError(''); setPwSuccess(false); }}
            secureTextEntry
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Nova senha</Text>
          <TextInput
            style={styles.input}
            placeholder="Mínimo 6 caracteres"
            placeholderTextColor={colors.textMuted}
            value={newPassword}
            onChangeText={(v) => { setNewPassword(v); setPwError(''); setPwSuccess(false); }}
            secureTextEntry
          />
        </View>

        {pwError ? <Text style={styles.error}>{pwError}</Text> : null}
        {pwSuccess ? <Text style={styles.success}>Senha alterada com sucesso!</Text> : null}

        <TouchableOpacity
          style={[styles.button, pwLoading && styles.buttonDisabled]}
          onPress={handleChangePassword}
          disabled={pwLoading || !currentPassword || !newPassword}
          activeOpacity={0.8}
        >
          {pwLoading
            ? <ActivityIndicator color="#ffffff" />
            : <Text style={styles.buttonText}>Alterar senha</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <Text style={styles.logoutText}>Sair da conta</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: { fontSize: 26, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xl },
  section: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 14, color: colors.textSecondary },
  rowValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '500', maxWidth: '60%' },
  field: { padding: spacing.md, paddingBottom: 0 },
  label: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    color: colors.textPrimary,
    fontSize: 14,
  },
  error: { color: colors.danger, fontSize: 13, paddingHorizontal: spacing.md, marginTop: spacing.xs },
  success: { color: colors.success, fontSize: 13, paddingHorizontal: spacing.md, marginTop: spacing.xs },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    margin: spacing.md,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  logoutBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  logoutText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
});
