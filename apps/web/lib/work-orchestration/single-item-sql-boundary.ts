import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Código estável do gate: preservado de propósito (CLI, documentos e consumidores o conhecem). */
export const SINGLE_ITEM_SQL_BOUNDARY_REFUSAL = 'single_item_atomic_claim_unavailable';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Gate fail-closed da fronteira SQL scoped, sem env/flag de bypass.
 *
 * Substitui a recusa incondicional anterior (removida após a promoção ao residente em 2026-10-13 e
 * a prova funcional registrada em `docs/registros/2026-10-13-single-item-promocao-residente.md`).
 * A autoridade continua sendo do banco: o gate só observa se o contrato REAL da RPC está presente.
 *
 * Sonda SEM EFEITOS: chama `acquire_single_item_work_claim` com argumentos deliberadamente
 * inválidos (owner em branco, lease 0, item nil inexistente). Na RPC instalada a validação de
 * entrada ocorre antes de qualquer leitura de item, lock ou escrita (e depois de `auth.uid()` e da
 * allowlist); a resposta exata `22023 invalid claim request` prova, ao mesmo tempo, que a função
 * existe com os argumentos nomeados esperados, que o chamador tem EXECUTE e que está autenticado e
 * habilitado. Qualquer outra coisa — RPC ausente ou com outra assinatura (PGRST202), permissão
 * negada, sem sessão, fora da allowlist, sucesso inesperado, outro erro, rejeição de rede ou
 * exceção — recusa. Mesmo um corpo incompatível não escreveria nada: o item nil não existe.
 *
 * Limite: o cliente não enxerga o corpo das funções nem o ledger; a versão instalada continua
 * dependendo da promoção registrada e do catálogo verificado pelo operador. Mocks Jest não são
 * a prova SQL.
 */
export async function singleItemSqlBoundaryRefusal(
  client: Pick<SupabaseClient<Database>, 'rpc'>,
): Promise<string | null> {
  try {
    const probe = await client.rpc('acquire_single_item_work_claim', {
      work_item_id: NIL_UUID,
      expected_proposal_version: 1,
      claim_id: NIL_UUID,
      owner_instance_id: '',
      lease_seconds: 0,
    });
    const error = probe.error;
    if (error && error.code === '22023' && error.message === 'invalid claim request') return null;
  } catch {
    // Indisponível ou inesperado: o gate permanece fechado.
  }
  return SINGLE_ITEM_SQL_BOUNDARY_REFUSAL;
}

/** Mensagem comum dos consumidores quando o gate recusa. */
export const SINGLE_ITEM_SQL_BOUNDARY_MESSAGE =
  'A fronteira SQL scoped não está disponível ou compatível no residente; execução bloqueada, sem fallback.';

/** Escolha de RPC não concede autoridade: versão/owner/locks são do banco. */
export function workClaimRpc(singleItem: boolean): 'acquire_single_item_work_claim' | 'acquire_work_claim' {
  return singleItem ? 'acquire_single_item_work_claim' : 'acquire_work_claim';
}
