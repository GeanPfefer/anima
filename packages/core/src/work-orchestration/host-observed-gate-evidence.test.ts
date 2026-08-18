import {
  buildHostObservedGateEvidence,
  deriveObservedGateOutcome,
  parseHostObservedGateEvidence,
  projectHostObservedGateEvidence,
  terminalObservedGates,
  type HostObservedGateEvidenceV1,
  type ObservedGateOutcomeV1,
  type WorkEvent,
} from './index';
import type { Json } from '@anima/types';

const gate = (over: Partial<Parameters<typeof buildHostObservedGateEvidence>[0]['gates'][number]> = {}) =>
  ({ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 1200, timedOut: false, cancelled: false, ...over });

const build = (over: Partial<Parameters<typeof buildHostObservedGateEvidence>[0]> = {}) =>
  buildHostObservedGateEvidence({
    workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
    gates: [gate()], observedAt: '2026-08-16T12:00:00.000Z', ...over,
  });

describe('buildHostObservedGateEvidence', () => {
  test('constrói evidência válida com coverage.gates=true e outcome derivado', () => {
    const result = build();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.coverage).toEqual({ gates: true });
    expect(result.value.gates[0]).toMatchObject({ label: 'unit', command: 'npm test', exitCode: 0, outcome: 'passed' });
  });

  test('o outcome é DERIVADO dos fatos, nunca aceito de fora', () => {
    expect(deriveObservedGateOutcome({ exitCode: 0, timedOut: false, cancelled: false })).toBe('passed');
    expect(deriveObservedGateOutcome({ exitCode: 1, timedOut: false, cancelled: false })).toBe('failed');
    expect(deriveObservedGateOutcome({ exitCode: 0, timedOut: true, cancelled: false })).toBe('failed');
    expect(deriveObservedGateOutcome({ exitCode: 0, timedOut: false, cancelled: true })).toBe('failed');
    // Um gate que o host observou falhar vira outcome failed, mesmo que alguém
    // quisesse marcá-lo passed: o build ignora qualquer outcome fornecido.
    const failing = build({ gates: [gate({ exitCode: 1 })] });
    expect(failing.ok && failing.value.gates[0]!.outcome).toBe('failed');
  });

  test('preserva a ordem de execução observada', () => {
    const result = build({ gates: [gate({ label: 'typecheck', command: 'npm run typecheck' }), gate({ label: 'unit' })] });
    expect(result.ok && result.value.gates.map(g => g.label)).toEqual(['typecheck', 'unit']);
  });

  test.each([
    ['correlação', { workItemId: '' }, 'invalid_correlation'],
    ['sem gates', { gates: [] as ReturnType<typeof gate>[] }, 'invalid_gates'],
    ['timestamp inválido', { observedAt: 'ontem' }, 'invalid_timestamp'],
  ])('fail-closed: %s', (_label, over, defect) => {
    const result = build(over as Partial<Parameters<typeof buildHostObservedGateEvidence>[0]>);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.defect).toBe(defect);
  });

  test.each([
    ['label em branco', gate({ label: '  ' })],
    ['command em branco', gate({ command: '' })],
    ['exitCode não inteiro', gate({ exitCode: 1.5 })],
    ['durationMs negativo', gate({ durationMs: -1 })],
    ['flag não booleana', gate({ timedOut: 'sim' as unknown as boolean })],
  ])('fail-closed em gate malformado: %s', (_label, badGate) => {
    const result = build({ gates: [badGate] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.defect).toBe('invalid_gates');
  });

  test('rejeita comando/label com credencial ou caminho local', () => {
    expect(build({ gates: [gate({ command: 'npm test -- --secret=abc' })] }).ok).toBe(false);
    expect(build({ gates: [gate({ label: '/etc/config gate' })] }).ok).toBe(false);
  });
});

describe('terminalObservedGates', () => {
  const g = (label: string, command: string, outcome: 'passed' | 'failed'): ObservedGateOutcomeV1 =>
    ({ label, command, exitCode: outcome === 'passed' ? 0 : 1, durationMs: 10, timedOut: false, cancelled: false, outcome });

  test('mantém a ÚLTIMA observação por identidade (label+command): FAIL→PASS ⇒ PASS', () => {
    const out = terminalObservedGates([g('unit', 'npm test', 'failed'), g('unit', 'npm test', 'passed')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.outcome).toBe('passed');
  });

  test('preserva a ordem de PRIMEIRA aparição de cada identidade', () => {
    const out = terminalObservedGates([
      g('A', 'npm test', 'failed'), g('B', 'npm test', 'failed'),
      g('A', 'npm test', 'passed'), g('B', 'npm test', 'failed'),
    ]);
    expect(out.map(x => x.label)).toEqual(['A', 'B']);
    expect(out.map(x => x.outcome)).toEqual(['passed', 'failed']);
  });

  test('label igual mas command diferente são identidades DISTINTAS', () => {
    const out = terminalObservedGates([g('unit', 'npm test', 'passed'), g('unit', 'npm run test:e2e', 'failed')]);
    expect(out).toHaveLength(2);
  });

  test('lista vazia ⇒ vazia; um único gate é preservado', () => {
    expect(terminalObservedGates([])).toEqual([]);
    const one = terminalObservedGates([g('unit', 'npm test', 'passed')]);
    expect(one).toHaveLength(1);
  });
});

describe('parseHostObservedGateEvidence', () => {
  const serialized = (): Json => {
    const built = build();
    if (!built.ok) throw new Error('build falhou');
    return built.value as unknown as Json;
  };

  test('ida e volta', () => {
    const parsed = parseHostObservedGateEvidence(serialized());
    expect(parsed?.gates[0]).toMatchObject({ label: 'unit', outcome: 'passed' });
  });

  test('recomputa o outcome do persistido (não confia no outcome gravado)', () => {
    const raw = JSON.parse(JSON.stringify(serialized())) as Record<string, Json>;
    // Adultera o outcome persistido para "passed" com exitCode 1 → o parser recomputa failed.
    (raw.gates as Record<string, Json>[])[0]!.exitCode = 1;
    (raw.gates as Record<string, Json>[])[0]!.outcome = 'passed';
    expect(parseHostObservedGateEvidence(raw as Json)?.gates[0]!.outcome).toBe('failed');
  });

  test.each([
    ['schemaVersion errado', (v: Record<string, Json>) => { v.schemaVersion = 2; }],
    ['coverage adulterada', (v: Record<string, Json>) => { (v.coverage as Record<string, Json>).gates = false as unknown as Json; }],
    ['sem gates', (v: Record<string, Json>) => { v.gates = []; }],
  ])('fail-closed no persistido: %s ⇒ null', (_label, mutate) => {
    const raw = JSON.parse(JSON.stringify(serialized())) as Record<string, Json>;
    mutate(raw);
    expect(parseHostObservedGateEvidence(raw as Json)).toBeNull();
  });
});

describe('projectHostObservedGateEvidence', () => {
  const evidence = (): HostObservedGateEvidenceV1 => {
    const built = build();
    if (!built.ok) throw new Error('build falhou');
    return built.value;
  };
  const event = (ev: HostObservedGateEvidenceV1, over: Record<string, Json> = {}): WorkEvent => ({
    id: 'ev', workItemId: 'work-1', type: 'host_observed_gate_evidence_recorded', author: 'system', proposalVersion: 2,
    payload: { schema_version: 1, data: { work_item_id: ev.workItemId, attempt_id: ev.attemptId, approved_proposal_version: ev.approvedProposalVersion, origin: 'host', evidence: ev as unknown as Json, ...over } } as unknown as Json,
    occurredAt: new Date('2026-08-16T00:00:00Z'),
  });

  test('reconstrói a última evidência de gate do log', () => {
    expect(projectHostObservedGateEvidence([event(evidence())])?.gates[0]!.label).toBe('unit');
  });
  test('sem evento ⇒ null', () => {
    expect(projectHostObservedGateEvidence([])).toBeNull();
  });
  test('envelope discordante ⇒ null', () => {
    expect(projectHostObservedGateEvidence([event(evidence(), { attempt_id: 'outro' })])).toBeNull();
  });
});
