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
type Pillar = { id: string; name: string; is_active: boolean; xp_total: number };

export default function SettingsScreen() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');

  // Pilares
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [editedNames, setEditedNames] = useState<Record<string, string>>({});
  const [savingPillar, setSavingPillar] = useState<Record<string, boolean>>({});
  const [newPillarName, setNewPillarName] = useState('');
  const [creating, setCreating] = useState(false);

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
      setUserId(user.id);

      const [profileRes, pillarsRes] = await Promise.all([
        supabase.from('profiles').select('name, onboarding_completed_at').eq('id', user.id).single(),
        supabase.from('user_pillars').select('id, name, is_active, xp_total').eq('user_id', user.id).order('sort_order'),
      ]);

      setProfile(profileRes.data ?? null);
      setPillars(pillarsRes.data ?? []);
      setLoading(false);
    })();
  }, []);

  async function savePillarName(pillar: Pillar) {
    const name = (editedNames[pillar.id] ?? pillar.name).trim();
    if (!name || name === pillar.name) {
      setEditedNames((prev) => { const next = { ...prev }; delete next[pillar.id]; return next; });
      return;
    }
    setSavingPillar((s) => ({ ...s, [pillar.id]: true }));
    const { error } = await supabase
      .from('user_pillars')
      .update({ name })
      .eq('id', pillar.id);
    setSavingPillar((s) => ({ ...s, [pillar.id]: false }));
    if (error) {
      Alert.alert('Erro', 'Não foi possível salvar o nome.');
    } else {
      setPillars((prev) => prev.map((p) => p.id === pillar.id ? { ...p, name } : p));
      setEditedNames((prev) => { const next = { ...prev }; delete next[pillar.id]; return next; });
    }
  }

  async function createPillar() {
    const name = newPillarName.trim();
    if (!name || creating || !userId) return;
    setCreating(true);
    const { data, error } = await supabase
      .from('user_pillars')
      .insert({ user_id: userId, name, xp_rate: 1.0, is_active: true, sort_order: pillars.length })
      .select('id, name, is_active, xp_total')
      .single();
    setCreating(false);
    if (error || !data) {
      Alert.alert('Erro', 'Não foi possível criar o pilar.');
    } else {
      setPillars((prev) => [...prev, data as Pillar]);
      setNewPillarName('');
    }
  }

  async function deletePillar(pillar: Pillar) {
    Alert.alert(
      'Apagar pilar',
      `Apagar "${pillar.name}"? Isso é permanente.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: async () => {
            setSavingPillar((s) => ({ ...s, [pillar.id]: true }));
            const { error } = await supabase.from('user_pillars').delete().eq('id', pillar.id);
            setSavingPillar((s) => ({ ...s, [pillar.id]: false }));
            if (error) {
              Alert.alert('Erro', 'Não foi possível apagar o pilar.');
            } else {
              setPillars((prev) => prev.filter((p) => p.id !== pillar.id));
            }
          },
        },
      ],
    );
  }

  async function togglePillarActive(pillar: Pillar) {
    setSavingPillar((s) => ({ ...s, [pillar.id]: true }));
    const is_active = !pillar.is_active;
    const { error } = await supabase
      .from('user_pillars')
      .update({ is_active })
      .eq('id', pillar.id);
    setSavingPillar((s) => ({ ...s, [pillar.id]: false }));
    if (!error) {
      setPillars((prev) => prev.map((p) => p.id === pillar.id ? { ...p, is_active } : p));
    }
  }

  async function handleChangePassword() {
    if (!newPassword || newPassword.length < 6) {
      setPwError('A nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    setPwLoading(true);
    setPwError('');
    setPwSuccess(false);

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

  const sortedPillars = [...pillars].sort((a, b) => {
    if (a.is_active === b.is_active) return 0;
    return a.is_active ? -1 : 1;
  });

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

      {/* Pilares */}
      {sortedPillars.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pilares</Text>
          {sortedPillars.map((p, i) => {
            const edited = editedNames[p.id];
            const currentName = edited ?? p.name;
            const isDirty = edited !== undefined && edited.trim() !== p.name;
            const isSaving = !!savingPillar[p.id];
            const isLast = i === sortedPillars.length - 1;
            return (
              <View key={p.id} style={[styles.pillarRow, isLast && styles.pillarRowLast, !p.is_active && styles.pillarRowInactive]}>
                <TextInput
                  style={styles.pillarInput}
                  value={currentName}
                  onChangeText={(v) => setEditedNames((n) => ({ ...n, [p.id]: v }))}
                  onBlur={() => savePillarName(p)}
                  onSubmitEditing={() => savePillarName(p)}
                  returnKeyType="done"
                  editable={!isSaving}
                  placeholderTextColor={colors.textMuted}
                />
                {isDirty && !isSaving && (
                  <TouchableOpacity style={styles.saveBtn} onPress={() => savePillarName(p)} activeOpacity={0.8}>
                    <Text style={styles.saveBtnText}>Salvar</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.toggleBtn, p.is_active ? styles.toggleBtnOn : styles.toggleBtnOff]}
                  onPress={() => togglePillarActive(p)}
                  disabled={isSaving}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.toggleBtnText, p.is_active ? styles.toggleBtnTextOn : styles.toggleBtnTextOff]}>
                    {p.is_active ? 'ativo' : 'inativo'}
                  </Text>
                </TouchableOpacity>
                {p.xp_total === 0 && (
                  <TouchableOpacity
                    onPress={() => deletePillar(p)}
                    disabled={isSaving}
                    hitSlop={8}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.deleteBtn}>×</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
          {/* Adicionar novo pilar */}
          <View style={styles.pillarAddRow}>
            <TextInput
              style={styles.pillarAddInput}
              placeholder="Novo pilar…"
              placeholderTextColor={colors.textMuted}
              value={newPillarName}
              onChangeText={setNewPillarName}
              onSubmitEditing={createPillar}
              returnKeyType="done"
              editable={!creating}
              maxLength={40}
            />
            <TouchableOpacity
              style={[styles.pillarAddBtn, (!newPillarName.trim() || creating) && styles.buttonDisabled]}
              onPress={createPillar}
              disabled={!newPillarName.trim() || creating}
              activeOpacity={0.8}
            >
              <Text style={styles.pillarAddBtnText}>{creating ? '…' : '+'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {sortedPillars.length === 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pilares</Text>
          <View style={styles.pillarAddRow}>
            <TextInput
              style={styles.pillarAddInput}
              placeholder="Novo pilar…"
              placeholderTextColor={colors.textMuted}
              value={newPillarName}
              onChangeText={setNewPillarName}
              onSubmitEditing={createPillar}
              returnKeyType="done"
              editable={!creating}
              maxLength={40}
            />
            <TouchableOpacity
              style={[styles.pillarAddBtn, (!newPillarName.trim() || creating) && styles.buttonDisabled]}
              onPress={createPillar}
              disabled={!newPillarName.trim() || creating}
              activeOpacity={0.8}
            >
              <Text style={styles.pillarAddBtnText}>{creating ? '…' : '+'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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

  // Pillar rows
  pillarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  pillarRowLast: { borderBottomWidth: 0 },
  pillarRowInactive: { opacity: 0.45 },
  pillarInput: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    color: colors.textPrimary,
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  saveBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  toggleBtn: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    flexShrink: 0,
  },
  toggleBtnOn: {
    backgroundColor: 'rgba(124, 92, 252, 0.12)',
    borderColor: 'transparent',
  },
  toggleBtnOff: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  toggleBtnText: { fontSize: 12, fontWeight: '600' },
  toggleBtnTextOn: { color: colors.accent },
  toggleBtnTextOff: { color: colors.textMuted },
  deleteBtn: { fontSize: 18, color: colors.textMuted, paddingHorizontal: 2 },
  pillarAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  pillarAddInput: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    color: colors.textPrimary,
    fontSize: 14,
  },
  pillarAddBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillarAddBtnText: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 22 },

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
