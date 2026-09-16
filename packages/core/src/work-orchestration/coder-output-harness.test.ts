import {
  CANONICAL_CODER_HARNESS_POLICY_V1,
  DEFAULT_CODER_HARNESS_POLICY_V1,
  combineCoderHarnessViolations,
  describeCoderHarnessViolations,
  matchIncompatibleRunner,
  parseForbiddenBackendSource,
  renderCoderHarnessPolicyInstructions,
  resolveEffectiveCoderHarnessPolicy,
  type CoderHarnessViolationV1,
} from './coder-output-harness';

describe('política canônica é a autoridade mínima', () => {
  test('canônica exige Jest e proíbe vitest / entry.coderBackend', () => {
    expect(CANONICAL_CODER_HARNESS_POLICY_V1).toEqual({
      schemaVersion: 1,
      canonicalTestRunner: 'jest',
      incompatibleTestRunners: ['vitest'],
      forbiddenBackendSources: ['entry.coderBackend'],
    });
  });

  test('o default É a política canônica (não há default mais fraco)', () => {
    expect(DEFAULT_CODER_HARNESS_POLICY_V1).toBe(CANONICAL_CODER_HARNESS_POLICY_V1);
  });
});

describe('resolveEffectiveCoderHarnessPolicy — não pode ser enfraquecida (fail-closed)', () => {
  test('sem override ⇒ política canônica', () => {
    expect(resolveEffectiveCoderHarnessPolicy()).toEqual(CANONICAL_CODER_HARNESS_POLICY_V1);
    expect(resolveEffectiveCoderHarnessPolicy(null)).toEqual(CANONICAL_CODER_HARNESS_POLICY_V1);
  });

  test('override com listas VAZIAS não desliga o gate: canônicas permanecem', () => {
    const eff = resolveEffectiveCoderHarnessPolicy({ incompatibleTestRunners: [], forbiddenBackendSources: [] });
    expect(eff.incompatibleTestRunners).toContain('vitest');
    expect(eff.forbiddenBackendSources).toContain('entry.coderBackend');
    expect(eff.canonicalTestRunner).toBe('jest');
  });

  test('override só ENDURECE (união): adiciona runners/fontes sem remover as canônicas', () => {
    const eff = resolveEffectiveCoderHarnessPolicy({
      incompatibleTestRunners: ['mocha', 'vitest'],
      forbiddenBackendSources: ['queue.coderBackend'],
    });
    expect(new Set(eff.incompatibleTestRunners)).toEqual(new Set(['vitest', 'mocha']));
    expect(new Set(eff.forbiddenBackendSources)).toEqual(new Set(['entry.coderBackend', 'queue.coderBackend']));
  });

  test('tentativa de trocar o runner canônico é ignorada (jest permanece)', () => {
    // @ts-expect-error — caller malicioso tentando forçar outro runner canônico
    const eff = resolveEffectiveCoderHarnessPolicy({ canonicalTestRunner: 'vitest' });
    expect(eff.canonicalTestRunner).toBe('jest');
  });
});

describe('helpers puros', () => {
  test('matchIncompatibleRunner: exato e subpath', () => {
    expect(matchIncompatibleRunner('vitest', ['vitest'])).toBe('vitest');
    expect(matchIncompatibleRunner('vitest/config', ['vitest'])).toBe('vitest');
    expect(matchIncompatibleRunner('vitestx', ['vitest'])).toBeNull();
    expect(matchIncompatibleRunner('@jest/globals', ['vitest'])).toBeNull();
  });

  test('parseForbiddenBackendSource decompõe IDENT.PROP', () => {
    expect(parseForbiddenBackendSource('entry.coderBackend')).toEqual({ object: 'entry', property: 'coderBackend', raw: 'entry.coderBackend' });
    expect(parseForbiddenBackendSource('entry')).toBeNull();
    expect(parseForbiddenBackendSource('a.b.c')).toBeNull();
  });

  test('combineCoderHarnessViolations: ok só sem violações; nunca mascara', () => {
    expect(combineCoderHarnessViolations([]).ok).toBe(true);
    const v: CoderHarnessViolationV1[] = [{ kind: 'incompatible_test_runner', path: 'a.ts', importedRunner: 'vitest', requiredRunner: 'jest', line: 1 }];
    expect(combineCoderHarnessViolations(v)).toEqual({ ok: false, violations: v });
  });

  test('describeCoderHarnessViolations produz texto seguro (caminho:linha + tokens do contrato)', () => {
    const msg = describeCoderHarnessViolations([
      { kind: 'incompatible_test_runner', path: 'x.test.ts', importedRunner: 'vitest', requiredRunner: 'jest', line: 1 },
      { kind: 'non_authoritative_backend_source', path: 'y.ts', expression: 'entry.coderBackend', line: 2 },
    ]);
    expect(msg).toContain('x.test.ts:1 importa runner de teste incompatível "vitest"');
    expect(msg).toContain('y.ts:2 lê o backend do coder de fonte não autoritativa "entry.coderBackend"');
  });
});

describe('renderCoderHarnessPolicyInstructions — texto pré-inferência compartilhado', () => {
  test('inclui os cinco pontos exigidos, derivados da política', () => {
    const text = renderCoderHarnessPolicyInstructions(CANONICAL_CODER_HARNESS_POLICY_V1);
    expect(text).toContain('Runner de teste canônico deste workspace: jest');
    expect(text).toContain('vitest');
    expect(text.toLowerCase()).toContain('intent');
    expect(text).toContain('contract.coderBackend');
    expect(text).toContain('computeDecision.selectedProvider');
    expect(text).toContain('entry.coderBackend');
  });

  test('reflete endurecimento: runners/fontes extras aparecem no texto', () => {
    const eff = resolveEffectiveCoderHarnessPolicy({ incompatibleTestRunners: ['mocha'], forbiddenBackendSources: ['queue.coderBackend'] });
    const text = renderCoderHarnessPolicyInstructions(eff);
    expect(text).toContain('mocha');
    expect(text).toContain('queue.coderBackend');
  });
});
