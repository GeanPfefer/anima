import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import styles from './notes.module.css';

// ─── Helpers ──────────────────────────────────────────────────

function formatDateHeading(dateStr: string): string {
  const date      = new Date(dateStr + 'T12:00:00');
  const today     = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isToday =
    date.getDate()     === today.getDate()     &&
    date.getMonth()    === today.getMonth()    &&
    date.getFullYear() === today.getFullYear();

  const isYesterday =
    date.getDate()     === yesterday.getDate()     &&
    date.getMonth()    === yesterday.getMonth()    &&
    date.getFullYear() === yesterday.getFullYear();

  if (isToday)     return 'Hoje';
  if (isYesterday) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

const TYPE_LABELS: Record<string, string> = {
  food:    'Alimentação',
  expense: 'Gasto',
  mood:    'Humor',
  idea:    'Ideia',
  other:   'Nota',
};

// ─── Tipos ────────────────────────────────────────────────────

type Note = {
  id: string;
  content: string;
  note_type: string | null;
  context: Record<string, unknown> | null;
  pillar_hint: string | null;
  note_date: string;
  created_at: string;
};

type DayGroup = { dateKey: string; notes: Note[] };

// ─── Page ─────────────────────────────────────────────────────

export default async function NotesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: rawNotes } = await supabase
    .from('notes')
    .select('id, content, note_type, context, pillar_hint, note_date, created_at')
    .eq('user_id', user.id)
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(300);

  const allNotes = (rawNotes ?? []) as Note[];

  // Agrupar por dia
  const dayMap = new Map<string, Note[]>();
  for (const note of allNotes) {
    if (!dayMap.has(note.note_date)) dayMap.set(note.note_date, []);
    dayMap.get(note.note_date)!.push(note);
  }

  const days: DayGroup[] = Array.from(dayMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, notes]) => ({ dateKey, notes }));

  return (
    <main className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Notas</h1>
        {allNotes.length > 0 && (
          <p className={styles.summary}>
            {allNotes.length} {allNotes.length === 1 ? 'nota registrada' : 'notas registradas'}
          </p>
        )}
      </div>

      {allNotes.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nenhuma nota ainda</p>
          <p className={styles.emptyText}>
            Mencione o que comeu, gastou, sentiu ou pensou no chat — o sistema registra automaticamente.
          </p>
          <a href="/chat" className={styles.emptyLink}>Abrir chat →</a>
        </div>
      ) : (
        <div className={styles.timeline}>
          {days.map(({ dateKey, notes }) => (
            <div key={dateKey} className={styles.dayGroup}>
              <div className={styles.dayHeader}>
                <span className={styles.dayLabel}>{formatDateHeading(dateKey)}</span>
                <span className={styles.dayCount}>{notes.length} {notes.length === 1 ? 'nota' : 'notas'}</span>
              </div>

              <div className={styles.noteList}>
                {notes.map(note => (
                  <div key={note.id} className={styles.note}>
                    <span className={`${styles.typeBadge} ${styles[`type_${note.note_type ?? 'other'}`]}`}>
                      {TYPE_LABELS[note.note_type ?? 'other'] ?? 'Nota'}
                    </span>
                    <p className={styles.noteContent}>{note.content}</p>
                    {note.pillar_hint && (
                      <span className={styles.pillarHint}>{note.pillar_hint}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
