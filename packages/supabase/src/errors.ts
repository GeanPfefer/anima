import { failure, type WorkOperationResult } from '@anima/core';
export interface SupabaseFailure { code?: string; message?: string; details?: string; hint?: string }
export const mapSupabaseFailure = <T>(error: SupabaseFailure, mutation: boolean): WorkOperationResult<T> => {
  const message = (error.message ?? '').toLowerCase();
  if (error.code === 'P0002') return failure('work_item_not_found', 'Item de trabalho não encontrado.');
  if (error.code === '40001' || message.includes('proposal version')) return failure('version_conflict', 'O item mudou desde a última leitura.');
  if (error.code === '22023') return failure(message.includes('transition') ? 'invalid_transition' : 'invalid_input', 'A operação não é válida no estado atual.');
  if (error.code === '42501') {
    if (message.includes('authentication')) return failure('authentication_required', 'Autenticação necessária.');
    if (message.includes('allowlist') || message.includes('enabled')) return failure('orchestration_not_enabled', 'Orquestração não habilitada.');
    if (message.includes('source') || message.includes('message')) return failure('source_message_not_eligible', 'Mensagem de origem não elegível.');
    return failure('permission_denied', 'Operação não permitida.');
  }
  if (mutation && !error.code) return failure('ambiguous_outcome', 'Não foi possível confirmar o resultado. Reconcilie antes de repetir.', false, error);
  return failure('persistence_failure', 'Não foi possível acessar a orquestração.', true, error);
};
