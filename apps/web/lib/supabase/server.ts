import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@anima/types';
import { cookies } from 'next/headers';

// `createBearerClient` (cliente user-scoped por access token, sem `next/headers`) vive
// em `./bearer` para ser carregável fora do runtime do Next (resident host in-process).
// Reexportado aqui para preservar o import histórico `@/lib/supabase/server`.
export { createBearerClient } from './bearer';

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
