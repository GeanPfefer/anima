import {
  evaluateAutonomousApprovalEnvelope,
  AUTONOMOUS_AUTHORIZATION_ENVELOPE_VERSION,
  RATIFIED_MATERIALIZATION_REASON,
  type AutonomousAuthorizationInput,
} from './autonomous-authorization';

// Um `intent`/`proposal` PERSISTIDOS exatamente como o materializer canônico ratificado os
// grava (execution_spec snake_case; canonical_provenance camelCase; proposal.data snake_case).
// Cada teste parte deste item VÁLIDO e viola UMA condição — provando o fail-closed tipado.
const validProvenance = {
  kind: 'canonical_backlog',
  sourceId: 'FIX-01',
  document: 'docs/registros/_fixtures/canonical-materialization-fixture.md',
  heading: 'FIX-01 — Criar arquivo de rascunho',
  canonicalObjective: 'Criar arquivo de rascunho',
  planningGeneration: 1,
  materializationReason: RATIFIED_MATERIALIZATION_REASON,
};

const validExecutionSpec = {
  schema_version: 1,
  target: { kind: 'project', reference: 'anima' },
  executor: 'worktree',
  coder_backend: 'ollama',
  model: 'qwen3-coder:latest',
  base_sha: 'c3242cccf828e377618e31ba0680184663b14d5f',
  permissions: ['workspace_read', 'workspace_write_isolated'],
  validation_criteria: [{ label: 'Criar arquivo', command: 'npm run build' }],
  limits: { max_attempts: 3, max_duration_minutes: 30 },
};

const validProposal = {
  schema_version: 1,
  data: {
    summary: 'Criar arquivo de rascunho.',
    objective: 'Criar arquivo de rascunho.',
    included_scope: ['docs/registros/_scratch-fixture-materializer.md'],
    excluded_scope: ['docs/registros'],
    expected_effects: ['O arquivo será criado.'],
    risks: [],
  },
};

const baseInput = (): AutonomousAuthorizationInput => ({
  state: 'proposed',
  impactLevel: 'low',
  capability: 'programming',
  intent: { canonical_provenance: { ...validProvenance }, execution_spec: { ...validExecutionSpec } },
  proposal: { schema_version: 1, data: { ...validProposal.data } },
  governorVerdict: 'permit',
});

// Auxiliar para clonar+patchar o execution_spec no intent sem mutar o base.
const withSpec = (patch: Record<string, unknown>): AutonomousAuthorizationInput => {
  const base = baseInput();
  return {
    ...base,
    intent: {
      canonical_provenance: { ...validProvenance },
      execution_spec: { ...validExecutionSpec, ...patch },
    },
  };
};

describe('evaluateAutonomousApprovalEnvelope — happy path', () => {
  test('item local canônico válido é AUTORIZADO com checks e sourceId', () => {
    const decision = evaluateAutonomousApprovalEnvelope(baseInput());
    expect(decision.authorized).toBe(true);
    if (!decision.authorized) throw new Error('esperava autorizado');
    expect(decision.envelopeVersion).toBe(AUTONOMOUS_AUTHORIZATION_ENVELOPE_VERSION);
    expect(decision.sourceId).toBe('FIX-01');
    expect(decision.checks).toContain('provenance_canonical_ratified');
    expect(decision.checks).toContain('permissions_isolated_workspace');
    expect(decision.checks).toContain('governor_permit');
  });
});

describe('evaluateAutonomousApprovalEnvelope — fail-closed por condição', () => {
  const expectFail = (input: AutonomousAuthorizationInput, reason: string): void => {
    const decision = evaluateAutonomousApprovalEnvelope(input);
    expect(decision.authorized).toBe(false);
    if (decision.authorized) throw new Error('esperava fail-closed');
    expect(decision.failClosedReason).toBe(reason);
  };

  test('estado não-proposed', () => expectFail({ ...baseInput(), state: 'approved' }, 'state_not_proposed'));

  test('proveniência ausente', () =>
    expectFail({ ...baseInput(), intent: { execution_spec: { ...validExecutionSpec } } }, 'provenance_missing_or_invalid'));

  test('materializationReason não ratificada (não veio do materializer canônico)', () =>
    expectFail(
      {
        ...baseInput(),
        intent: {
          canonical_provenance: { ...validProvenance, materializationReason: 'hand_written' },
          execution_spec: { ...validExecutionSpec },
        },
      },
      'provenance_reason_not_ratified',
    ));

  test('impacto não-low (efeito externo/estrutural)', () =>
    expectFail({ ...baseInput(), impactLevel: 'external' }, 'impact_not_low'));

  test('capacidade não-programming', () =>
    expectFail({ ...baseInput(), capability: 'organization' }, 'capability_not_programming'));

  test('execution_spec ausente', () =>
    expectFail({ ...baseInput(), intent: { canonical_provenance: { ...validProvenance } } }, 'execution_spec_missing'));

  test('target não é project:anima', () => expectFail(withSpec({ target: { kind: 'deploy', reference: 'prod' } }), 'target_not_project_anima'));

  test('executor não é worktree isolada', () => expectFail(withSpec({ executor: 'commanded' }), 'executor_not_worktree'));

  test('coder backend externo (openai) não é local autorizado', () =>
    expectFail(withSpec({ coder_backend: 'openai' }), 'coder_backend_not_local_authorized'));

  test('base_sha ausente', () => expectFail(withSpec({ base_sha: '   ' }), 'base_sha_missing'));

  test('permissões excedem o workspace isolado (efeito arbitrário)', () =>
    expectFail(withSpec({ permissions: ['workspace_read', 'network_access'] }), 'permissions_exceed_isolated_workspace'));

  test('validation_criteria ausente (sem gate)', () => expectFail(withSpec({ validation_criteria: [] }), 'validation_criteria_missing'));

  test('validation_criteria malformado', () =>
    expectFail(withSpec({ validation_criteria: [{ label: 'x', command: '' }] }), 'validation_criteria_malformed'));

  test('limites inválidos', () =>
    expectFail(withSpec({ limits: { max_attempts: 0, max_duration_minutes: 30 } }), 'limits_invalid'));

  test('included_scope ausente', () =>
    expectFail({ ...baseInput(), proposal: { schema_version: 1, data: { ...validProposal.data, included_scope: [] } } }, 'included_scope_missing'));

  test('included_scope com escape de caminho', () =>
    expectFail(
      { ...baseInput(), proposal: { schema_version: 1, data: { ...validProposal.data, included_scope: ['../etc/passwd'] } } },
      'unsafe_scope_path',
    ));

  test('included_scope tocando migrations (security-policy mutation)', () =>
    expectFail(
      { ...baseInput(), proposal: { schema_version: 1, data: { ...validProposal.data, included_scope: ['supabase/migrations/9999.sql'] } } },
      'security_sensitive_scope',
    ));

  test('included_scope tocando a própria policy de auto-aprovação', () =>
    expectFail(
      {
        ...baseInput(),
        proposal: {
          schema_version: 1,
          data: { ...validProposal.data, included_scope: ['packages/core/src/work-orchestration/autonomous-authorization.ts'] },
        },
      },
      'security_sensitive_scope',
    ));

  test('Governor não permite (defer)', () => expectFail({ ...baseInput(), governorVerdict: 'defer' }, 'governor_not_permit'));

  test('Governor fail_closed', () => expectFail({ ...baseInput(), governorVerdict: 'fail_closed' }, 'governor_not_permit'));
});

describe('evaluateAutonomousApprovalEnvelope — overrides', () => {
  test('backend local extra autorizado explicitamente passa', () => {
    const decision = evaluateAutonomousApprovalEnvelope({
      ...withSpec({ coder_backend: 'deepseek-harness' }),
      allowedLocalCoderBackends: ['ollama', 'deepseek-harness'],
    });
    expect(decision.authorized).toBe(true);
  });

  test('prefixo sensível adicional bloqueia o escopo', () => {
    const decision = evaluateAutonomousApprovalEnvelope({
      ...baseInput(),
      proposal: { schema_version: 1, data: { ...validProposal.data, included_scope: ['apps/web/lib/secret/x.ts'] } },
      securitySensitivePathPrefixes: ['apps/web/lib/secret'],
    });
    expect(decision.authorized).toBe(false);
  });
});
