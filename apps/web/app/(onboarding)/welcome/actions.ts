'use server';

import { createClient } from '@/lib/supabase/server';
import { completeOnboarding as _completeOnboarding } from '@/lib/complete-onboarding';

type Message = { role: 'user' | 'assistant'; content: string };

export async function saveName(name: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');
  await supabase.from('profiles').update({ name }).eq('id', user.id);
}

export async function completeOnboarding(messages: Message[]): Promise<void> {
  return _completeOnboarding(messages);
}
