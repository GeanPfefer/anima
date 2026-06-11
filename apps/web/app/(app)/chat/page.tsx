import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ChatClient } from './_components/ChatClient';

export default async function ChatPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, onboarding_completed_at')
    .eq('id', user.id)
    .single();

  // Normaliza: null ou placeholder 'Jogador' → string vazia (IA não sabe o nome ainda)
  const userName = (profile?.name && profile.name !== 'Jogador') ? profile.name : '';

  return (
    <ChatClient
      isFirstTime={!profile?.onboarding_completed_at}
      userName={userName}
    />
  );
}
