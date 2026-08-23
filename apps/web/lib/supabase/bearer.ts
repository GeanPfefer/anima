import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@anima/types';

// Cliente do servidor que age COMO o usuário via o access token do Supabase
// (Authorization: Bearer). Toda RPC/consulta carrega o bearer, então RLS e
// `auth.uid()` continuam sendo a autoridade — nunca a service role. Usado pela
// fronteira de autenticação mobile → host (paridade UX-04) E pelo transporte
// IN-PROCESS do resident local host (ADR-003): o processo residente compõe a
// aplicação diretamente, sem passar pela rota HTTP, mas ainda user-scoped.
//
// Isolado de `next/headers` DE PROPÓSITO: este módulo NÃO importa nada do Next,
// então pode ser carregado por um processo Node puro (o resident host in-process)
// sem o runtime do Next. O caminho por cookie (que depende de `next/headers`)
// permanece em `server.ts`. O token é validado separadamente (`getUser(token)`)
// antes de qualquer efeito.
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
