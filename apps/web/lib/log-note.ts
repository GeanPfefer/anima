import { createClient } from '@/lib/supabase/server';

function calcNoteXP(content: string, context: Record<string, unknown>): number {
  const ctxKeys = Object.keys(context).length;
  const len     = content.length;
  if (len >= 70 || ctxKeys >= 2) return 20;
  if (len >= 40 || ctxKeys >= 1) return 10;
  return 5;
}

export async function logNote(data: {
  content: string;
  noteType: string;
  context: Record<string, unknown>;
  pillarHint: string | null;
  noteDate?: string;
}): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const noteDate = data.noteDate ?? new Date().toISOString().slice(0, 10);

  await supabase.from('notes').insert({
    user_id:     user.id,
    content:     data.content,
    note_type:   data.noteType,
    context:     data.context as import('@anima/types').Json,
    pillar_hint: data.pillarHint,
    xp_awarded:  calcNoteXP(data.content, data.context),
    note_date:   noteDate,
  });
}
