import { evaluateTechnicalApprovalReadiness, type WorkItem } from '@anima/core';
import { includedScopeAnchoredInProject, safeValidationCommand } from '@/lib/ai/project-work-planner-shared';

export type ApprovalReadiness = { readonly status: 'READY' } | { readonly status: 'NOT_READY'; readonly issues: readonly string[] };
export type ExecutionReadiness =
  | { readonly status: 'READY' }
  | { readonly status: 'BLOCKED_BY_DEPENDENCY'; readonly workItemIds: readonly string[] }
  | { readonly status: 'NOT_READY'; readonly issues: readonly string[] };

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const strings = (value: unknown): readonly string[] | null =>
  Array.isArray(value) && value.every(entry => typeof entry === 'string') ? value : null;
const localBackends = new Set(['ollama', 'deepseek-harness', 'scripted']);

/** Readiness read-only da proposta vigente. Não aprova nem executa: apenas prova
 * que o envelope técnico está pronto para ser apresentado ao humano. */
export function evaluateWorkProposalReadiness(input: {
  readonly item: WorkItem;
  readonly knownItems: readonly WorkItem[];
  readonly repoRoot?: string;
}): { readonly approval: ApprovalReadiness; readonly execution: ExecutionReadiness } {
  const issues: string[] = [];
  if (input.item.state !== 'proposed') issues.push('item_not_proposed');
  const base = evaluateTechnicalApprovalReadiness(input.item);
  if (!base.eligible) issues.push(...base.gaps.map(gap => gap.code));

  const intent = object(input.item.intent);
  const spec = object(intent?.execution_spec);
  if (!spec) issues.push('execution_spec_missing');
  else {
    if (spec.executor !== 'worktree') issues.push('executor_not_worktree');
    if (typeof spec.coder_backend !== 'string' || !localBackends.has(spec.coder_backend)) issues.push('coder_backend_not_local');
    if (typeof spec.base_sha !== 'string' || !/^[0-9a-f]{40}$/i.test(spec.base_sha)) issues.push('base_sha_invalid');
    const permissions = strings(spec.permissions);
    if (!permissions || permissions.length !== 2 || !permissions.includes('workspace_read') || !permissions.includes('workspace_write_isolated')) issues.push('permissions_not_isolated');
    const criteria = Array.isArray(spec.validation_criteria) ? spec.validation_criteria : [];
    if (!criteria.length || criteria.some(entry => {
      const criterion = object(entry); return typeof criterion?.command !== 'string' || !safeValidationCommand(criterion.command);
    })) issues.push('validation_commands_unsafe');
  }

  if (!includedScopeAnchoredInProject(input.item.proposal.data.includedScope, input.repoRoot)) issues.push('scope_not_anchored');
  const uniqueIssues = [...new Set(issues)];
  if (uniqueIssues.length) return { approval: { status: 'NOT_READY', issues: uniqueIssues }, execution: { status: 'NOT_READY', issues: uniqueIssues } };

  const dependencies = base.eligible ? base.spec.dependsOnWorkItemIds : [];
  const known = new Map(input.knownItems.map(item => [item.id, item]));
  const invalid = dependencies.filter(id => id === input.item.id || !known.has(id));
  if (invalid.length) {
    const dependencyIssues = invalid.map(id => `dependency_invalid:${id}`);
    return { approval: { status: 'NOT_READY', issues: dependencyIssues }, execution: { status: 'NOT_READY', issues: dependencyIssues } };
  }
  const pending = dependencies.filter(id => known.get(id)?.state !== 'completed');
  return {
    approval: { status: 'READY' },
    execution: pending.length ? { status: 'BLOCKED_BY_DEPENDENCY', workItemIds: pending } : { status: 'READY' },
  };
}

