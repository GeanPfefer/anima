import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// ACC-01-FIX-02 — serviço mínimo de limpeza de foco para uso FUTURO.
//
// `clear_work_focus()` é uma RPC introduzida por migration aditiva que ainda NÃO está
// aplicada ao banco residente. Por isso a operação é protegida por flag explícita
// (`ANIMA_CLEAR_WORK_FOCUS_ENABLED=1`), desligada por padrão: sem a flag nenhuma chamada
// à RPC é feita. A RPC ainda não consta nos tipos gerados; a chamada é isolada aqui.
// ============================================================

export const isClearWorkFocusEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  env.ANIMA_CLEAR_WORK_FOCUS_ENABLED === '1';

export type ClearWorkFocusResult =
  | { readonly ok: true; readonly cleared: boolean }
  | { readonly ok: false; readonly code: 'not_enabled' | 'authentication_required' | 'orchestration_not_enabled' | 'unavailable' };

type UntypedRpc = (name: string) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;

export async function clearWorkFocus(
  client: SupabaseClient<Database>,
  env: Record<string, string | undefined> = process.env,
): Promise<ClearWorkFocusResult> {
  if (!isClearWorkFocusEnabled(env)) return { ok: false, code: 'not_enabled' };
  const { data, error } = await (client.rpc as unknown as UntypedRpc).call(client, 'clear_work_focus');
  if (error) {
    return { ok: false, code: error.code === '42501' ? 'orchestration_not_enabled' : 'unavailable' };
  }
  return { ok: true, cleared: data === true };
}
