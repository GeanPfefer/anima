import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readExecutionContract } from './executor-selection';

// ============================================================
// Fronteira a JUSANTE do target externo (Project Builder V0 — T1-R2).
//
// Integração, publicação de branch, review request, recuperação e aceite sob mandato operam sobre o repositório do Anima
// (`ANIMA_INTEGRATION_REPO_ROOT`/`ANIMA_TRUSTED_REPO_ROOT`/`projectRoot()`). Um item `ext:*` NUNCA pode ser levado a eles: o
// código de recusa é explícito e a checagem vem ANTES de qualquer efeito ou decisão. Suporte externo completo é incremento futuro.
// ============================================================

export const EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM = 'external_target_not_supported_downstream' as const;
export const EXTERNAL_TARGET_STATE_UNREADABLE = 'external_target_state_unreadable' as const;

/** Puro: o intent descreve um target externo (referência `ext:*` ou identidade pendurada)? */
export const externalTargetDownstreamRefusal = (intent: unknown): typeof EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM | null =>
  readExecutionContract(intent).targetSpec !== undefined ? EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM : null;

/** Lê o intent persistido do item. Não provar que NÃO é externo (leitura falhou) ⇒ recusa (fail-closed). */
export async function itemExternalTargetRefusal(
  client: SupabaseClient<Database>,
  workItemId: string,
): Promise<typeof EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM | typeof EXTERNAL_TARGET_STATE_UNREADABLE | null> {
  try {
    const row = await client.from('work_items').select('intent').eq('id', workItemId).single();
    if (row.error || !row.data) return EXTERNAL_TARGET_STATE_UNREADABLE;
    return externalTargetDownstreamRefusal(row.data.intent);
  } catch {
    return EXTERNAL_TARGET_STATE_UNREADABLE;
  }
}
