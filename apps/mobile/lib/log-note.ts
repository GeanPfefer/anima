import { supabase } from './supabase';
import type { DetectedNote } from './detect-note';

export async function logNotes(notes: DetectedNote[], userId: string): Promise<void> {
  if (notes.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  await supabase.from('notes').insert(
    notes.map((n) => ({
      user_id:    userId,
      content:    n.content,
      note_type:  n.note_type,
      context:    (n.context ?? null) as import('@anima/types').Json | null,
      xp_awarded: 0,
      note_date:  today,
    })),
  );
}
