import type { AutonomousExecutionSpecV1, WorkItem, WorkContextReference } from '@anima/core';
import { buildExecutorRequest } from './execution';

const spec: AutonomousExecutionSpecV1 = {
  schemaVersion: 1, target: { kind: 'project', reference: 'anima' }, permissions: ['workspace_read'],
  validationCriteria: [{ label: 'Evidências do snapshot' }], limits: { maxAttempts: 1, maxDurationMinutes: 30 }, dependsOnWorkItemIds: [],
};
const item: WorkItem = {
  id: 'work', userId: 'user', sourceMessageId: 'message', state: 'approved', impactLevel: 'low', capability: 'architecture',
  originalRequest: 'Investigar', intent: { execution_spec: { effect_class: 'read_only', verifier_requirement: 'advisory' } },
  proposalVersion: 2, createdAt: new Date(0), updatedAt: new Date(0),
  proposal: { schemaVersion: 1, data: { summary: 'Investigar', objective: 'Reconstruir o contrato', includedScope: ['docs'],
    excludedScope: ['supabase'], expectedEffects: ['Findings'], risks: ['Incerteza'] } },
};
const contextReferences: readonly WorkContextReference[] = [{ kind: 'message', id: 'source-message' }];

test('request usa a classe do intent aprovado e preserva escopo, permissões e limites', () => {
  const request = buildExecutorRequest({ item, spec, attemptId: 'attempt', contextReferences });
  expect(request).toMatchObject({ effectClass: 'read_only', approvedProposalVersion: 2, capability: 'architecture',
    objective: item.proposal.data.objective, taskSpec: { verifierRequirement: 'advisory' } });
  expect(request.includedScope).toBe(item.proposal.data.includedScope);
  expect(request.excludedScope).toBe(item.proposal.data.excludedScope);
  expect(request.permissions).toBe(spec.permissions);
  expect(request.limits).toBe(spec.limits);
  expect(request.validationCriteria).toBe(spec.validationCriteria);
  expect(request.contextReferences).toBe(contextReferences);
  expect(request.taskSpec.contextReferences).toEqual(contextReferences);
});

test('permissão de leitura não infere classe para itens legados', () => {
  const request = buildExecutorRequest({ item: { ...item, intent: { execution_spec: { verifier_requirement: 'advisory' } } }, spec, attemptId: 'attempt', contextReferences });
  expect(request).not.toHaveProperty('effectClass');
  expect(request.permissions).toEqual(['workspace_read']);
});

test('classe desconhecida nunca é projetada como read_only', () => {
  const request = buildExecutorRequest({ item: { ...item, intent: { execution_spec: { effect_class: 'unknown' } } }, spec, attemptId: 'attempt', contextReferences });
  expect(request).not.toHaveProperty('effectClass');
});
