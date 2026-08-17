import {
  buildWorkloadCostObservation,
  findWorkloadCostProfile,
  projectWorkloadCostProfiles,
  workloadKeyString,
  type WorkloadCostObservationV1,
  type WorkloadKind,
  type WorkloadOutcome,
} from './index';

const obs = (over: {
  kind?: WorkloadKind;
  command?: string;
  repo?: string | null;
  durationMs?: number;
  outcome?: WorkloadOutcome;
  observedAt?: string;
  memBeforeBytes?: number;
  memAfterBytes?: number;
} = {}): WorkloadCostObservationV1 => {
  const built = buildWorkloadCostObservation({
    workloadKind: over.kind ?? 'gate',
    command: over.command ?? 'npm test',
    repo: over.repo ?? null,
    durationMs: over.durationMs ?? 1000,
    outcome: over.outcome ?? 'succeeded',
    observedAt: over.observedAt ?? '2026-08-17T12:00:00.000Z',
    resources: (over.memBeforeBytes !== undefined || over.memAfterBytes !== undefined)
      ? { memBeforeBytes: over.memBeforeBytes, memAfterBytes: over.memAfterBytes }
      : null,
  });
  if (!built.ok) throw new Error(`fixture inválida: ${built.explanation}`);
  return built.value;
};

describe('projectWorkloadCostProfiles', () => {
  test('agrupa por (kind, command, repo) e computa estatísticas simples', () => {
    const profiles = projectWorkloadCostProfiles([
      obs({ command: 'npm test', durationMs: 1000 }),
      obs({ command: 'npm test', durationMs: 3000 }),
      obs({ command: 'npm test', durationMs: 2000 }),
    ]);
    expect(profiles).toHaveLength(1);
    const profile = profiles[0]!;
    expect(profile.count).toBe(3);
    expect(profile.durationMedianMs).toBe(2000);
    expect(profile.durationMaxMs).toBe(3000);
  });

  test('isolamento: a evidência de outro workload NÃO contamina as estatísticas de um workload', () => {
    const withOther = projectWorkloadCostProfiles([
      obs({ command: 'npm test', durationMs: 1000 }),
      obs({ command: 'npm test', durationMs: 2000 }),
      obs({ command: 'npm run build', durationMs: 999_999 }),
    ]);
    const test = findWorkloadCostProfile(withOther, { workloadKind: 'gate', command: 'npm test', repo: null })!;
    // As estatísticas de "npm test" são idênticas com ou sem o outro workload presente.
    const isolated = projectWorkloadCostProfiles([
      obs({ command: 'npm test', durationMs: 1000 }),
      obs({ command: 'npm test', durationMs: 2000 }),
    ]);
    const testIsolated = isolated[0]!;
    expect({ count: test.count, median: test.durationMedianMs, max: test.durationMaxMs })
      .toEqual({ count: testIsolated.count, median: testIsolated.durationMedianMs, max: testIsolated.durationMaxMs });
  });

  test('repo distinto separa perfis (mesmo comando)', () => {
    const profiles = projectWorkloadCostProfiles([
      obs({ command: 'npm test', repo: 'anima', durationMs: 1000 }),
      obs({ command: 'npm test', repo: 'outro', durationMs: 2000 }),
    ]);
    expect(profiles).toHaveLength(2);
    expect(profiles.map(p => p.key.repo).sort()).toEqual(['anima', 'outro']);
  });

  test('classe predominante: workload consistentemente caro na máquina → high', () => {
    // Distribuição da máquina abrange baratos e caros; o workload-alvo fica no topo.
    const cheap = Array.from({ length: 9 }, () => obs({ command: 'lint', durationMs: 100 }));
    const expensive = Array.from({ length: 3 }, () => obs({ command: 'e2e', durationMs: 9000 }));
    const profiles = projectWorkloadCostProfiles([...cheap, ...expensive]);
    const e2e = findWorkloadCostProfile(profiles, { workloadKind: 'gate', command: 'e2e', repo: null })!;
    const lint = findWorkloadCostProfile(profiles, { workloadKind: 'gate', command: 'lint', repo: null })!;
    expect(e2e.predominantClass).toBe('high');
    expect(lint.predominantClass).toBe('low');
  });

  test('faixa de memória observada quando a telemetria existe; null quando ausente', () => {
    const withMem = projectWorkloadCostProfiles([
      obs({ command: 'npm test', memBeforeBytes: 100, memAfterBytes: 300 }),
      obs({ command: 'npm test', memBeforeBytes: 50, memAfterBytes: 200 }),
    ]);
    expect(withMem[0]!.memObservedRange).toEqual({ minBytes: 50, maxBytes: 300 });
    const withoutMem = projectWorkloadCostProfiles([obs({ command: 'npm test' })]);
    expect(withoutMem[0]!.memObservedRange).toBeNull();
  });

  test('conflito preservado sem apagar histórico: falhas contadas, última observação por instante', () => {
    const profiles = projectWorkloadCostProfiles([
      obs({ command: 'npm test', durationMs: 1000, outcome: 'succeeded', observedAt: '2026-08-17T10:00:00.000Z' }),
      obs({ command: 'npm test', durationMs: 8000, outcome: 'failed', observedAt: '2026-08-17T12:00:00.000Z' }),
    ]);
    const profile = profiles[0]!;
    expect(profile.count).toBe(2);
    expect(profile.failureCount).toBe(1);
    expect(profile.lastObservedAt).toBe('2026-08-17T12:00:00.000Z');
  });

  test('idempotente e ordem determinística por chave', () => {
    const observations = [obs({ command: 'b' }), obs({ command: 'a' }), obs({ command: 'a' })];
    const first = projectWorkloadCostProfiles(observations);
    const second = projectWorkloadCostProfiles(observations);
    expect(first).toEqual(second);
    expect(first.map(p => workloadKeyString(p.key))).toEqual([...first.map(p => workloadKeyString(p.key))].sort());
  });
});
