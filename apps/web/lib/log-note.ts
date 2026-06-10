import { createClient } from '@/lib/supabase/server';

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
    xp_awarded:  0,
    note_date:   noteDate,
  });
}
