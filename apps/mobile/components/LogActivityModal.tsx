import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { calculateBonusMultiplier } from '@anima/core';
import { getActivityBonuses, logMultipleActivities } from '@/lib/activity';
import { parseActivityText, type ParsedActivity } from '@/lib/parse-activity';
import { startRecording, type RecordingHandle } from '@/lib/transcribe';
import { extractEntitiesForRecord } from '@/lib/extract-entities';
import { embedEntryForRecord } from '@/lib/embed-entry';
import type { ActivityBonusType } from '@anima/types';
import { colors, spacing, radius } from '@/constants/theme';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// Retorna as últimas N datas como YYYY-MM-DD
function recentDates(n: number): Array<{ label: string; value: string }> {
  const result = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const val = d.toISOString().slice(0, 10);
    result.push({
      label: i === 0 ? 'Hoje' : i === 1 ? 'Ontem' : `Há ${i} dias`,
      value: val,
    });
  }
  return result;
}

// ── Tipos ──────────────────────────────────────────────────────────────────────

type Pillar = { id: string; name: string; xp_rate: number };

type ReviewEntry = {
  localId: string;
  pillarId: string | null;
  durationMinutes: number;
  note: string;
  editingDuration: boolean;
  durationDraft: string;
  pillarExpanded: boolean;
};

type Phase = 'input' | 'parsing' | 'reviewing' | 'submitting' | 'success';
type RecState = 'idle' | 'recording' | 'transcribing';

type BonusCache = Record<string, ActivityBonusType[]>;

// ── Helpers ────────────────────────────────────────────────────────────────────

function matchPillar(name: string, pillars: Pillar[]): Pillar | null {
  const q = name.toLowerCase().trim();
  return (
    pillars.find((p) => p.name.toLowerCase() === q) ??
    pillars.find((p) => p.name.toLowerCase().startsWith(q.slice(0, 4))) ??
    null
  );
}

function formatDuration(min: number): string {
  if (min === 0) return 'sem tempo';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m}min`;
}

function xpForEntry(
  entry: ReviewEntry,
  pillars: Pillar[],
  bonusCache: BonusCache,
): number {
  if (!entry.pillarId || entry.durationMinutes <= 0) return 0;
  const pillar = pillars.find((p) => p.id === entry.pillarId);
  if (!pillar) return 0;
  const base     = Math.round(entry.durationMinutes * pillar.xp_rate);
  const bonuses  = bonusCache[entry.pillarId] ?? [];
  const mult     = calculateBonusMultiplier(bonuses);
  return Math.round(base * mult);
}

// ── Componente ─────────────────────────────────────────────────────────────────

type Props = {
  userId: string;
  pillars: Pillar[];
  onSuccess: () => void;
};

export default function LogActivityModal({ userId, pillars, onSuccess }: Props) {
  const [open, setOpen]               = useState(false);
  const [text, setText]               = useState('');
  const [phase, setPhase]             = useState<Phase>('input');
  const [entries, setEntries]         = useState<ReviewEntry[]>([]);
  const [bonusCache, setBonusCache]   = useState<BonusCache>({});
  const [parseError, setParseError]   = useState('');
  const [successXP, setSuccessXP]     = useState<number | null>(null);
  const [activityDate, setActivityDate] = useState(todayStr());

  // Gravação de áudio
  const [recState, setRecState]     = useState<RecState>('idle');
  const [recSeconds, setRecSeconds] = useState(0);
  const recHandleRef = useRef<RecordingHandle | null>(null);
  const recTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Limpa timer ao desmontar
  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
  }, []);

  // ── Fechar e resetar ─────────────────────────────────────────────
  function handleClose() {
    // Garante que gravação seja encerrada se o modal fechar durante ela
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    recHandleRef.current?.cancel().catch(() => {});
    recHandleRef.current = null;
    setRecState('idle');
    setRecSeconds(0);

    setOpen(false);
    setText('');
    setPhase('input');
    setEntries([]);
    setBonusCache({});
    setParseError('');
    setSuccessXP(null);
    setActivityDate(todayStr());
  }

  // ── Gravação de áudio ─────────────────────────────────────────────
  async function handleStartRecording() {
    setParseError('');
    try {
      const handle = await startRecording();
      recHandleRef.current  = handle;
      setRecState('recording');
      setRecSeconds(0);
      recTimerRef.current = setInterval(
        () => setRecSeconds((s) => s + 1),
        1000,
      );
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Erro ao iniciar gravação');
    }
  }

  async function handleStopRecording() {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    setRecState('transcribing');
    try {
      const transcribed = await recHandleRef.current?.stop() ?? '';
      recHandleRef.current = null;
      if (transcribed) {
        setText((prev) => (prev.trim() ? `${prev.trim()} ${transcribed}` : transcribed));
      }
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Não foi possível transcrever o áudio.',
      );
    } finally {
      setRecState('idle');
      setRecSeconds(0);
    }
  }

  // ── Carregar bônus para um conjunto de pillarIds ─────────────────
  const loadBonuses = useCallback(
    async (pillarIds: (string | null)[]) => {
      const ids = [...new Set(pillarIds.filter((id): id is string => !!id))];
      // Sempre recarrega — activityDate pode ter mudado
      const results = await Promise.all(
        ids.map((id) => getActivityBonuses(id, userId, activityDate)),
      );

      setBonusCache((prev) => {
        const next = { ...prev };
        ids.forEach((id, i) => { next[id] = results[i] ?? []; });
        return next;
      });
    },
    [userId, activityDate],
  );

  // ── Interpretar texto com IA ─────────────────────────────────────
  async function handleParse() {
    if (!text.trim()) return;
    setParseError('');
    setPhase('parsing');

    try {
      const parsed: ParsedActivity[] = await parseActivityText(
        text.trim(),
        pillars.map((p) => p.name),
      );

      if (parsed.length === 0) {
        setParseError('Não identifiquei atividades no texto. Tente detalhar mais.');
        setPhase('input');
        return;
      }

      const newEntries: ReviewEntry[] = parsed.map((a, i) => ({
        localId:        `${Date.now()}-${i}`,
        pillarId:       matchPillar(a.pillarName, pillars)?.id ?? null,
        durationMinutes: Math.max(0, Math.round(a.durationMinutes ?? 0)),
        note:           (a.note ?? '').slice(0, 120),
        editingDuration: false,
        durationDraft:  '',
        pillarExpanded: false,
      }));

      setEntries(newEntries);

      // Pré-carrega bônus para os pilares detectados
      await loadBonuses(newEntries.map((e) => e.pillarId));

      setPhase('reviewing');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      if (msg.includes('aborted') || msg.includes('network')) {
        setParseError('Não foi possível conectar à IA. Verifique se a Goma está online.');
      } else {
        setParseError(`Erro ao interpretar: ${msg}`);
      }
      setPhase('input');
    }
  }

  // ── Mudar pilar de uma entrada ───────────────────────────────────
  function selectPillar(localId: string, pillarId: string) {
    setEntries((prev) =>
      prev.map((e) =>
        e.localId === localId
          ? { ...e, pillarId, pillarExpanded: false }
          : e,
      ),
    );
    loadBonuses([pillarId]);
  }

  // ── Toggle pillar picker ─────────────────────────────────────────
  function togglePillarPicker(localId: string) {
    setEntries((prev) =>
      prev.map((e) =>
        e.localId === localId
          ? { ...e, pillarExpanded: !e.pillarExpanded }
          : { ...e, pillarExpanded: false },
      ),
    );
  }

  // ── Edição de duração ────────────────────────────────────────────
  function startEditDuration(localId: string, current: number) {
    setEntries((prev) =>
      prev.map((e) =>
        e.localId === localId
          ? { ...e, editingDuration: true, durationDraft: current > 0 ? String(current) : '' }
          : e,
      ),
    );
  }

  function confirmDuration(localId: string) {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.localId !== localId) return e;
        const val = Math.max(0, Math.min(480, Number(e.durationDraft) || 0));
        return { ...e, durationMinutes: val, editingDuration: false, durationDraft: '' };
      }),
    );
  }

  // ── Remover entrada ──────────────────────────────────────────────
  function removeEntry(localId: string) {
    setEntries((prev) => prev.filter((e) => e.localId !== localId));
  }

  // ── Registrar tudo ───────────────────────────────────────────────
  async function handleSubmit() {
    const valid = entries.filter((e) => e.pillarId);
    if (valid.length === 0) return;
    setPhase('submitting');

    try {
      const { totalXP, entries: logged } = await logMultipleActivities(
        valid.map((e) => ({
          userId,
          pillarId:        e.pillarId!,
          durationMinutes: e.durationMinutes,
          note:            e.note,
          activityDate,
        })),
      );
      setSuccessXP(totalXP);
      setPhase('success');

      // Processamento semântico — fire-and-forget, não bloqueia o usuário
      for (const { recordId, note } of logged) {
        if (note) {
          extractEntitiesForRecord(note, recordId, userId).catch(() => {});
          embedEntryForRecord(note, recordId, userId).catch(() => {});
        }
      }

      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 2000);
    } catch {
      setPhase('reviewing');
    }
  }

  // ── XP total estimado ────────────────────────────────────────────
  const totalXPEstimate = entries.reduce(
    (sum, e) => sum + xpForEntry(e, pillars, bonusCache),
    0,
  );

  const canSubmit = entries.some((e) => e.pillarId !== null);

  // ── Render ───────────────────────────────────────────────────────
  return (
    <>
      <TouchableOpacity style={styles.fab} onPress={() => setOpen(true)} activeOpacity={0.85}>
        <Text style={styles.fabText}>+ Nova entrada</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={handleClose}>
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={styles.backdropTouch}
            onPress={phase === 'input' || phase === 'reviewing' ? handleClose : undefined}
          />

          <View style={styles.sheet}>
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {phase === 'input'     && 'Nova entrada'}
                {phase === 'parsing'   && 'Interpretando...'}
                {phase === 'reviewing' && 'Confirmar entradas'}
                {phase === 'submitting' && 'Registrando...'}
                {phase === 'success'   && 'Registrado!'}
              </Text>
              {(phase === 'input' || phase === 'reviewing') && (
                <TouchableOpacity onPress={handleClose} hitSlop={12}>
                  <Text style={styles.closeBtn}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── INPUT ─────────────────────────────────────────── */}
            {phase === 'input' && (
              <ScrollView
                contentContainerStyle={styles.sheetContent}
                keyboardShouldPersistTaps="handled"
              >
                <TextInput
                  style={styles.naturalInput}
                  placeholder="O que você fez? Escreva naturalmente..."
                  placeholderTextColor={colors.textMuted}
                  value={text}
                  onChangeText={setText}
                  multiline
                  numberOfLines={4}
                  autoFocus
                  textAlignVertical="top"
                />
                <Text style={styles.inputHint}>
                  ex: "corri 45min e li por meia hora depois"
                </Text>
                {parseError ? (
                  <Text style={styles.error}>{parseError}</Text>
                ) : null}

                {/* Barra de ações: mic + interpretar */}
                <View style={styles.inputActions}>
                  {/* Botão de microfone */}
                  {recState === 'idle' && (
                    <TouchableOpacity
                      style={styles.micBtn}
                      onPress={handleStartRecording}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.micIcon}>🎙</Text>
                    </TouchableOpacity>
                  )}
                  {recState === 'recording' && (
                    <TouchableOpacity
                      style={[styles.micBtn, styles.micBtnRecording]}
                      onPress={handleStopRecording}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.micIcon}>⏹</Text>
                      <Text style={styles.recTimer}>{recSeconds}s</Text>
                    </TouchableOpacity>
                  )}
                  {recState === 'transcribing' && (
                    <View style={[styles.micBtn, styles.micBtnTranscribing]}>
                      <ActivityIndicator size="small" color={colors.textSecondary} />
                    </View>
                  )}

                  {/* Interpretar */}
                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      styles.primaryBtnFlex,
                      (!text.trim() || recState !== 'idle') && styles.primaryBtnDisabled,
                    ]}
                    onPress={handleParse}
                    disabled={!text.trim() || recState !== 'idle'}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryBtnText}>Interpretar →</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}

            {/* ── PARSING ───────────────────────────────────────── */}
            {phase === 'parsing' && (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.accent} size="large" />
                <Text style={styles.parsingHint}>Anima está pensando...</Text>
              </View>
            )}

            {/* ── REVIEWING ─────────────────────────────────────── */}
            {phase === 'reviewing' && (
              <>
                <ScrollView
                  contentContainerStyle={styles.sheetContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {/* Seletor de data — backfill com datas passadas */}
                  <View style={styles.dateSection}>
                    <Text style={styles.dateSectionLabel}>DATA DA ATIVIDADE</Text>
                    <View style={styles.dateChips}>
                      {recentDates(4).map(({ label, value }) => (
                        <TouchableOpacity
                          key={value}
                          style={[
                            styles.dateChip,
                            activityDate === value && styles.dateChipActive,
                          ]}
                          onPress={() => {
                            setActivityDate(value);
                            // Recarrega bônus para a nova data
                            const ids = [...new Set(entries.map(e => e.pillarId).filter((id): id is string => !!id))];
                            Promise.all(ids.map(id => getActivityBonuses(id, userId, value))).then(results => {
                              setBonusCache(prev => {
                                const next = { ...prev };
                                ids.forEach((id, i) => { next[id] = results[i] ?? []; });
                                return next;
                              });
                            }).catch(() => {});
                          }}
                          activeOpacity={0.8}
                        >
                          <Text style={[
                            styles.dateChipText,
                            activityDate === value && styles.dateChipTextActive,
                          ]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  {entries.length === 0 ? (
                    <Text style={styles.emptyMsg}>Todas as entradas foram removidas.</Text>
                  ) : (
                    entries.map((entry) => {
                      const pillar = pillars.find((p) => p.id === entry.pillarId);
                      const xp     = xpForEntry(entry, pillars, bonusCache);
                      const bonuses = entry.pillarId ? (bonusCache[entry.pillarId] ?? []) : [];

                      return (
                        <View key={entry.localId} style={styles.entryCard}>
                          {/* Linha de chips */}
                          <View style={styles.entryChipRow}>
                            {/* Pilar */}
                            <TouchableOpacity
                              style={[
                                styles.chip,
                                pillar ? styles.chipActive : styles.chipWarning,
                              ]}
                              onPress={() => togglePillarPicker(entry.localId)}
                              activeOpacity={0.8}
                            >
                              <Text style={[
                                styles.chipText,
                                pillar ? styles.chipTextActive : styles.chipTextWarning,
                              ]}>
                                {pillar ? pillar.name : '⚠ selecionar'} ▾
                              </Text>
                            </TouchableOpacity>

                            {/* Duração */}
                            {entry.editingDuration ? (
                              <TextInput
                                style={styles.durationEditInput}
                                value={entry.durationDraft}
                                onChangeText={(v) =>
                                  setEntries((prev) =>
                                    prev.map((e) =>
                                      e.localId === entry.localId
                                        ? { ...e, durationDraft: v }
                                        : e,
                                    ),
                                  )
                                }
                                onBlur={() => confirmDuration(entry.localId)}
                                onSubmitEditing={() => confirmDuration(entry.localId)}
                                keyboardType="number-pad"
                                autoFocus
                                placeholder="min"
                                placeholderTextColor={colors.textMuted}
                              />
                            ) : (
                              <TouchableOpacity
                                style={styles.chip}
                                onPress={() => startEditDuration(entry.localId, entry.durationMinutes)}
                                activeOpacity={0.8}
                              >
                                <Text style={styles.chipText}>
                                  {formatDuration(entry.durationMinutes)} ✎
                                </Text>
                              </TouchableOpacity>
                            )}

                            {/* XP estimado */}
                            {xp > 0 && (
                              <View style={styles.xpBadge}>
                                <Text style={styles.xpBadgeText}>+{xp} XP</Text>
                              </View>
                            )}

                            {/* Remover */}
                            <TouchableOpacity
                              style={styles.removeBtn}
                              onPress={() => removeEntry(entry.localId)}
                              hitSlop={8}
                            >
                              <Text style={styles.removeBtnText}>×</Text>
                            </TouchableOpacity>
                          </View>

                          {/* Nota */}
                          {entry.note ? (
                            <Text style={styles.entryNote} numberOfLines={2}>
                              {entry.note}
                            </Text>
                          ) : null}

                          {/* Bônus ativos */}
                          {bonuses.length > 0 && (
                            <View style={styles.bonusRow}>
                              {bonuses.map((b) => (
                                <View key={b} style={styles.bonusBadge}>
                                  <Text style={styles.bonusBadgeText}>
                                    {BONUS_LABELS[b]}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          )}

                          {/* Pillar picker inline */}
                          {entry.pillarExpanded && (
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              style={styles.pillarPicker}
                              contentContainerStyle={styles.pillarPickerContent}
                              keyboardShouldPersistTaps="handled"
                            >
                              {pillars.map((p) => (
                                <TouchableOpacity
                                  key={p.id}
                                  style={[
                                    styles.pillarPickerChip,
                                    entry.pillarId === p.id && styles.pillarPickerChipActive,
                                  ]}
                                  onPress={() => selectPillar(entry.localId, p.id)}
                                  activeOpacity={0.8}
                                >
                                  <Text style={[
                                    styles.pillarPickerChipText,
                                    entry.pillarId === p.id && styles.pillarPickerChipTextActive,
                                  ]}>
                                    {p.name}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                          )}
                        </View>
                      );
                    })
                  )}
                </ScrollView>

                {/* Barra inferior */}
                <View style={styles.reviewFooter}>
                  <TouchableOpacity
                    onPress={() => setPhase('input')}
                    hitSlop={8}
                  >
                    <Text style={styles.backLink}>← Editar texto</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryBtn, styles.primaryBtnInline, !canSubmit && styles.primaryBtnDisabled]}
                    onPress={handleSubmit}
                    disabled={!canSubmit}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryBtnText}>
                      Registrar{totalXPEstimate > 0 ? ` · +${totalXPEstimate} XP` : ''}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* ── SUBMITTING ────────────────────────────────────── */}
            {phase === 'submitting' && (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.accent} size="large" />
                <Text style={styles.parsingHint}>Registrando...</Text>
              </View>
            )}

            {/* ── SUCCESS ───────────────────────────────────────── */}
            {phase === 'success' && (
              <View style={styles.centered}>
                <Text style={styles.successXP}>
                  {successXP != null && successXP > 0 ? `+${successXP} XP` : '✓'}
                </Text>
                <Text style={styles.successMsg}>
                  {entries.length === 1
                    ? 'Entrada registrada!'
                    : `${entries.length} entradas registradas!`}
                </Text>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// ── Constantes de display ──────────────────────────────────────────────────────

const BONUS_LABELS: Record<ActivityBonusType, string> = {
  first_of_day:     '⚡ Primeiro do dia',
  forgotten_pillar: '⚡ Pilar esquecido',
  active_streak:    '⚡ Sequência ativa',
  active_quest:     '⚡ Quest ativa',
};

// ── Estilos ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: spacing.xl,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.xl,
    paddingVertical: spacing.md,
    alignItems: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  fabText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },

  backdrop: { flex: 1 },
  backdropTouch: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },

  sheet: {
    backgroundColor: colors.bgSurface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  closeBtn:   { fontSize: 16, color: colors.textSecondary },
  sheetContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  // Barra de ações do input
  inputActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  micBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 4,
  },
  micBtnRecording: {
    borderColor: colors.danger,
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  micBtnTranscribing: {
    borderColor: colors.border,
    opacity: 0.7,
  },
  micIcon: { fontSize: 18 },
  recTimer: { fontSize: 11, color: colors.danger, fontWeight: '600' },
  primaryBtnFlex: { flex: 1, marginTop: 0 },

  // Input
  naturalInput: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 24,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  inputHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    fontStyle: 'italic',
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.md,
  },

  // Botão principal
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryBtnInline: { flex: 1, marginTop: 0, marginLeft: spacing.md },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },

  // Spinners e success
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl + spacing.xl,
    gap: spacing.md,
  },
  parsingHint: { color: colors.textSecondary, fontSize: 14 },
  successXP: { fontSize: 44, fontWeight: '700', color: colors.accent },
  successMsg: { fontSize: 16, color: colors.textSecondary },
  emptyMsg: { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xl },

  // Entry cards (reviewing)
  entryCard: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  entryChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },

  // Chips
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.bgSurface,
  },
  chipActive:   { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  chipWarning:  { borderColor: colors.warning, backgroundColor: 'rgba(245,158,11,0.12)' },
  chipText:     { color: colors.textSecondary, fontSize: 13 },
  chipTextActive:  { color: colors.accent, fontWeight: '600' },
  chipTextWarning: { color: colors.warning, fontWeight: '600' },

  // Duração em edição
  durationEditInput: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    color: colors.textPrimary,
    fontSize: 13,
    width: 72,
    textAlign: 'center',
    backgroundColor: colors.bgSurface,
  },

  // XP badge
  xpBadge: {
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  xpBadgeText: { color: colors.accent, fontSize: 12, fontWeight: '700' },

  // Remover
  removeBtn: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
  },
  removeBtnText: { color: colors.textMuted, fontSize: 18, lineHeight: 20 },

  // Nota da entrada
  entryNote: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },

  // Bônus
  bonusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 },
  bonusBadge: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  bonusBadgeText: { color: colors.success, fontSize: 11, fontWeight: '600' },

  // Pillar picker (inline)
  pillarPicker: { marginTop: spacing.sm },
  pillarPickerContent: { gap: spacing.xs, paddingVertical: 2 },
  pillarPickerChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.bgSurface,
  },
  pillarPickerChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  pillarPickerChipText:   { color: colors.textSecondary, fontSize: 13 },
  pillarPickerChipTextActive: { color: colors.accent, fontWeight: '600' },

  // Date section
  dateSection: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  dateSectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },
  dateChips: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  dateChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.bgSurface,
  },
  dateChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSubtle,
  },
  dateChipText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  dateChipTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },

  // Footer do reviewing
  reviewFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  backLink: { color: colors.textSecondary, fontSize: 14 },
});
