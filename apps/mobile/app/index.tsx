import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors } from '@/constants/theme';

/**
 * Ponto de entrada do app.
 * Valida sessão no servidor, checa onboarding e redireciona.
 */
export default function IndexScreen() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        // getUser valida com o servidor — detecta usuário deletado ou sessão expirada
        const { data: { user }, error } = await supabase.auth.getUser();

        if (cancelled) return;

        if (error || !user) {
          // Limpa qualquer sessão stale do AsyncStorage
          await supabase.auth.signOut();
          if (!cancelled) router.replace('/(auth)/login');
          return;
        }

        // Verifica se onboarding foi concluído
        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_completed_at')
          .eq('id', user.id)
          .single();

        if (cancelled) return;

        if (profile?.onboarding_completed_at) {
          router.replace('/(app)/home');
        } else {
          router.replace('/(app)/chat');
        }
      } catch {
        if (!cancelled) router.replace('/(auth)/login');
      }
    }

    resolve();

    // Fallback: se a rede travar, manda pro login em 8s
    const t = setTimeout(() => {
      if (!cancelled) router.replace('/(auth)/login');
    }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}
