import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@anima/types';
import { cookies } from 'next/headers';

// Cliente do servidor que age COMO o usuário via o access token do Supabase
// (Authorization: Bearer). Toda RPC/consulta carrega o bearer, então RLS e
// `auth.uid()` continuam sendo a autoridade — nunca a service role. Usado pela
// fronteira de autenticação mobile → host (paridade UX-04). O token é validado
// separadamente (`getUser(token)`) antes de qualquer efeito.
export function createBearerClient(accessToken: string) {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // setAll só funciona em Server Actions e Route Handlers.
          // Em Server Components o Supabase pode tentar renovar o token —
          // ignoramos o erro de escrita; a leitura da sessão ainda funciona.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // ignorado intencionalmente em Server Components
          }
        },
      },
    }
  );
}
