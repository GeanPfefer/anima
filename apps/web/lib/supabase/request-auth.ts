import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@anima/types';
import { createBearerClient, createClient } from './server';

// Fronteira de autenticação compartilhada por rotas que aceitam TANTO o cookie
// web (@supabase/ssr) QUANTO `Authorization: Bearer <access token>` (mobile).
// A identidade vem SEMPRE de `auth.uid()` resolvido pelo Supabase — nunca de um
// `user_id` no corpo. Nenhuma service role é usada. Extraída para ser testável.

export interface AuthenticatedRequest {
  readonly client: SupabaseClient<Database>;
  readonly userId: string;
}

/** Extrai o token de um header Authorization: Bearer, ou null. Puro. */
export function bearerToken(headers: { get(name: string): string | null }): string | null {
  const header = headers.get('authorization') ?? headers.get('Authorization');
  if (!header) return null;
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * Autentica a requisição. Com bearer, constrói o cliente com o token e valida-o
 * contra o GoTrue (`getUser(token)`); sem bearer, usa o cliente por cookie. Em
 * ambos, retorna `null` quando não há usuário — a rota responde 401.
 */
export async function authenticateRequest(request: Request): Promise<AuthenticatedRequest | null> {
  const token = bearerToken(request.headers);
  if (token) {
    const client = createBearerClient(token);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    return { client, userId: data.user.id };
  }
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) return null;
  return { client, userId: data.user.id };
}
