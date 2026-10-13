import { singleItemContractRefusal, singleItemExecutionRefusal } from './single-item-execution';
import type { WorkItem } from './types';

test.each(['ollama'])('backend explícito %s permitido pela fronteira de contrato', backend => {
  expect(singleItemContractRefusal({ execution_spec: { coder_backend: backend } })).toBeNull();
});
test.each([null, [], 'text', {}, { execution_spec: [] }])('contrato malformado %j falha fechado', intent => {
  expect(singleItemContractRefusal(intent)).not.toBeNull();
});
test.each(['openai', 'deepseek-harness', 'claude-code', null, undefined])('backend %s não vira default local', backend => {
  expect(singleItemContractRefusal({ execution_spec: { coder_backend: backend } })).toBe('single_item_compute_not_allowed');
});
test.each([null, {}, { commit_sha: 'invalid' }])('checkpoint %j não vira nova attempt', checkpoint => {
  expect(singleItemContractRefusal({ execution_spec: { coder_backend: 'ollama', resume_from_checkpoint: checkpoint } })).toBe('single_item_resumption_unproved');
});
test('UUID e versão distintos não conferem autoridade', () => {
  const id = 'aa6b3d64-1e0b-414d-984d-5264b9c89968';
  const item = { id, proposalVersion: 2, state: 'approved' } as WorkItem;
  expect(singleItemExecutionRefusal({ workItemId: id, expectedProposalVersion: 1 }, item)).toBe('single_item_version_changed');
  expect(singleItemExecutionRefusal({ workItemId: '41f80b3a-2043-4e2f-8c67-0c62aa795bda', expectedProposalVersion: 2 }, item)).toBe('single_item_identity_invalid');
});

test('Codex exige executor e modelo explícitos; autenticação é comprovada no host', () => {
  expect(singleItemContractRefusal({ execution_spec: { coder_backend: 'codex-cli' } })).toBe('single_item_codex_contract_invalid');
  expect(singleItemContractRefusal({ execution_spec: { coder_backend: 'codex-cli', model: 'default', executor: 'worktree' } })).toBeNull();
  expect(singleItemContractRefusal({ execution_spec: { coder_backend: 'codex-cli', model: 'other', executor: 'worktree' } })).toBe('single_item_codex_contract_invalid');
});
