import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createGoTrueIdentityProvider } from '@/lib/resident-host/ports';
import { createBearerClient } from '@/lib/supabase/bearer';

// Resolve a identidade LOCAL LEGÍTIMA da CLI reusando exatamente o mecanismo do
// resident host (ADR-003 §11): sign-in por GoTrue com as credenciais residentes →
// access token → cliente Bearer user-scoped. Toda RPC/consulta carrega o Bearer,
// então `auth.uid()` + RLS continuam a autoridade. NUNCA usa `SUPABASE_SERVICE_ROLE_KEY`,
// mesmo presente no ambiente — não há bypass administrativo. O token é opaco: nunca
// é logado nem impresso.

export interface CliIdentity {
  readonly userId: string;
  readonly client: SupabaseClient<Database>;
}

export type IdentityResult =
  | { readonly ok: true; readonly identity: CliIdentity }
  | { readonly ok: false; readonly error: string };

export async function resolveCliIdentity(env: NodeJS.ProcessEnv = process.env): Promise<IdentityResult> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = env.ANIMA_RESIDENT_EMAIL;
  const password = env.ANIMA_RESIDENT_PASSWORD;
  if (!supabaseUrl || !anonKey) {
    return { ok: false, error: 'NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes no ambiente (apps/web/.env.local).' };
  }
  if (!email || !password) {
    return { ok: false, error: 'ANIMA_RESIDENT_EMAIL/ANIMA_RESIDENT_PASSWORD ausentes: a CLI opera com a identidade residente (RLS via GoTrue), nunca service_role.' };
  }
  const acquire = createGoTrueIdentityProvider({ supabaseUrl, anonKey, email, password });
  const identity = await acquire();
  if (identity === null) {
    return { ok: false, error: 'Não foi possível autenticar a identidade residente via GoTrue. O Supabase local está no ar (54321) e as credenciais estão corretas?' };
  }
  return { ok: true, identity: { userId: identity.userId, client: createBearerClient(identity.accessToken) } };
}
