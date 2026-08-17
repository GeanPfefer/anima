import {
  buildCostDistribution,
  buildWorkloadCostObservation,
  classifyMachinePressure,
  classifyObservationCost,
  DEFAULT_INTERACTIVE_RESERVE,
  describeCostClass,
  formatObservedDurationMs,
  MIN_SAMPLES_TO_RANK,
  type InteractiveReserve,
  type MachineSnapshotV1,
  type WorkloadCostObservationV1,
} from './index';

const obs = (durationMs: number): WorkloadCostObservationV1 => {
  const built = buildWorkloadCostObservation({ workloadKind: 'gate', command: 'npm test', observedAt: '2026-08-17T12:00:00.000Z', durationMs, outcome: 'succeeded' });
  if (!built.ok) throw new Error('fixture inválida');
  return built.value;
};

const snapshot = (over: Partial<MachineSnapshotV1> = {}): MachineSnapshotV1 =>
  ({ schemaVersion: 1, capturedAt: '2026-08-17T12:00:00.000Z', observer: 'host', totalMemBytes: 16_000, freeMemBytes: 8_000, ...over });

describe('buildCostDistribution', () => {
  test('conjunto vazio → distribuição zerada', () => {
    expect(buildCostDistribution([])).toEqual({ count: 0, p50Ms: 0, p90Ms: 0, maxMs: 0 });
  });

  test('percentis determinísticos sobre durações', () => {
    const dist = buildCostDistribution([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map(obs));
    expect(dist.count).toBe(10);
    expect(dist.maxMs).toBe(1000);
    expect(dist.p50Ms).toBe(500);
    expect(dist.p90Ms).toBe(900);
  });
});

describe('classifyObservationCost (relativo à distribuição observada, não a thresholds universais)', () => {
  test('poucas amostras → unknown (evidência insuficiente para ranquear)', () => {
    const few = [obs(100), obs(100)];
    expect(few.length).toBeLessThan(MIN_SAMPLES_TO_RANK);
    const dist = buildCostDistribution(few);
    expect(classifyObservationCost(100, dist)).toBe('unknown');
    expect(classifyObservationCost(999_999, dist)).toBe('unknown');
  });

  test('sem espalhamento (todas iguais) → unknown, mesmo com muitas amostras', () => {
    const dist = buildCostDistribution([500, 500, 500, 500, 500].map(obs));
    expect(classifyObservationCost(500, dist)).toBe('unknown');
  });

  test('workload barato → low; caro → high; intermediário → medium', () => {
    const dist = buildCostDistribution([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map(obs));
    expect(classifyObservationCost(200, dist)).toBe('low');
    expect(classifyObservationCost(700, dist)).toBe('medium');
    expect(classifyObservationCost(1000, dist)).toBe('high');
  });

  test('duração alta (acima do p90) → high', () => {
    const dist = buildCostDistribution([100, 120, 130, 140, 150, 160, 170, 180, 190, 5000].map(obs));
    expect(classifyObservationCost(5000, dist)).toBe('high');
  });
});

describe('classifyMachinePressure (relativo à reserva injetada)', () => {
  test('sem snapshot → unknown', () => {
    expect(classifyMachinePressure(null)).toBe('unknown');
  });

  test('telemetria de memória ausente → unknown (não inventa pressão)', () => {
    expect(classifyMachinePressure(snapshot({ freeMemBytes: undefined }))).toBe('unknown');
  });

  test('memória baixa antes da execução → pressão alta', () => {
    expect(classifyMachinePressure(snapshot({ totalMemBytes: 16_000, freeMemBytes: 800 }))).toBe('high');
  });

  test('memória confortável → pressão baixa; intermediária → moderada', () => {
    expect(classifyMachinePressure(snapshot({ totalMemBytes: 16_000, freeMemBytes: 8_000 }))).toBe('low');
    expect(classifyMachinePressure(snapshot({ totalMemBytes: 16_000, freeMemBytes: 2_400 }))).toBe('moderate');
  });

  test('reserva injetada muda as fronteiras (não são universais)', () => {
    const strict: InteractiveReserve = { interactiveReserveActive: true, minFreeMemFraction: 0.5, comfortableFreeMemFraction: 0.8 };
    // 8000/16000 = 0.5: com a reserva padrão é 'low', com a estrita vira 'moderate'.
    expect(classifyMachinePressure(snapshot(), DEFAULT_INTERACTIVE_RESERVE)).toBe('low');
    expect(classifyMachinePressure(snapshot(), strict)).toBe('moderate');
  });
});

describe('descritores de apresentação compartilhados (web/mobile)', () => {
  test('describeCostClass rotula cada classe em PT-BR, honesto no unknown', () => {
    expect(describeCostClass('low')).toBe('baixo');
    expect(describeCostClass('medium')).toBe('médio');
    expect(describeCostClass('high')).toBe('alto');
    expect(describeCostClass('unknown')).toBe('indeterminado');
  });

  test('formatObservedDurationMs: ms inteiros abaixo de 1s, segundos (1 casa) a partir de 1s', () => {
    expect(formatObservedDurationMs(300)).toBe('300 ms');
    expect(formatObservedDurationMs(999)).toBe('999 ms');
    expect(formatObservedDurationMs(1000)).toBe('1.0 s'); // fronteira exata
    expect(formatObservedDurationMs(90_000)).toBe('90.0 s');
    expect(formatObservedDurationMs(0)).toBe('0 ms');
  });
});
