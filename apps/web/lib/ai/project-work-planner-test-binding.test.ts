/** @jest-environment node */
jest.mock('@/lib/work-orchestration/executor-selection', () => ({
  projectRoot: () => require('node:path').resolve(__dirname, '../../../..'),
  readAuthorizedBaseSha: async () => 'a'.repeat(40),
}));
jest.mock('@anima/core', () => ({ __esModule: true, ...jest.requireActual('@anima/core') }));
import * as core from '@anima/core';
import { evaluateAutonomousEligibility, lintAcceptanceContract, readAutonomousExecutionSpec, type CreateWorkProposalCommand, type WorkItem } from '@anima/core';
import { planExecutableProjectWork, planExecutableProjectWorkRevision } from './project-work-planner';

const file = 'apps/web/lib/ai/project-work-planner-env.test.ts';
const binding = { label: 'Comportamento demonstrado', covers: ['Comportamento correto'], test_files: [file], min_new_tests: 1, bound_tests: [] };
const args = (over: Record<string, unknown> = {}) => ({
  summary: 'Ajustar comportamento', objective: 'Demonstrar comportamento concreto',
  included_scope: [file], excluded_scope: ['Não alterar banco'], risks: ['Regressão'],
  expected_effects: ['Gate passa', 'Comportamento correto'], validation_label: 'Typecheck',
  validation_command: 'npm run typecheck --workspace=apps/web', validation_covers: ['Gate passa'],
  validation_claim_kind: 'gate_assertion', test_bindings: [binding], human_review_effects: [], ...over,
});
const base: CreateWorkProposalCommand = { sourceMessageId: 'mensagem', impactLevel: 'significant', capability: 'planning',
  intent: {}, proposal: { schemaVersion: 1, data: { summary: 'Resumo', objective: 'Objetivo', includedScope: ['arquivo'], excludedScope: ['Banco'], expectedEffects: ['Efeito'], risks: ['Risco'] } } };
const plan = (over: Record<string, unknown> = {}) => planExecutableProjectWork('Implementar', base, {
  id: 'simulado', proposeArguments: async () => ({ ok: true, rawArguments: JSON.stringify(args(over)) }),
});
async function command(over: Record<string, unknown> = {}) {
  const result = await plan(over);
  if (!result.ok) throw new Error(result.message);
  return result.command;
}
const spec = (value: CreateWorkProposalCommand) => readAutonomousExecutionSpec(value.intent)!;
const item = (value: CreateWorkProposalCommand): WorkItem => ({ ...value, id: 'item', userId: 'usuário', state: 'approved', originalRequest: 'Implementar', proposalVersion: 1, createdAt: new Date(0), updatedAt: new Date(0) });

test('Monta prova funcional no aplicativo web', async () => {
  expect(spec(await command()).validationCriteria[1]).toEqual({ label: binding.label, proof: 'gate', claimKind: 'test_binding', covers: binding.covers,
    targetPaths: [file], command: 'npm test --workspace=apps/web -- lib/ai/project-work-planner-env.test.ts', binding: { testFiles: [file], minNewTests: 1 } });
});
test('Usa caminho relativo no workspace do domínio', async () => {
  const coreFile = 'packages/core/src/exemplo.test.ts';
  expect(spec(await command({ included_scope: [coreFile], test_bindings: [{ ...binding, test_files: [coreFile] }] })).validationCriteria[1]?.command)
    .toBe('npm test --workspace=packages/core -- src/exemplo.test.ts');
});
test('Preserva alvos exatos da prova declarada', async () => {
  expect(spec(await command()).validationCriteria[1]?.targetPaths).toEqual(binding.test_files);
});
test('Inclui versão de aceite para prova funcional', async () => {
  expect((await command()).intent.execution_spec).toMatchObject({ acceptance_contract: 2 });
});
test('Omite versão de aceite no planejamento anterior', async () => {
  const value = await command({ test_bindings: [], human_review_effects: [], expected_effects: ['Gate passa'] });
  expect(value.intent.execution_spec).not.toHaveProperty('acceptance_contract');
  const legacy = await command({ test_bindings: undefined, human_review_effects: undefined, expected_effects: ['Gate passa'] });
  expect(JSON.stringify(value)).toBe(JSON.stringify(legacy));
});
test('Monta revisão humana sem comando executável', async () => {
  const value = await command({ test_bindings: [], human_review_effects: ['Comportamento correto'] });
  expect(spec(value).validationCriteria[1]).toEqual({ label: 'Revisão humana: Comportamento correto', proof: 'human_review', covers: ['Comportamento correto'] });
  expect(value.intent.execution_spec).toMatchObject({ acceptance_contract: 2 });
});
test('Recusa afirmação substantiva sem demonstração', async () => {
  expect(await plan({ validation_claim_kind: 'substantive' })).toMatchObject({ ok: false, message: expect.stringContaining('substantive_gate_without_proof') });
});
test('Recusa arquivo fora da superfície autorizada', async () => {
  expect(await plan({ included_scope: ['apps/web/lib/ai/project-work-planner.ts'] })).toMatchObject({ ok: false, message: expect.stringContaining('test_file_outside_scope') });
});
test('Recusa vínculo a arquivo ainda ausente', async () => {
  const absent = 'apps/web/lib/ai/arquivo-ainda-ausente.test.ts';
  expect(await plan({ included_scope: [absent], test_bindings: [{ ...binding, test_files: [absent], bound_tests: [{ file: absent, full_name: 'Comportamento concreto' }] }] }))
    .toMatchObject({ ok: false, message: expect.stringContaining('bound_test_file_missing') });
});
test('Recusa superfície com workspaces diferentes', async () => {
  expect(await plan({ included_scope: [file, 'packages/core/src/exemplo.ts'] })).toMatchObject({ ok: false, message: expect.stringContaining('test_binding_workspace_ambiguous') });
});
test('Obtém contrato elegível sem achados de cobertura', async () => {
  const value = await command();
  expect(evaluateAutonomousEligibility(item(value)).eligible).toBe(true);
  expect(lintAcceptanceContract(value.proposal.data.expectedEffects, spec(value).validationCriteria)).toEqual([]);
});
test('Reconstrói prova funcional durante revisão da proposta', async () => {
  const previous = item(await command({ test_bindings: [], expected_effects: ['Gate passa'] }));
  const result = await planExecutableProjectWorkRevision(previous, 'Demonstrar comportamento', {
    id: 'simulado', proposeArguments: async () => ({ ok: true, rawArguments: JSON.stringify(args()) }),
  });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.revision.intent.execution_spec).toMatchObject({ acceptance_contract: 2 });
});
test('Aceita vínculo declarado em arquivo já existente', async () => {
  const value = await command({ test_bindings: [{ ...binding, min_new_tests: 0, bound_tests: [{ file, full_name: 'Comportamento existente' }] }] });
  expect(spec(value).validationCriteria[1]?.binding?.boundTests).toEqual([{ file, fullName: 'Comportamento existente' }]);
});

test('Recusa achado de lint após montar o contrato', async () => {
  const lint = jest.spyOn(core, 'lintAcceptanceContract').mockReturnValue([{ code: 'no_automated_proof', detail: 'Simulado' }]);
  try { expect(await plan()).toMatchObject({ ok: false, message: expect.stringContaining('no_automated_proof') }); }
  finally { lint.mockRestore(); }
});
test('Recusa lacuna de elegibilidade após montar o contrato', async () => {
  const eligibility = jest.spyOn(core, 'evaluateAutonomousEligibility').mockReturnValue({ eligible: false,
    gaps: [{ code: 'execution_spec_invalid', requirement: 'AUTO-01', explanation: 'Simulado' }] });
  try { expect(await plan()).toMatchObject({ ok: false, message: expect.stringContaining('execution_spec_invalid') }); }
  finally { eligibility.mockRestore(); }
});
