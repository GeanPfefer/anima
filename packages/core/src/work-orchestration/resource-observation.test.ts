import {
  buildHostObservedGateEvidence,
  buildWorkloadCostObservation,
  deriveWorkloadCostObservationsFromEvents,
  parseMachineSnapshot,
  parseWorkloadCostObservation,
  type ObservedGateInput,
  type WorkEvent,
} from './index';
import type { Json } from '@anima/types';

let seq = 0;
const gateEvidenceEvent = (opts: {
  workItemId?: string;
  attemptId?: string;
  version?: number;
  gates: ObservedGateInput[];
  observedAt?: string;
  envelopeWorkItemId?: string;
  envelopeAttemptId?: string;
  envelopeVersion?: number;
}): WorkEvent => {
  const workItemId = opts.workItemId ?? 'work-1';
  const attemptId = opts.attemptId ?? 'attempt-1';
  const version = opts.version ?? 2;
  const observedAt = opts.observedAt ?? '2026-08-17T12:00:00.000Z';
  const built = buildHostObservedGateEvidence({
    workItemId, attemptId, approvedProposalVersion: version, gates: opts.gates, observedAt,
  });
  if (!built.ok) throw new Error(`fixture inválida: ${built.explanation}`);
  return {
    id: `ev-${++seq}`,
    workItemId,
    type: 'host_observed_gate_evidence_recorded',
    author: 'system',
    proposalVersion: version,
    payload: {
      data: {
        work_item_id: opts.envelopeWorkItemId ?? workItemId,
        attempt_id: opts.envelopeAttemptId ?? attemptId,
        approved_proposal_version: opts.envelopeVersion ?? version,
        evidence: built.value as unknown as Json,
      },
    },
    occurredAt: new Date(observedAt),
  };
};

const gate = (over: Partial<ObservedGateInput> = {}): ObservedGateInput =>
  ({ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 1200, timedOut: false, cancelled: false, ...over });

describe('buildWorkloadCostObservation', () => {
  const base = {
    workloadKind: 'gate' as const,
    command: 'npm test',
    observedAt: '2026-08-17T12:00:00.000Z',
    durationMs: 1200,
    outcome: 'succeeded' as const,
  };

  test('constrói observação válida, proveniência host, campos opcionais omitidos', () => {
    const result = buildWorkloadCostObservation(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ schemaVersion: 1, workloadKind: 'gate', command: 'npm test', durationMs: 1200, outcome: 'succeeded', observer: 'host' });
    expect(result.value.repo).toBeUndefined();
    expect(result.value.resources).toBeUndefined();
  });

  test('inclui repo/correlação/telemetria quando presentes e confiáveis', () => {
    const result = buildWorkloadCostObservation({
      ...base, repo: 'anima', workItemId: 'work-1', attemptId: 'attempt-1',
      resources: { memBeforeBytes: 100, memAfterBytes: 200, cpuCount: 8 },
    });
    expect(result.ok && result.value.repo).toBe('anima');
    expect(result.ok && result.value.resources).toEqual({ memBeforeBytes: 100, memAfterBytes: 200, cpuCount: 8 });
  });

  test('telemetria parcialmente ausente: mantém só os campos confiáveis', () => {
    const result = buildWorkloadCostObservation({ ...base, resources: { memBeforeBytes: 100, cpuCount: -1 as unknown as number } });
    expect(result.ok && result.value.resources).toEqual({ memBeforeBytes: 100 });
  });

  test('telemetria totalmente inválida vira ausência (não força campo)', () => {
    const result = buildWorkloadCostObservation({ ...base, resources: { memBeforeBytes: -5, cpuCount: 1.5 as unknown as number } });
    expect(result.ok && result.value.resources).toBeUndefined();
  });

  test.each([
    ['tipo desconhecido', { workloadKind: 'mining' as unknown as 'gate' }, 'invalid_kind'],
    ['comando em branco', { command: '  ' }, 'invalid_command'],
    ['duração negativa', { durationMs: -1 }, 'invalid_duration'],
    ['duração não finita', { durationMs: Number.POSITIVE_INFINITY }, 'invalid_duration'],
    ['desfecho inválido', { outcome: 'maybe' as unknown as 'succeeded' }, 'invalid_outcome'],
    ['timestamp inválido', { observedAt: 'ontem' }, 'invalid_timestamp'],
  ])('fail-closed: %s', (_label, over, defect) => {
    const result = buildWorkloadCostObservation({ ...base, ...(over as Record<string, unknown>) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.defect).toBe(defect);
  });

  test.each([
    ['credencial no comando', { command: 'deploy --api_key=hunter2' }],
    ['caminho absoluto local no repo', { repo: 'C:\\Users\\gean\\anima' }],
  ])('fail-closed: %s (mesma régua de sanitização do domínio)', (_label, over) => {
    const result = buildWorkloadCostObservation({ ...base, ...(over as Record<string, unknown>) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.defect).toBe('sensitive_data');
  });

  test('round-trip build → parse preserva a observação', () => {
    const built = buildWorkloadCostObservation({ ...base, repo: 'anima', resources: { memBeforeBytes: 10 } });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const parsed = parseWorkloadCostObservation(built.value as unknown as Json);
    expect(parsed).toEqual(built.value);
  });
});

describe('parseMachineSnapshot', () => {
  test('reconstrói snapshot com telemetria parcial (loadAvg omitido)', () => {
    const snapshot = parseMachineSnapshot({ schemaVersion: 1, capturedAt: '2026-08-17T12:00:00.000Z', observer: 'host', totalMemBytes: 16, freeMemBytes: 4, cpuCount: 8 } as unknown as Json);
    expect(snapshot).toEqual({ schemaVersion: 1, capturedAt: '2026-08-17T12:00:00.000Z', observer: 'host', totalMemBytes: 16, freeMemBytes: 4, cpuCount: 8 });
  });

  test.each([
    ['schema errado', { schemaVersion: 2, capturedAt: '2026-08-17T12:00:00.000Z', observer: 'host' }],
    ['observador não-host', { schemaVersion: 1, capturedAt: '2026-08-17T12:00:00.000Z', observer: 'executor' }],
    ['timestamp inválido', { schemaVersion: 1, capturedAt: 'ontem', observer: 'host' }],
  ])('fail-closed: %s', (_label, value) => {
    expect(parseMachineSnapshot(value as unknown as Json)).toBeNull();
  });
});

describe('deriveWorkloadCostObservationsFromEvents (semente real: durationMs de gate)', () => {
  test('deriva uma observação por gate, reaproveitando durationMs e desfecho', () => {
    const events = [gateEvidenceEvent({ gates: [
      gate({ label: 'typecheck', command: 'npm run typecheck', durationMs: 5000 }),
      gate({ label: 'unit', command: 'npm test', durationMs: 1200 }),
    ] })];
    const observations = deriveWorkloadCostObservationsFromEvents(events);
    expect(observations).toHaveLength(2);
    expect(observations.map(o => ({ command: o.command, durationMs: o.durationMs, kind: o.workloadKind, outcome: o.outcome }))).toEqual([
      { command: 'npm run typecheck', durationMs: 5000, kind: 'gate', outcome: 'succeeded' },
      { command: 'npm test', durationMs: 1200, kind: 'gate', outcome: 'succeeded' },
    ]);
    expect(observations.every(o => o.observer === 'host' && o.workItemId === 'work-1' && o.attemptId === 'attempt-1')).toBe(true);
  });

  test('gate falho vira observação com outcome failed (a mais valiosa é preservada)', () => {
    const events = [gateEvidenceEvent({ gates: [gate({ command: 'npm test', exitCode: 1, durationMs: 800 })] })];
    const [observation] = deriveWorkloadCostObservationsFromEvents(events);
    expect(observation?.outcome).toBe('failed');
  });

  test('idempotente: re-derivar do mesmo log dá exatamente o mesmo conjunto', () => {
    const events = [gateEvidenceEvent({ gates: [gate()] })];
    expect(deriveWorkloadCostObservationsFromEvents(events)).toEqual(deriveWorkloadCostObservationsFromEvents(events));
  });

  test('histórico não é apagado: tentativas distintas do mesmo comando viram observações distintas', () => {
    const events = [
      gateEvidenceEvent({ attemptId: 'attempt-1', observedAt: '2026-08-17T12:00:00.000Z', gates: [gate({ command: 'npm test', durationMs: 1000 })] }),
      gateEvidenceEvent({ attemptId: 'attempt-2', observedAt: '2026-08-17T13:00:00.000Z', gates: [gate({ command: 'npm test', durationMs: 4000 })] }),
    ];
    const observations = deriveWorkloadCostObservationsFromEvents(events);
    expect(observations.map(o => o.durationMs)).toEqual([1000, 4000]);
    expect(observations.map(o => o.attemptId)).toEqual(['attempt-1', 'attempt-2']);
  });

  test('ignora eventos que não são evidência de gate', () => {
    const other: WorkEvent = { id: 'x', workItemId: 'work-1', type: 'result_submitted', author: 'system', proposalVersion: 2, payload: {}, occurredAt: new Date() };
    expect(deriveWorkloadCostObservationsFromEvents([other])).toHaveLength(0);
  });

  test('descarta evidência cujo envelope discorda da correlação (não confia cegamente)', () => {
    const tampered = gateEvidenceEvent({ gates: [gate()], envelopeAttemptId: 'attempt-OUTRO' });
    expect(deriveWorkloadCostObservationsFromEvents([tampered])).toHaveLength(0);
  });
});
