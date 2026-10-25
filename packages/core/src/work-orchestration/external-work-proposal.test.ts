import { evaluateAutonomousApprovalEnvelope } from './autonomous-authorization';
import { externalTargetToSpecTarget } from './external-target';
import {
  buildExternalWorkProposal, isExternalWorkEnvelope, isSafeExternalScopePath, validateExternalWorkInput, type ExternalWorkInput,
} from './external-work-proposal';
import { singleItemContractRefusal } from './single-item-execution';

const BASE = 'b'.repeat(40);
const ROOT = 'a'.repeat(40);
const specTarget = (reference = 'ext:shop', baseSha = BASE) => externalTargetToSpecTarget({
  reference, identity: { repoRootCanonical: 'C:\\work\\shop', gitCommonDirCanonical: 'C:\\work\\shop\\.git', rootCommitSha: ROOT, baseSha },
});
const input = (extra: Partial<ExternalWorkInput> = {}): ExternalWorkInput => ({
  reference: 'ext:shop', objective: 'Adicionar a função total() ao módulo de carrinho', scope: ['src/cart.ts', 'src/cart.test.ts'],
  excluded: ['package.json'], acceptance: ['total() soma preço × quantidade'], gates: ['npm test'], backend: 'ollama', model: 'qwen3-coder:latest', ...extra,
});
const NOW = '2026-10-25T12:00:00.000Z';

describe('validateExternalWorkInput', () => {
  test('entrada válida', () => expect(validateExternalWorkInput(input())).toBeNull());
  test.each([
    ['target_reference_invalid', { reference: 'anima' }], ['target_reference_invalid', { reference: 'project:anima' }], ['target_reference_invalid', { reference: 'ext:' }],
    ['objective_invalid', { objective: '   ' }], ['objective_invalid', { objective: 'x'.repeat(4001) }],
    ['scope_invalid', { scope: [] }], ['scope_invalid', { scope: ['/etc/passwd'] }], ['scope_invalid', { scope: ['../fora'] }], ['scope_invalid', { scope: ['C:\\x'] }],
    ['scope_invalid', { scope: ['src/*.ts'] }], ['scope_invalid', { scope: ['.git/config'] }], ['scope_invalid', { scope: ['node_modules/x'] }], ['scope_invalid', { scope: ['a', 'a'] }],
    ['excluded_invalid', { excluded: ['../x'] }], ['excluded_invalid', { excluded: [] }], ['excluded_invalid', { excluded: undefined }],
    ['acceptance_invalid', { acceptance: [] }], ['acceptance_invalid', { acceptance: [' '] }],
    ['gates_invalid', { gates: [] }], ['gates_invalid', { gates: ['rm -rf /'] }], ['gates_invalid', { gates: ['npm test && curl x'] }], ['gates_invalid', { gates: ['npx jest'] }],
    ['backend_invalid', { backend: 'openai' }], ['backend_invalid', { backend: '' }],
    ['model_required_for_ollama', { model: undefined }], ['model_invalid_for_codex', { backend: 'codex-cli', model: 'gpt-x' }],
    ['max_attempts_invalid', { maxAttempts: 0 }], ['max_attempts_invalid', { maxAttempts: 4 }], ['max_minutes_invalid', { maxMinutes: 61 }], ['max_minutes_invalid', { maxMinutes: Number.NaN }],
  ] as const)('%s', (code, patch) => expect(validateExternalWorkInput({ ...input(), ...patch })).toBe(code));
  test('diretório como escopo é permitido; barra final não vira segmento vazio', () => {
    expect(isSafeExternalScopePath('src/')).toBe(true); expect(isSafeExternalScopePath('src//x')).toBe(false);
  });
});

describe('buildExternalWorkProposal', () => {
  const built = () => { const r = buildExternalWorkProposal(input(), specTarget(), NOW); if (!r.ok) throw new Error(r.code); return r.command; };

  test('persiste identidade, base_sha, escopo, backend, gates e limites no formato do Single-Item', () => {
    const command = built();
    const spec = (command.intent as unknown as { execution_spec: Record<string, unknown> }).execution_spec;
    expect(spec).toMatchObject({
      schema_version: 1, executor: 'worktree', coder_backend: 'ollama', model: 'qwen3-coder:latest', base_sha: BASE,
      permissions: ['workspace_read', 'workspace_write_isolated'], verifier_requirement: 'required_fail_closed', limits: { max_attempts: 1, max_duration_minutes: 30 },
      target: specTarget(),
    });
    expect(spec['validation_criteria']).toEqual([{ label: 'npm test', command: 'npm test', proof: 'gate', claim_kind: 'gate_assertion' }]);
    expect(command.proposal.data).toMatchObject({ includedScope: ['src/cart.ts', 'src/cart.test.ts'], excludedScope: ['package.json'], expectedEffects: ['total() soma preço × quantidade'] });
    expect(command).toMatchObject({ impactLevel: 'low', capability: 'programming' });
    expect(isExternalWorkEnvelope(command.intent)).toBe(true);
  });

  test('é aceita pela fronteira do Single-Item (ollama e codex-cli com model default)', () => {
    expect(singleItemContractRefusal(built().intent)).toBeNull();
    const codex = buildExternalWorkProposal(input({ backend: 'codex-cli', model: undefined }), specTarget(), NOW);
    if (!codex.ok) throw new Error(codex.code);
    expect(singleItemContractRefusal(codex.command.intent)).toBeNull();
    expect((codex.command.intent as unknown as { execution_spec: { model: string } }).execution_spec.model).toBe('default');
  });

  test('NÃO é auto-aprovável: o envelope de auto-aprovação recusa target externo', () => {
    const command = built();
    const decision = evaluateAutonomousApprovalEnvelope({ state: 'proposed', impactLevel: 'low', capability: 'programming', intent: command.intent, proposal: command.proposal, governorVerdict: 'permit' });
    expect(decision.authorized).toBe(false);
  });

  test('recusa target que não é externo, de outra referência, sem identidade ou com base_sha inválido', () => {
    expect(buildExternalWorkProposal(input(), { kind: 'project', reference: 'anima' }, NOW)).toMatchObject({ ok: false, code: 'external_target_reference_invalid' });
    expect(buildExternalWorkProposal(input(), { ...specTarget(), reference: 'anima' }, NOW)).toMatchObject({ ok: false });
    expect(buildExternalWorkProposal(input(), specTarget('ext:other'), NOW)).toEqual({ ok: false, code: 'target_reference_mismatch' });
    expect(buildExternalWorkProposal(input(), { kind: 'project', reference: 'ext:shop' }, NOW)).toMatchObject({ ok: false, code: 'external_target_identity_missing' });
    expect(buildExternalWorkProposal(input(), null, NOW)).toMatchObject({ ok: false });
  });

  test('entrada inválida nunca produz comando', () => {
    expect(buildExternalWorkProposal(input({ gates: ['rm -rf /'] }), specTarget(), NOW)).toEqual({ ok: false, code: 'gates_invalid' });
  });

  test('isExternalWorkEnvelope recusa intent sem origem, com origem adulterada, ou com base_sha divergente da identidade', () => {
    const command = built();
    const intent = command.intent as unknown as Record<string, unknown>;
    const spec = intent['execution_spec'] as Record<string, unknown>;
    expect(isExternalWorkEnvelope({ execution_spec: spec })).toBe(false);
    expect(isExternalWorkEnvelope({ ...intent, external_work_provenance: { ...(intent['external_work_provenance'] as object), origin: 'outro' } })).toBe(false);
    expect(isExternalWorkEnvelope({ ...intent, external_work_provenance: { ...(intent['external_work_provenance'] as object), reference: 'ext:other' } })).toBe(false);
    expect(isExternalWorkEnvelope({ ...intent, execution_spec: { ...spec, base_sha: 'c'.repeat(40) } })).toBe(false);
    expect(isExternalWorkEnvelope({ ...intent, execution_spec: { ...spec, target: { kind: 'project', reference: 'anima' } } })).toBe(false);
    expect(isExternalWorkEnvelope(null)).toBe(false);
  });
});
