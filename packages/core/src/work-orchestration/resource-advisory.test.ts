import {
  adviseDeclaredGates,
  adviseWorkloadExecution,
  adviseWorkloadProfiles,
  buildWorkloadCostObservation,
  composeResourceGovernorView,
  describeExecutionAdvisory,
  describeMachinePressure,
  type CostClass,
  type InteractiveReserve,
  type MachineSnapshotV1,
  type WorkloadCostObservationV1,
  type WorkloadCostProfile,
} from './index';

const profile = (predominantClass: CostClass, count = 5): WorkloadCostProfile => ({
  key: { workloadKind: 'gate', command: 'npm test', repo: null },
  count,
  failureCount: 0,
  durationMedianMs: 1000,
  durationMaxMs: 2000,
  memObservedRange: null,
  predominantClass,
  lastObservedAt: '2026-08-17T12:00:00.000Z',
});

const snapshot = (freeMemBytes: number): MachineSnapshotV1 =>
  ({ schemaVersion: 1, capturedAt: '2026-08-17T12:00:00.000Z', observer: 'host', totalMemBytes: 16_000, freeMemBytes });

const reserve = (interactiveReserveActive: boolean): InteractiveReserve =>
  ({ interactiveReserveActive, minFreeMemFraction: 0.1, comfortableFreeMemFraction: 0.25 });

const lowMem = snapshot(800);      // fração 0.05 → pressão alta
const moderateMem = snapshot(2_400); // fração 0.15 → moderada
const highMem = snapshot(8_000);   // fração 0.5 → baixa

describe('adviseWorkloadExecution (advisory ≠ decisão; nunca executa ação)', () => {
  test('pouca evidência (sem perfil) → insufficient_evidence', () => {
    expect(adviseWorkloadExecution({ profile: null, snapshot: highMem, reserve: reserve(false) }).recommendation).toBe('insufficient_evidence');
  });

  test('custo desconhecido → insufficient_evidence mesmo com máquina folgada', () => {
    expect(adviseWorkloadExecution({ profile: profile('unknown'), snapshot: highMem, reserve: reserve(false) }).recommendation).toBe('insufficient_evidence');
  });

  test('workload historicamente barato → safe_to_run mesmo sob pressão/uso interativo', () => {
    expect(adviseWorkloadExecution({ profile: profile('low'), snapshot: lowMem, reserve: reserve(true) }).recommendation).toBe('safe_to_run');
  });

  test('workload historicamente caro + usuário ativo → machine_exclusive_recommended', () => {
    expect(adviseWorkloadExecution({ profile: profile('high'), snapshot: highMem, reserve: reserve(true) }).recommendation).toBe('machine_exclusive_recommended');
  });

  test('workload caro + memória baixa antes da execução → machine_exclusive_recommended', () => {
    expect(adviseWorkloadExecution({ profile: profile('high'), snapshot: lowMem, reserve: reserve(false) }).recommendation).toBe('machine_exclusive_recommended');
  });

  test('workload caro + pressão moderada, sem reserva ativa → prefer_defer', () => {
    expect(adviseWorkloadExecution({ profile: profile('high'), snapshot: moderateMem, reserve: reserve(false) }).recommendation).toBe('prefer_defer');
  });

  test('workload caro + máquina livre, sem reserva ativa → safe_to_run', () => {
    expect(adviseWorkloadExecution({ profile: profile('high'), snapshot: highMem, reserve: reserve(false) }).recommendation).toBe('safe_to_run');
  });

  test('custo médio + pressão alta → prefer_defer', () => {
    expect(adviseWorkloadExecution({ profile: profile('medium'), snapshot: lowMem, reserve: reserve(false) }).recommendation).toBe('prefer_defer');
  });

  test('custo médio + usuário ativo + pressão alta → machine_exclusive_recommended', () => {
    expect(adviseWorkloadExecution({ profile: profile('medium'), snapshot: lowMem, reserve: reserve(true) }).recommendation).toBe('machine_exclusive_recommended');
  });

  test('custo médio + máquina folgada, sem reserva → safe_to_run', () => {
    expect(adviseWorkloadExecution({ profile: profile('medium'), snapshot: highMem, reserve: reserve(false) }).recommendation).toBe('safe_to_run');
  });

  test('a base do advisory expõe os fatos usados (auditável)', () => {
    const result = adviseWorkloadExecution({ profile: profile('high', 7), snapshot: lowMem, reserve: reserve(true) });
    expect(result.basis).toEqual({ workloadClass: 'high', machinePressure: 'high', sampleCount: 7, reserveActive: true });
  });

  test('pureza: não muta as entradas e é determinística', () => {
    const input = Object.freeze({ profile: Object.freeze(profile('high')), snapshot: Object.freeze(lowMem), reserve: Object.freeze(reserve(true)) });
    const first = adviseWorkloadExecution(input);
    const second = adviseWorkloadExecution(input);
    expect(first).toEqual(second); // sem efeito colateral; recomputável
  });
});

describe('descritores de advisory compartilhados (web/mobile)', () => {
  test('describeExecutionAdvisory rotula cada recomendação em PT-BR', () => {
    expect(describeExecutionAdvisory('safe_to_run')).toBe('seguro rodar agora');
    expect(describeExecutionAdvisory('prefer_defer')).toContain('adiar');
    expect(describeExecutionAdvisory('machine_exclusive_recommended')).toContain('máquina exclusiva');
    expect(describeExecutionAdvisory('insufficient_evidence')).toContain('insuficiente');
  });
  test('describeMachinePressure rotula cada pressão, honesto no indeterminado', () => {
    expect(describeMachinePressure('low')).toBe('baixa');
    expect(describeMachinePressure('moderate')).toBe('moderada');
    expect(describeMachinePressure('high')).toBe('alta');
    expect(describeMachinePressure('unknown')).toBe('indeterminada');
  });
});

describe('adviseWorkloadProfiles (advisory por perfil; múltiplos workloads no mesmo turno)', () => {
  const keyed = (command: string, predominantClass: CostClass): WorkloadCostProfile =>
    ({ ...profile(predominantClass), key: { workloadKind: 'gate', command, repo: null } });

  test('cada perfil recebe o parecer RELATIVO à sua própria classe, sob o mesmo snapshot', () => {
    const advisories = adviseWorkloadProfiles(
      [keyed('lint', 'low'), keyed('e2e', 'high')],
      lowMem,
      reserve(true),
    );
    const byCommand = new Map(advisories.map(a => [a.key.command, a.advisory.recommendation]));
    // Barato segue seguro mesmo sob pressão; caro com usuário ativo pede janela exclusiva.
    expect(byCommand.get('lint')).toBe('safe_to_run');
    expect(byCommand.get('e2e')).toBe('machine_exclusive_recommended');
  });

  test('preserva a ordem e a chave de cada perfil (não colapsa workloads)', () => {
    const advisories = adviseWorkloadProfiles([keyed('a', 'low'), keyed('b', 'high'), keyed('c', 'medium')], highMem);
    expect(advisories.map(a => a.key.command)).toEqual(['a', 'b', 'c']);
  });

  test('sem perfis → lista vazia (nada a aconselhar)', () => {
    expect(adviseWorkloadProfiles([], highMem, reserve(false))).toEqual([]);
  });

  test('snapshot ausente → pressão unknown propaga em cada base, sem inventar', () => {
    const advisories = adviseWorkloadProfiles([keyed('x', 'high')], null, reserve(false));
    expect(advisories[0]!.advisory.basis.machinePressure).toBe('unknown');
  });

  test('pureza: determinística e sem mutação das entradas', () => {
    const profiles = Object.freeze([Object.freeze(keyed('a', 'high')), Object.freeze(keyed('b', 'low'))]);
    const first = adviseWorkloadProfiles(profiles, Object.freeze(lowMem), Object.freeze(reserve(true)));
    const second = adviseWorkloadProfiles(profiles, Object.freeze(lowMem), Object.freeze(reserve(true)));
    expect(first).toEqual(second);
  });
});

describe('adviseDeclaredGates (advisory ANTES de rodar, sobre os gates declarados)', () => {
  const obs = (command: string, durationMs: number, n: number): WorkloadCostObservationV1[] =>
    Array.from({ length: n }, () => {
      const built = buildWorkloadCostObservation({ workloadKind: 'gate', command, durationMs, observedAt: '2026-08-17T12:00:00.000Z', outcome: 'succeeded' });
      if (!built.ok) throw new Error('fixture inválida');
      return built.value;
    });
  const machineWide = [...obs('npm run typecheck', 300, 9), ...obs('npm run test:e2e', 90_000, 3)];

  test('cada gate declarado recebe parecer relativo ao histórico machine-wide', () => {
    const advisories = adviseDeclaredGates({ commands: ['npm run typecheck', 'npm run test:e2e'], observations: machineWide, snapshot: highMem, reserve: reserve(true) });
    const byCommand = new Map(advisories.map(a => [a.key.command, a.advisory.recommendation]));
    expect(byCommand.get('npm run typecheck')).toBe('safe_to_run');       // barato historicamente
    expect(byCommand.get('npm run test:e2e')).toBe('machine_exclusive_recommended'); // caro + usuário ativo
  });

  test('gate declarado mas NUNCA observado → insufficient_evidence (não some da lista)', () => {
    const advisories = adviseDeclaredGates({ commands: ['npm run brand-new-gate'], observations: machineWide, snapshot: highMem });
    expect(advisories).toHaveLength(1);
    expect(advisories[0]!.advisory.recommendation).toBe('insufficient_evidence');
  });

  test('deduplica comandos e ignora vazios, preservando a ordem de declaração', () => {
    const advisories = adviseDeclaredGates({ commands: ['a', '', '  ', 'b', 'a'], observations: [], snapshot: null });
    expect(advisories.map(x => x.key.command)).toEqual(['a', 'b']);
  });

  test('sem histórico algum → todos os declarados insufficient_evidence (honesto)', () => {
    const advisories = adviseDeclaredGates({ commands: ['x', 'y'], observations: [], snapshot: highMem });
    expect(advisories.every(a => a.advisory.recommendation === 'insufficient_evidence')).toBe(true);
  });
});

describe('composeResourceGovernorView (seam central de leitura, puro)', () => {
  const many = (command: string, durationMs: number, n: number): WorkloadCostObservationV1[] =>
    Array.from({ length: n }, () => {
      const built = buildWorkloadCostObservation({ workloadKind: 'gate', command, durationMs, observedAt: '2026-08-17T12:00:00.000Z', outcome: 'succeeded' });
      if (!built.ok) throw new Error('fixture inválida');
      return built.value;
    });

  test('sem alvo → sem advisory, mas expõe perfis, distribuição e pressão', () => {
    const view = composeResourceGovernorView({ observations: many('npm test', 1000, 3), snapshot: highMem, reserve: reserve(false) });
    expect(view.advisory).toBeNull();
    expect(view.profiles).toHaveLength(1);
    expect(view.pressure).toBe('low');
  });

  test('alvo barato sob pressão → safe_to_run (o custo do workload domina)', () => {
    const observations = [...many('lint', 100, 9), ...many('e2e', 9000, 3)];
    const view = composeResourceGovernorView({
      observations, snapshot: lowMem, reserve: reserve(true),
      target: { workloadKind: 'gate', command: 'lint', repo: null },
    });
    expect(view.advisory?.recommendation).toBe('safe_to_run');
    expect(view.advisory?.basis.workloadClass).toBe('low');
  });

  test('alvo historicamente caro + usuário ativo → machine_exclusive_recommended', () => {
    const observations = [...many('lint', 100, 9), ...many('e2e', 9000, 3)];
    const view = composeResourceGovernorView({
      observations, snapshot: highMem, reserve: reserve(true),
      target: { workloadKind: 'gate', command: 'e2e', repo: null },
    });
    expect(view.advisory?.basis.workloadClass).toBe('high');
    expect(view.advisory?.recommendation).toBe('machine_exclusive_recommended');
  });

  test('alvo inexistente no histórico → insufficient_evidence', () => {
    const view = composeResourceGovernorView({
      observations: many('npm test', 1000, 5), snapshot: highMem, reserve: reserve(false),
      target: { workloadKind: 'gate', command: 'jamais-visto', repo: null },
    });
    expect(view.advisory?.recommendation).toBe('insufficient_evidence');
  });
});
