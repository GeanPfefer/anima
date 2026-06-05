import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

type Profile = {
  name: string;
  onboarding_completed_at: string | null;
};

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('name, onboarding_completed_at')
    .eq('id', userId)
    .single();
  return data ?? null;
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // sessionReady: true assim que onAuthStateChange disparar (rápido, via AsyncStorage)
  // profileReady: true quando o perfil for buscado (pode demorar mais)
  const [sessionReady, setSessionReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const mounted = useRef(true);

  // 1) Ouve mudanças de sessão — callback síncrono, dispara rápido
  useEffect(() => {
    mounted.current = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_, newSession) => {
        if (!mounted.current) return;
        setSession(newSession);
        setSessionReady(true);

        // Sem sessão: profile já está resolvido (null)
        if (!newSession?.user) {
          setProfile(null);
          setProfileReady(true);
        }
      },
    );

    return () => {
      mounted.current = false;
      subscription.unsubscribe();
    };
  }, []);

  // 2) Busca o perfil toda vez que o userId mudar
  useEffect(() => {
    if (!session?.user?.id) return;

    setProfileReady(false);
    fetchProfile(session.user.id)
      .then((p) => {
        if (!mounted.current) return;
        setProfile(p);
      })
      .catch(() => {
        if (!mounted.current) return;
        setProfile(null);
      })
      .finally(() => {
        if (!mounted.current) return;
        setProfileReady(true);
      });
  }, [session?.user?.id]);

  return { session, profile, loading: !sessionReady || !profileReady };
}
