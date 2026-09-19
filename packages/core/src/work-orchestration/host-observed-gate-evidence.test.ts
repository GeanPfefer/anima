import {
  buildHostObservedGateEvidence,
  classifyDifferentialGate,
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
    expect(result.value.shadowPolicyDecisions[0]).toMatchObject({
      policyVersion: 'differential-evidence-policy-v0', claimKind: 'unknown',
      decision: 'insufficient_evidence', reasonCode: 'unsupported_claim_kind',
    });
  });

  test('anexa a decisão shadow sem alterar o outcome observado', () => {
    const result = build({ gates: [gate({ claimKind: 'gate_assertion', baseline: baselineInput() as never })] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gates[0]!.outcome).toBe('passed');
    expect(result.value.shadowPolicyDecisions[0]).toMatchObject({ claimKind: 'gate_assertion', decision: 'require_review', reasonCode: 'outside_scope_change' });
    // Readiness != Policy: o mesmo gate diferencial LIMPO (FAIL→PASS, target intacto)
    // é CANDIDATO a enforcement autônomo para gate_assertion mesmo com mudança fora do
    // gate target (neutra), enquanto a Policy V0 pede revisão por outside-scope.
    expect(result.value.shadowReadinessDecisions[0]).toMatchObject({
      policyVersion: 'enforcement-readiness-v0', claimKind: 'gate_assertion',
      disposition: 'eligible', reasonCode: 'discriminating_gate_candidate',
      evidenceStrength: { differentialStatus: 'discriminating', changeAuthorization: { status: 'unavailable' } },
    });
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

// ============================================================
// Evidência DIFERENCIAL de gate (base × resultado): representação/classificação
// PURA e ADITIVA. Adiciona confiança estrutural; NÃO prova comportamento
// substantivo e NÃO altera o verdict do Verifier.
// ============================================================
const baselineInput = (over: Record<string, unknown> = {}) =>
  ({
    baseExitCode: 1, baseTimedOut: false, baseCancelled: false,
    targets: [{ path: 'src/unit.test.ts', existedAtBase: true, changed: false }],
    changedFiles: ['src/implementation.ts'], changedFilesWithinTargetScope: [], changedFilesOutsideTargetScope: ['src/implementation.ts'],
    scopeVerification: { status: 'verified', verifiedTargetPaths: ['src/unit.test.ts'] },
    ...over,
  });

const gateWithBaseline = (resultExitCode: number, baselineOver: Record<string, unknown> = {}): ObservedGateOutcomeV1 => {
  const built = build({ gates: [gate({ exitCode: resultExitCode, baseline: baselineInput(baselineOver) as never })] });
  if (!built.ok) throw new Error('build falhou');
  return built.value.gates[0]!;
};

describe('evidência diferencial de gate — build/parse aditivo (E1)', () => {
  test('baseline ausente ⇒ gate sem baseline (retrocompatível); classify inconclusive', () => {
    const built = build();
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.gates[0]!.baseline).toBeUndefined();
    expect(classifyDifferentialGate(built.value.gates[0]!)).toBe('inconclusive');
  });

  test('baseline válido ⇒ baseOutcome DERIVADO e presente', () => {
    const g = gateWithBaseline(0, { baseExitCode: 1 });
    expect(g.baseline).toMatchObject({ baseExitCode: 1, baseOutcome: 'failed', targetExistedAtBase: true, changeTouchedGateTargets: false });
    // base timedOut deriva failed mesmo com exit 0
    expect(gateWithBaseline(0, { baseExitCode: 0, baseTimedOut: true }).baseline?.baseOutcome).toBe('failed');
  });

  test('preserva fatos por target e deriva agregados sem perder dentro/fora do scope', () => {
    const g = gateWithBaseline(0, { targets: [
      { path: 'src/a.test.ts', existedAtBase: true, changed: true },
      { path: 'src/b.test.ts', existedAtBase: false, changed: false },
    ], changedFiles: ['src/a.test.ts', 'src/impl.ts'], changedFilesWithinTargetScope: ['src/a.test.ts'], changedFilesOutsideTargetScope: ['src/impl.ts'],
    scopeVerification: { status: 'verified', verifiedTargetPaths: ['src/a.test.ts', 'src/b.test.ts'] } });
    expect(g.baseline).toMatchObject({
      targetExistedAtBase: false, changeTouchedGateTargets: true,
      targets: [{ path: 'src/a.test.ts', existedAtBase: true, changed: true }, { path: 'src/b.test.ts', existedAtBase: false, changed: false }],
      changedFilesWithinTargetScope: ['src/a.test.ts'], changedFilesOutsideTargetScope: ['src/impl.ts'],
    });
  });

  test('baseline MALFORMADO no build ⇒ OMITIDO, gate/evidência do resultado permanecem válidos', () => {
    const built = build({ gates: [gate({ exitCode: 0, baseline: { baseExitCode: 'x', baseTimedOut: false, baseCancelled: false, targetExistedAtBase: true, changeTouchedGateTargets: false } as never })] });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.gates[0]!.outcome).toBe('passed');
    expect(built.value.gates[0]!.baseline).toBeUndefined();
    expect(classifyDifferentialGate(built.value.gates[0]!)).toBe('inconclusive');
  });

  test('ida e volta preserva o baseline; parse recomputa baseOutcome (ignora o gravado)', () => {
    const built = build({ gates: [gate({ exitCode: 0, baseline: baselineInput({ baseExitCode: 1 }) as never })] });
    if (!built.ok) throw new Error('build falhou');
    const raw = JSON.parse(JSON.stringify(built.value)) as Record<string, Json>;
    // adultera o baseOutcome persistido → parse deve recomputar 'failed'
    ((raw.gates as Record<string, Json>[])[0]!.baseline as Record<string, Json>).baseOutcome = 'passed';
    const parsed = parseHostObservedGateEvidence(raw as Json);
    expect(parsed?.gates[0]!.baseline?.baseOutcome).toBe('failed');
  });

  test('baseline MALFORMADO no persistido ⇒ OMITIDO, result gate intacto (não invalida a evidência)', () => {
    const built = build({ gates: [gate({ exitCode: 0, baseline: baselineInput() as never })] });
    if (!built.ok) throw new Error('build falhou');
    const raw = JSON.parse(JSON.stringify(built.value)) as Record<string, Json>;
    (((raw.gates as Record<string, Json>[])[0]!.baseline as Record<string, Json>).targets as Record<string, Json>[])[0]!.changed = 'sim' as unknown as Json;
    const parsed = parseHostObservedGateEvidence(raw as Json);
    expect(parsed).not.toBeNull();
    expect(parsed?.gates[0]!.outcome).toBe('passed');
    expect(parsed?.gates[0]!.baseline).toBeUndefined();
  });

  test('retrocompatibilidade: evidência do formato ANTERIOR (sem baseline) faz ida e volta idêntica', () => {
    const built = build();
    if (!built.ok) throw new Error('build falhou');
    const parsed = parseHostObservedGateEvidence(built.value as unknown as Json);
    expect(parsed?.gates[0]!.baseline).toBeUndefined();
    expect(parsed?.gates[0]).toMatchObject({ label: 'unit', outcome: 'passed' });
  });
});

describe('classifyDifferentialGate — só fatos estruturais (E2)', () => {
  test('base FAIL + result PASS + alvo preexistente + não tocado ⇒ discriminating', () => {
    expect(classifyDifferentialGate(gateWithBaseline(0, { baseExitCode: 1 }))).toBe('discriminating');
  });
  test('alvo NOVO (targetExistedAtBase=false) ⇒ confounded', () => {
    expect(classifyDifferentialGate(gateWithBaseline(0, { targets: [{ path: 'src/unit.test.ts', existedAtBase: false, changed: false }] }))).toBe('confounded');
  });
  test('alvo MODIFICADO (changeTouchedGateTargets=true) ⇒ confounded', () => {
    expect(classifyDifferentialGate(gateWithBaseline(0, { targets: [{ path: 'src/unit.test.ts', existedAtBase: true, changed: true }] }))).toBe('confounded');
  });
  test('base já PASS ⇒ non_discriminating', () => {
    expect(classifyDifferentialGate(gateWithBaseline(0, { baseExitCode: 0 }))).toBe('non_discriminating');
  });
  test('base FAIL + result NÃO-PASS (alvo limpo) ⇒ confounded (sem PASS a creditar)', () => {
    expect(classifyDifferentialGate(gateWithBaseline(1, { baseExitCode: 1 }))).toBe('confounded');
  });
  test('sem baseline ⇒ inconclusive', () => {
    const built = build();
    if (!built.ok) throw new Error('build falhou');
    expect(classifyDifferentialGate(built.value.gates[0]!)).toBe('inconclusive');
  });
  test('scope amplo não verificado e evidência legada nunca viram discriminating', () => {
    expect(classifyDifferentialGate(gateWithBaseline(0, {
      scopeVerification: { status: 'unverified', verifiedTargetPaths: [], reason: 'gate_scope_not_concrete' },
    }))).toBe('inconclusive');
    expect(classifyDifferentialGate(gateWithBaseline(0, { scopeVerification: undefined }))).toBe('inconclusive');
  });
  test('NENHUMA interpretação textual: label/command não afetam a classificação', () => {
    // Um gate cujo label/command "parecem" typecheck, mas base já passou ⇒ non_discriminating,
    // decidido só por fatos estruturais (não pela semântica do texto).
    const built = build({ gates: [gate({ label: 'typecheck', command: 'npm run typecheck', exitCode: 0, baseline: baselineInput({ baseExitCode: 0 }) as never })] });
    if (!built.ok) throw new Error('build falhou');
    expect(classifyDifferentialGate(built.value.gates[0]!)).toBe('non_discriminating');
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
