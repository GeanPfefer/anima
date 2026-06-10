import { supabase } from './supabase';
import type { DetectedNote } from './detect-note';

function calcNoteXP(content: string, context: Record<string, unknown>): number {
  const ctxKeys = Object.keys(context).length;
  const len     = content.length;
  if (len >= 70 || ctxKeys >= 2) return 20;
  if (len >= 40 || ctxKeys >= 1) return 10;
  return 5;
}

export async function logNotes(notes: DetectedNote[], userId: string): Promise<void> {
  if (notes.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  await supabase.from('notes').insert(
    notes.map((n) => ({
      user_id:    userId,
      content:    n.content,
      note_type:  n.note_type,
      context:    (n.context ?? null) as import('@anima/types').Json | null,
      pillar_hint: n.pillarHint,
      xp_awarded: calcNoteXP(n.content, n.context ?? {}),
      note_date:  today,
    })),
  );
}
