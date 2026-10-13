import type { WorkItem } from './types';

/** Explicit authority for one invocation; never inferred from backlog/focus. */
export interface SingleItemExecution {
  readonly workItemId: string;
  readonly expectedProposalVersion: number;
}

export function isSingleItemExecution(value: SingleItemExecution): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.workItemId)
    && Number.isSafeInteger(value.expectedProposalVersion) && value.expectedProposalVersion > 0;
}

export function singleItemExecutionRefusal(scope: SingleItemExecution, item: WorkItem): string | null {
  if (!isSingleItemExecution(scope) || item.id !== scope.workItemId) return 'single_item_identity_invalid';
  if (item.proposalVersion !== scope.expectedProposalVersion) return 'single_item_version_changed';
  if (item.state !== 'approved') return 'single_item_not_approved';
  return null;
}

/** V1 estreita: nenhuma retomada implícita nem backend pago/por default. */
export function singleItemContractRefusal(intent: unknown): string | null {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return 'single_item_contract_invalid';
  const spec = (intent as Record<string, unknown>)['execution_spec'];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'single_item_contract_invalid';
  if ('resume_from_checkpoint' in spec) return 'single_item_resumption_unproved';
  const backend = (spec as Record<string, unknown>)['coder_backend'];
  // Autenticação/transporte são observados pelo host; o core não consulta env.
  if (backend === 'codex-cli' && ((spec as Record<string, unknown>)['model'] !== 'default'
    || (spec as Record<string, unknown>)['executor'] !== 'worktree')) {
    return 'single_item_codex_contract_invalid';
  }
  if (backend !== 'ollama' && backend !== 'codex-cli') {
    return 'single_item_compute_not_allowed';
  }
  return null;
}
