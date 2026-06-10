import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  SectionList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors, spacing, radius } from '@/constants/theme';

type Note = {
  id:         string;
  content:    string;
  note_type:  string | null;
  note_date:  string;
};

type Section = {
  title: string;
  data:  Note[];
};

const TYPE_LABEL: Record<string, string> = {
  food:    'Alimentação',
  expense: 'Gasto',
  mood:    'Humor',
  idea:    'Ideia',
  other:   'Nota',
};

const TYPE_COLOR: Record<string, string> = {
  food:    '#16a34a',
  expense: '#ca8a04',
  mood:    '#2563eb',
  idea:    '#7c3aed',
  other:   '#6b7280',
};

function formatDate(dateStr: string): string {
  const d    = new Date(dateStr + 'T12:00:00');
  const diff = Math.floor((Date.now() - d.getTime()) / 86400_000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });
}

export default function NotesScreen() {
  const { top } = useSafeAreaInsets();
  const [sections, setSections]   = useState<Section[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setLoading(false); setRefreshing(false); return; }

      const { data } = await supabase
        .from('notes')
        .select('id, content, note_type, note_date')
        .eq('user_id', session.user.id)
        .order('note_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100);

      const notes: Note[] = data ?? [];

      // Agrupa por dia
      const byDay = new Map<string, Note[]>();
      for (const n of notes) {
        const list = byDay.get(n.note_date) ?? [];
        list.push(n);
        byDay.set(n.note_date, list);
      }

      setSections(
        [...byDay.entries()].map(([date, notes]) => ({
          title: formatDate(date),
          data:  notes,
        })),
      );
    } catch {
      // falha silenciosa
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingTop: top + spacing.md }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={<Text style={styles.title}>Notas</Text>}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Nenhuma nota registrada ainda.{'\n'}Elas aparecem automaticamente a partir das suas entradas.
          </Text>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.dayHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => {
          const type  = item.note_type ?? 'other';
          const color = TYPE_COLOR[type] ?? TYPE_COLOR.other;
          return (
            <View style={styles.noteCard}>
              <View style={[styles.typeBadge, { backgroundColor: `${color}22` }]}>
                <Text style={[styles.typeText, { color }]}>
                  {TYPE_LABEL[type] ?? 'Nota'}
                </Text>
              </View>
              <Text style={styles.noteContent}>{item.content}</Text>
            </View>
          );
        }}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  list:     { padding: spacing.lg, paddingBottom: spacing.xxl },

  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  dayHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  noteCard: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  typeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  noteContent: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: spacing.xxl,
  },
});
