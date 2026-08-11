import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isDevelopmentChatAuthorized } from '@/lib/ai/chat-surface';
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

  const PLACEHOLDER = new Set(['Jogador', 'usuário']);
  const hasRealName = Boolean(profile?.name && !PLACEHOLDER.has(profile.name));
  const userName = hasRealName ? profile!.name! : '';

  // isFirstTime = true se onboarding nunca ocorreu OU se o nome real nunca foi coletado
  // (evita que onboarding marcado como completo sem nome trave o usuário no modo regular)
  const isFirstTime = !profile?.onboarding_completed_at || !hasRealName;

  // Autorização da superfície de autodesenvolvimento resolvida no SERVIDOR (env +
  // allowlist dedicado). Apenas decide se o modo aparece na UI; a habilitação real
  // do developmentMode é re-verificada na rota do chat (defesa em profundidade).
  const devAuthorized = isDevelopmentChatAuthorized(user.id);

  return (
    <ChatClient
      isFirstTime={isFirstTime}
      userName={userName}
      devAuthorized={devAuthorized}
    />
  );
}
