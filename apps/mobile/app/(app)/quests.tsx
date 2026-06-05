import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, TextInput, KeyboardAvoidingView,
  Platform, Alert, RefreshControl,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { colors, spacing, radius } from '@/constants/theme';

// ─── tipos locais ────────────────────────────────────────────

type QuestType   = 'main' | 'habit' | 'learning' | 'challenge';
type QuestStatus = 'open' | 'in_progress' | 'completed' | 'abandoned';

type MissionRow = {
  id: string;
  title: string;
  xp_reward: number;
  sort_order: number;
  completed_at: string | null;
};

type QuestRow = {
  id: string;
  title: string;
  description: string | null;
  type: QuestType;
  status: QuestStatus;
  xp_reward: number;
  pillar_id: string;
  pillar_name: string;
  created_at: string;
  completed_at: string | null;
  missions: MissionRow[];
};

type PillarRow = { id: string; name: string };

// ─── constantes de UI ─────────────────────────────────────────

const TYPE_LABELS: Record<QuestType, string> = {
  main:      'Principal',
  habit:     'Hábito',
  learning:  'Aprendizado',
  challenge: 'Desafio',
};

const TYPE_COLORS: Record<QuestType, string> = {
  main:      '#7c5cfc',
  habit:     '#22c55e',
  learning:  '#3b82f6',
  challenge: '#f97316',
};

// ─── componente principal ─────────────────────────────────────

export default function QuestsScreen() {
  const { top } = useSafeAreaInsets();
  const [quests, setQuests]         = useState<QuestRow[]>([]);
  const [pillars, setPillars]       = useState<PillarRow[]>([]);
  const [userId, setUserId]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  // ── carregar dados ─────────────────────────────────────────
  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;
    setUserId(user.id);

    const [pillarsRes, questsRes] = await Promise.all([
      supabase
        .from('user_pillars')
        .select('id, name')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('sort_order'),
      supabase
        .from('quests')
        .select(`
          id, title, description, type, status, xp_reward, pillar_id, created_at, completed_at,
          user_pillars!quests_pillar_id_fkey (name),
          quest_missions (id, title, xp_reward, sort_order, completed_at)
        `)
        .eq('user_id', user.id)
        .neq('status', 'abandoned')
        .order('created_at', { ascending: false }),
    ]);

    if (pillarsRes.data) setPillars(pillarsRes.data);

    if (questsRes.data) {
      const rows: QuestRow[] = questsRes.data.map((q: any) => ({
        id:           q.id,
        title:        q.title,
        description:  q.description,
        type:         q.type,
        status:       q.status,
        xp_reward:    q.xp_reward,
        pillar_id:    q.pillar_id,
        pillar_name:  q.user_pillars?.name ?? '',
        created_at:   q.created_at,
        completed_at: q.completed_at,
        missions:     (q.quest_missions ?? []).sort(
          (a: MissionRow, b: MissionRow) => a.sort_order - b.sort_order
        ),
      }));
      setQuests(rows);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // ── completar missão ───────────────────────────────────────
  async function completeMission(quest: QuestRow, mission: MissionRow) {
    const now = new Date().toISOString();

    // Marca missão como concluída
    const { error: mErr } = await supabase
      .from('quest_missions')
      .update({ completed_at: now })
      .eq('id', mission.id);
    if (mErr) { Alert.alert('Erro', mErr.message); return; }

    // Garante quest in_progress
    if (quest.status === 'open') {
      await supabase.from('quests')
        .update({ status: 'in_progress' })
        .eq('id', quest.id);
    }

    // Registra life_event para XP do milestone
    await supabase.from('life_events').insert({
      user_id:    userId,
      pillar_id:  quest.pillar_id,
      quest_id:   quest.id,
      mission_id: mission.id,
      event_type: 'quest_milestone',
      description: `Missão concluída: ${mission.title}`,
      xp_awarded: mission.xp_reward,
    });

    await load();
  }

  // ── desfazer missão ────────────────────────────────────────
  async function uncompleteMission(mission: MissionRow) {
    await supabase
      .from('quest_missions')
      .update({ completed_at: null })
      .eq('id', mission.id);
    await load();
  }

  // ── completar quest sem missões ────────────────────────────
  async function completeQuestDirectly(quest: QuestRow) {
    const now = new Date().toISOString();
    await supabase.from('quests')
      .update({ status: 'completed', completed_at: now })
      .eq('id', quest.id);
    await supabase.from('life_events').insert({
      user_id:    userId,
      pillar_id:  quest.pillar_id,
      quest_id:   quest.id,
      event_type: 'quest_milestone',
      description: `Quest concluída: ${quest.title}`,
      xp_awarded: quest.xp_reward,
    });
    await load();
  }

  // ── abandonar quest ────────────────────────────────────────
  function abandonQuest(quest: QuestRow) {
    Alert.alert(
      'Abandonar quest',
      `Tem certeza que quer abandonar "${quest.title}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Abandonar', style: 'destructive',
          onPress: async () => {
            await supabase.from('quests')
              .update({ status: 'abandoned' })
              .eq('id', quest.id);
            await load();
          },
        },
      ]
    );
  }

  // ── separar ativas / concluídas ───────────────────────────
  const active    = quests.filter((q) => q.status !== 'completed');
  const completed = quests.filter((q) => q.status === 'completed');

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* cabeçalho */}
      <View style={[styles.header, { paddingTop: top + spacing.sm }]}>
        <Text style={styles.headerTitle}>Quests</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => setShowCreate(true)} activeOpacity={0.8}>
          <Text style={styles.newBtnText}>+ Nova</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
      >
        {/* ativas */}
        {active.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nenhuma quest ativa</Text>
            <Text style={styles.emptySubtitle}>Crie sua primeira missão para começar a jornada.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.section}>Ativas ({active.length})</Text>
            {active.map((q) => (
              <QuestCard
                key={q.id}
                quest={q}
                expanded={expandedId === q.id}
                onToggle={() => setExpandedId(expandedId === q.id ? null : q.id)}
                onCompleteMission={(m) => completeMission(q, m)}
                onUncompleteMission={uncompleteMission}
                onCompleteQuest={() => completeQuestDirectly(q)}
                onAbandon={() => abandonQuest(q)}
              />
            ))}
          </>
        )}

        {/* concluídas */}
        {completed.length > 0 && (
          <>
            <TouchableOpacity
              style={styles.completedHeader}
              onPress={() => setShowCompleted(!showCompleted)}
              activeOpacity={0.8}
            >
              <Text style={styles.section}>Concluídas ({completed.length})</Text>
              <Text style={styles.chevron}>{showCompleted ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {showCompleted && completed.map((q) => (
              <QuestCard
                key={q.id}
                quest={q}
                expanded={expandedId === q.id}
                onToggle={() => setExpandedId(expandedId === q.id ? null : q.id)}
                onCompleteMission={() => {}}
                onUncompleteMission={() => {}}
                onCompleteQuest={() => {}}
                onAbandon={() => {}}
                readonly
              />
            ))}
          </>
        )}
      </ScrollView>

      {/* modal criar quest */}
      {showCreate && (
        <CreateQuestModal
          pillars={pillars}
          userId={userId}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </View>
  );
}

// ─── QuestCard ────────────────────────────────────────────────

type QuestCardProps = {
  quest: QuestRow;
  expanded: boolean;
  onToggle: () => void;
  onCompleteMission: (m: MissionRow) => void;
  onUncompleteMission: (m: MissionRow) => void;
  onCompleteQuest: () => void;
  onAbandon: () => void;
  readonly?: boolean;
};

function QuestCard({
  quest, expanded, onToggle,
  onCompleteMission, onUncompleteMission, onCompleteQuest, onAbandon,
  readonly = false,
}: QuestCardProps) {
  const total     = quest.missions.length;
  const done      = quest.missions.filter((m) => m.completed_at !== null).length;
  const progress  = total > 0 ? done / total : (quest.status === 'completed' ? 1 : 0);
  const noMissions = total === 0;

  return (
    <View style={[styles.card, quest.status === 'completed' && styles.cardCompleted]}>
      {/* cabeçalho do card */}
      <TouchableOpacity style={styles.cardHeader} onPress={onToggle} activeOpacity={0.8}>
        <View style={styles.cardHeaderTop}>
          <View style={[styles.typeBadge, { backgroundColor: TYPE_COLORS[quest.type] + '22' }]}>
            <Text style={[styles.typeBadgeText, { color: TYPE_COLORS[quest.type] }]}>
              {TYPE_LABELS[quest.type]}
            </Text>
          </View>
          <Text style={styles.xpBadge}>{quest.xp_reward} XP</Text>
        </View>
        <Text style={styles.cardTitle}>{quest.title}</Text>
        <Text style={styles.cardPillar}>{quest.pillar_name}</Text>

        {total > 0 && (
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <Text style={styles.progressLabel}>{done}/{total}</Text>
          </View>
        )}

        <View style={styles.cardFooter}>
          {quest.status === 'completed'
            ? <Text style={styles.completedBadge}>✓ Concluída</Text>
            : <Text style={styles.statusText}>
                {quest.status === 'in_progress' ? 'Em andamento' : 'Aberta'}
              </Text>
          }
          <Text style={styles.expandIcon}>{expanded ? '▲' : '▼'}</Text>
        </View>
      </TouchableOpacity>

      {/* missões expandidas */}
      {expanded && !readonly && (
        <View style={styles.missionsContainer}>
          {quest.description ? (
            <Text style={styles.description}>{quest.description}</Text>
          ) : null}

          {total > 0 ? (
            <>
              {quest.missions.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.missionRow}
                  onPress={() => m.completed_at ? onUncompleteMission(m) : onCompleteMission(m)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.checkbox, m.completed_at && styles.checkboxDone]}>
                    {m.completed_at && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={[styles.missionTitle, m.completed_at && styles.missionDone]}>
                    {m.title}
                  </Text>
                  <Text style={styles.missionXP}>{m.xp_reward} XP</Text>
                </TouchableOpacity>
              ))}
            </>
          ) : quest.status !== 'completed' ? (
            <TouchableOpacity style={styles.completeBtn} onPress={onCompleteQuest} activeOpacity={0.8}>
              <Text style={styles.completeBtnText}>Marcar como concluída</Text>
            </TouchableOpacity>
          ) : null}

          {quest.status !== 'completed' && (
            <TouchableOpacity style={styles.abandonBtn} onPress={onAbandon} activeOpacity={0.8}>
              <Text style={styles.abandonBtnText}>Abandonar quest</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* missões readonly (concluídas) */}
      {expanded && readonly && (
        <View style={styles.missionsContainer}>
          {quest.missions.map((m) => (
            <View key={m.id} style={styles.missionRow}>
              <View style={[styles.checkbox, styles.checkboxDone]}>
                <Text style={styles.checkmark}>✓</Text>
              </View>
              <Text style={[styles.missionTitle, styles.missionDone]}>{m.title}</Text>
              <Text style={styles.missionXP}>{m.xp_reward} XP</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── CreateQuestModal ─────────────────────────────────────────

type NewMission = { title: string; xp_reward: string };

function CreateQuestModal({
  pillars, userId, onClose, onCreated,
}: {
  pillars: PillarRow[];
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle]         = useState('');
  const [type, setType]           = useState<QuestType>('main');
  const [pillarId, setPillarId]   = useState(pillars[0]?.id ?? '');
  const [xpReward, setXpReward]   = useState('200');
  const [description, setDesc]    = useState('');
  const [missions, setMissions]   = useState<NewMission[]>([{ title: '', xp_reward: '50' }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState('');

  function addMission() {
    if (missions.length >= 6) return;
    setMissions([...missions, { title: '', xp_reward: '50' }]);
  }

  function removeMission(i: number) {
    setMissions(missions.filter((_, idx) => idx !== i));
  }

  function updateMission(i: number, field: keyof NewMission, value: string) {
    setMissions(missions.map((m, idx) => idx === i ? { ...m, [field]: value } : m));
  }

  async function handleSubmit() {
    if (!title.trim()) { setError('Título obrigatório'); return; }
    if (!pillarId)     { setError('Selecione um pilar'); return; }
    const xp = parseInt(xpReward, 10);
    if (isNaN(xp) || xp <= 0) { setError('XP deve ser maior que zero'); return; }
    if (xp > 10000) { setError('XP máximo por quest é 10.000'); return; }
    const invalidMission = missions.find((m) => m.title.trim() && parseInt(m.xp_reward, 10) > 10000);
    if (invalidMission) { setError('XP máximo por missão é 10.000'); return; }

    setSubmitting(true);
    setError('');
    try {
      const { data: quest, error: qErr } = await supabase
        .from('quests')
        .insert({
          user_id:     userId,
          pillar_id:   pillarId,
          title:       title.trim(),
          description: description.trim() || null,
          type,
          xp_reward:   xp,
        })
        .select('id')
        .single();
      if (qErr) throw qErr;

      const validMissions = missions.filter((m) => m.title.trim());
      if (validMissions.length > 0) {
        const rows = validMissions.map((m, i) => ({
          quest_id:  quest.id,
          title:     m.title.trim(),
          xp_reward: Math.max(1, parseInt(m.xp_reward, 10) || 50),
          sort_order: i,
        }));
        const { error: mErr } = await supabase.from('quest_missions').insert(rows);
        if (mErr) throw mErr;
      }

      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao criar quest');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={styles.modalOverlay} onPress={onClose} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nova Quest</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {/* título */}
            <Text style={styles.fieldLabel}>Título *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Ex: Completar curso de React Native"
              placeholderTextColor={colors.textMuted}
              value={title}
              onChangeText={setTitle}
            />

            {/* tipo */}
            <Text style={styles.fieldLabel}>Tipo</Text>
            <View style={styles.chipRow}>
              {(['main', 'habit', 'learning', 'challenge'] as QuestType[]).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.chip, type === t && { borderColor: TYPE_COLORS[t], backgroundColor: TYPE_COLORS[t] + '22' }]}
                  onPress={() => setType(t)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, type === t && { color: TYPE_COLORS[t] }]}>
                    {TYPE_LABELS[t]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* pilar */}
            <Text style={styles.fieldLabel}>Pilar</Text>
            <View style={styles.chipRow}>
              {pillars.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.chip, pillarId === p.id && styles.chipActive]}
                  onPress={() => setPillarId(p.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, pillarId === p.id && styles.chipActiveText]}>
                    {p.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* recompensa XP */}
            <Text style={styles.fieldLabel}>Recompensa XP</Text>
            <TextInput
              style={[styles.textInput, { width: 100 }]}
              value={xpReward}
              onChangeText={setXpReward}
              keyboardType="number-pad"
              selectTextOnFocus
            />

            {/* descrição */}
            <Text style={styles.fieldLabel}>
              Descrição <Text style={styles.optional}>(opcional)</Text>
            </Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              placeholder="Contexto, motivação..."
              placeholderTextColor={colors.textMuted}
              value={description}
              onChangeText={setDesc}
              multiline
              numberOfLines={2}
            />

            {/* missões */}
            <Text style={styles.fieldLabel}>
              Missões <Text style={styles.optional}>(opcional, máx. 6)</Text>
            </Text>
            {missions.map((m, i) => (
              <View key={i} style={styles.missionInputRow}>
                <TextInput
                  style={[styles.textInput, styles.missionTitleInput]}
                  placeholder={`Missão ${i + 1}`}
                  placeholderTextColor={colors.textMuted}
                  value={m.title}
                  onChangeText={(v) => updateMission(i, 'title', v)}
                />
                <TextInput
                  style={[styles.textInput, styles.missionXPInput]}
                  value={m.xp_reward}
                  onChangeText={(v) => updateMission(i, 'xp_reward', v)}
                  keyboardType="number-pad"
                  selectTextOnFocus
                />
                {missions.length > 1 && (
                  <TouchableOpacity onPress={() => removeMission(i)} hitSlop={8}>
                    <Text style={styles.removeBtn}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {missions.length < 6 && (
              <TouchableOpacity style={styles.addMissionBtn} onPress={addMission} activeOpacity={0.8}>
                <Text style={styles.addMissionText}>+ Adicionar missão</Text>
              </TouchableOpacity>
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.createBtn, submitting && styles.createBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.createBtnText}>Criar Quest</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── estilos ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  newBtn: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
  },
  newBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  list: { padding: spacing.lg, paddingBottom: 120, gap: spacing.sm },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyTitle:    { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  emptySubtitle: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },

  section: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.md },
  completedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chevron: { fontSize: 12, color: colors.textMuted },

  // card
  card: {
    backgroundColor: colors.bgSurface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    marginTop: spacing.sm,
  },
  cardCompleted: { opacity: 0.65 },
  cardHeader: { padding: spacing.md, gap: spacing.xs },
  cardHeaderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typeBadge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  typeBadgeText: { fontSize: 11, fontWeight: '600' },
  xpBadge: { fontSize: 13, fontWeight: '700', color: colors.accent },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  cardPillar: { fontSize: 13, color: colors.textMuted },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  progressTrack: { flex: 1, height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.accent, borderRadius: 2 },
  progressLabel: { fontSize: 12, color: colors.textMuted, minWidth: 28, textAlign: 'right' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  completedBadge: { fontSize: 12, color: colors.success, fontWeight: '600' },
  statusText: { fontSize: 12, color: colors.textMuted },
  expandIcon: { fontSize: 12, color: colors.textMuted },

  // missões
  missionsContainer: {
    borderTopWidth: 1, borderTopColor: colors.border,
    padding: spacing.md, gap: spacing.sm,
  },
  description: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm },
  missionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkbox: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 1.5,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkmark: { fontSize: 13, color: '#fff', fontWeight: '700' },
  missionTitle: { flex: 1, fontSize: 14, color: colors.textPrimary },
  missionDone:  { textDecorationLine: 'line-through', color: colors.textMuted },
  missionXP:    { fontSize: 13, color: colors.accent, fontWeight: '600' },
  completeBtn: {
    backgroundColor: colors.accentSubtle, borderRadius: radius.md,
    paddingVertical: spacing.sm, alignItems: 'center',
    borderWidth: 1, borderColor: colors.accent,
  },
  completeBtnText: { fontSize: 14, fontWeight: '600', color: colors.accent },
  abandonBtn: {
    marginTop: spacing.sm, borderRadius: radius.md,
    paddingVertical: spacing.sm, alignItems: 'center',
    borderWidth: 1, borderColor: colors.danger,
  },
  abandonBtnText: { fontSize: 13, fontWeight: '600', color: colors.danger },

  // modal criar
  modalBackdrop: { flex: 1 },
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: {
    backgroundColor: colors.bgSurface, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, borderTopWidth: 1, borderColor: colors.border,
    maxHeight: '90%',
  },
  modalHandle: {
    width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2,
    alignSelf: 'center', marginTop: spacing.sm,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderColor: colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  closeBtn:   { fontSize: 16, color: colors.textSecondary },
  modalContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: 4 },

  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs + 2 },
  optional:   { color: colors.textMuted, fontWeight: '400' },

  textInput: {
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.textPrimary, fontSize: 14,
  },
  multilineInput: { minHeight: 60, textAlignVertical: 'top' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    backgroundColor: colors.bgElevated,
  },
  chipActive:     { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  chipText:       { fontSize: 13, color: colors.textSecondary },
  chipActiveText: { color: colors.accent, fontWeight: '600' },

  missionInputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  missionTitleInput: { flex: 1 },
  missionXPInput:    { width: 64, textAlign: 'center' },
  removeBtn: { fontSize: 16, color: colors.textMuted, paddingHorizontal: 4 },
  addMissionBtn: { paddingVertical: spacing.sm },
  addMissionText: { fontSize: 14, color: colors.accent, fontWeight: '600' },

  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
  createBtn: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg,
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
