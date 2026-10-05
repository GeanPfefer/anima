/** @jest-environment node */
import { resolve } from 'node:path';
import { Constants } from '@anima/types';
import { ScriptedCoderBackend } from './coder-backend';
import { InvestigationExecutorAdapter } from './investigation-executor';
import { readExecutionContract, resolveExecutorRoute, INVESTIGATION_EXECUTOR_ID, type ExecutionContract } from './executor-selection';

const repoRoot = resolve(__dirname, '../../../..');
const spec = {
  effect_class: 'read_only', executor: INVESTIGATION_EXECUTOR_ID, coder_backend: 'codex-cli',
  base_sha: 'a'.repeat(40), target: { kind: 'project', reference: 'anima' }, permissions: ['workspace_read'],
};
const contract = (patch: Record<string, unknown> = {}) => readExecutionContract({ execution_spec: { ...spec, ...patch } });
const select = (patch: Record<string, unknown> = {}) => resolveExecutorRoute(contract(patch), { repoRoot });

test.each([undefined, 'default'])('seleciona investigação codex-cli com modelo %s e todas as capabilities', model => {
  const selected = select({ model });
  expect(selected.ok).toBe(true);
  if (!selected.ok) throw new Error(selected.error.message);
  expect(selected.route.adapter).toBeInstanceOf(InvestigationExecutorAdapter);
  expect(selected.route.candidate).toMatchObject({ routeId: 'investigation-v1:configured', executorId: INVESTIGATION_EXECUTOR_ID,
    providerRef: 'codex-cli', modelRef: 'codex-cli:default', effort: 'strong', availability: 'available',
    capabilities: [...Constants.public.Enums.work_capability] });
});

test.each([
  [{ effect_class: 'unknown' }, 'effect_class_invalid'],
  [{ effect_class: 'mutating' }, 'effect_class_invalid'],
  [{ effect_class: null }, 'effect_class_invalid'],
  [{ effect_class: undefined }, 'investigation_requires_read_only'],
  [{ executor: 'worktree' }, 'read_only_executor_invalid'],
  [{ executor: null }, 'read_only_executor_invalid'],
  [{ permissions: [] }, 'read_only_permissions_invalid'],
  [{ permissions: ['workspace_read', 'workspace_write_isolated'] }, 'read_only_permissions_invalid'],
  [{ permissions: ['workspace_read', 3] }, 'read_only_permissions_invalid'],
  [{ permissions: ['workspace_read', 'workspace_read'] }, 'read_only_permissions_invalid'],
  [{ permissions: undefined }, 'read_only_permissions_invalid'],
  [{ model: 'gpt-custom' }, 'investigation_model_invalid'],
  [{ model: null }, 'investigation_model_invalid'],
  [{ model: '' }, 'investigation_model_invalid'],
  [{ base_sha: 'bad' }, 'investigation_base_sha_invalid'],
  [{ base_sha: null }, 'investigation_base_sha_invalid'],
  [{ target: { kind: 'workspace', reference: 'anima' } }, 'investigation_target_invalid'],
  [{ target: { kind: 'project', reference: 'other' } }, 'investigation_target_invalid'],
] as const)('falha fechado para %j', (patch, code) => {
  expect(select(patch)).toMatchObject({ ok: false, error: { code } });
});

test.each([null, 'ollama', 'openai', 'deepseek-harness', 'deepseek', 'claude-code'])('recusa backend %s sem fallback', coder_backend => {
  expect(select({ coder_backend })).toMatchObject({ ok: false, error: { code: 'read_only_profile_unsupported' } });
});

test('recusa raiz inválida mesmo com contrato coerente', () => {
  expect(resolveExecutorRoute(contract(), { repoRoot: resolve(repoRoot, 'apps') })).toMatchObject({ ok: false, error: { code: 'project_root_invalid' } });
});

test('campos opcionais preservam a rota mutante legada', () => {
  const legacy: ExecutionContract = { executor: 'worktree', coderBackend: 'ollama', model: null,
    baseSha: spec.base_sha, targetKind: 'project', targetReference: 'anima', resumeCheckpointCommitSha: null };
  const result = resolveExecutorRoute(legacy, { repoRoot, backendOverride: new ScriptedCoderBackend([]) });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.route.candidate).toMatchObject({ routeId: 'worktree-v1:configured', capabilities: ['programming'] });
  expect(resolveExecutorRoute({ ...legacy, effectClass: 'mutating', executor: INVESTIGATION_EXECUTOR_ID }, { repoRoot }))
    .toMatchObject({ ok: false, error: { code: 'investigation_requires_read_only' } });
});

test('leitura preserva permissões e distingue ausência de classe inválida', () => {
  expect(contract()).toMatchObject({ effectClass: 'read_only', permissions: ['workspace_read'] });
  expect(contract({ effect_class: 'typo' }).effectClass).toBe('invalid');
  expect(contract({ effect_class: undefined }).effectClass ?? 'mutating').toBe('mutating');
});
