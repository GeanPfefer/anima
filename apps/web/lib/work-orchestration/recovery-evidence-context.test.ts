import type { Json } from '@anima/types';
import { deriveRecoveryEvidenceContext, loadRecoveryEvidenceContextFromStore, type PersistedCoderEvidenceRow, type RecoveryEvidenceStore } from './recovery-evidence-context';
import { renderRecoveryEvidence } from './recovery-evidence-render';
import { gateIdentityFromCommand } from './gate-identity';
import { redactSecrets } from './output-sanitization';

const GATE = 'npm test --workspace=@anima/web -- app/api/example/route.test.ts';
const FILE = 'apps/web/app/api/example/route.test.ts';

const row = (over: { id?: string; workItem?: string; attempt?: string; command?: string; gateIdentity?: string | null; failure?: string; patch?: string } = {}): PersistedCoderEvidenceRow => ({
  eventId: over.id ?? 'event-ancestor-1', workItemId: over.workItem ?? 'ancestor-item', createdAt: '2026-09-25T10:00:00Z',
  payload: {
    data: {
      attempt_id: over.attempt ?? 'attempt-ancestor-1',
      evidence: {
        transcripts: [{
          // Campo distrator representa texto livre/raciocínio: o seletor nunca o lê.
          assistantThought: 'SEGREDO-NAO-DEVE-VAZAR',
          entries: [{ phase: 'application', result: 'applied', path: FILE, round: 2 }],
          commandObservations: [
            { round: 1, editRevision: 0, kind: 'test', command: over.command ?? GATE, ...(over.gateIdentity === undefined ? { gateIdentity: gateIdentityFromCommand(GATE) } : over.gateIdentity ? { gateIdentity: over.gateIdentity } : {}), outcome: 'exit_nonzero', stdout: '', stderr: over.failure ?? 'ReferenceError: runtime primitive is not defined' },
            { round: 3, editRevision: 1, kind: 'test', command: over.command ?? GATE, ...(over.gateIdentity === undefined ? { gateIdentity: gateIdentityFromCommand(GATE) } : over.gateIdentity ? { gateIdentity: over.gateIdentity } : {}), outcome: 'exit0', stdout: 'Tests: 4 passed', stderr: '' },
            { round: 3, editRevision: 1, kind: 'git_diff', command: 'git diff --no-index', outcome: 'exit_nonzero', stdout: over.patch ?? `diff --git a/${FILE} b/${FILE}\n+class RuntimeResponse {}\n+Object.defineProperty(globalThis, 'Response', { value: RuntimeResponse });`, stderr: '' },
          ],
        }],
      },
    },
  } as Json,
});

describe('continuidade seletiva de evidência entre recoveries', () => {
  test('comando original e display sanitizado casam pela identidade canônica', () => {
    const sanitized = redactSecrets(GATE, true);
    expect(sanitized).not.toBe(GATE);
    const context = deriveRecoveryEvidenceContext({ rows: [row({ command: sanitized })], relevantCommands: [GATE], includedScope: [FILE] });
    expect(context?.items[0]).toMatchObject({ gateIdentity: gateIdentityFromCommand(GATE), failedCommand: sanitized });
  });

  test('redaction de path não altera a identidade persistida', () => {
    const identity = gateIdentityFromCommand(GATE)!;
    const persisted = JSON.parse(JSON.stringify(row({ command: 'npm test --workspace=@anima/web -- app<path>', gateIdentity: identity }))) as PersistedCoderEvidenceRow;
    expect(deriveRecoveryEvidenceContext({ rows: [persisted], relevantCommands: [GATE], includedScope: [FILE] })?.items[0]?.gateIdentity).toBe(identity);
  });

  test('gate diferente e argumentos relevantes alterados não casam', () => {
    const other = 'npm test --workspace=@anima/web -- app/api/other/route.test.ts';
    expect(gateIdentityFromCommand(other)).not.toBe(gateIdentityFromCommand(GATE));
    expect(gateIdentityFromCommand(`${GATE} --runInBand`)).not.toBe(gateIdentityFromCommand(GATE));
    expect(deriveRecoveryEvidenceContext({ rows: [row({ command: redactSecrets(other, true), gateIdentity: gateIdentityFromCommand(other) })], relevantCommands: [GATE], includedScope: [FILE] })).toBeNull();
  });

  test('falha observada seguida de correção provada vira contexto compacto e rastreável', () => {
    const context = deriveRecoveryEvidenceContext({ rows: [row()], relevantCommands: [GATE], includedScope: [FILE] });
    expect(context?.items).toHaveLength(1);
    expect(context?.items[0]).toMatchObject({
      sourceAttemptId: 'attempt-ancestor-1', sourceEventId: 'event-ancestor-1', failedCommand: GATE,
      observedFailure: expect.stringContaining('runtime primitive is not defined'),
      provenCorrection: { passedCommand: GATE, changedFiles: [FILE], patchExcerpt: expect.stringContaining('RuntimeResponse') },
    });
    expect(context?.references).toEqual(expect.arrayContaining([
      { kind: 'attempt', id: 'attempt-ancestor-1' }, { kind: 'work_event', id: 'event-ancestor-1' },
    ]));
  });

  test('evidência irrelevante não entra e o contexto é bounded', () => {
    const irrelevantCommand = 'npm test --workspace=@anima/web -- unrelated.test.ts';
    const irrelevant = row({ id: 'irrelevant', command: irrelevantCommand, gateIdentity: gateIdentityFromCommand(irrelevantCommand) });
    const many = Array.from({ length: 7 }, (_, index) => row({ id: `event-${index}`, attempt: `attempt-${index}` }));
    const context = deriveRecoveryEvidenceContext({ rows: [irrelevant, ...many], relevantCommands: [GATE], includedScope: [FILE] });
    expect(context?.items).toHaveLength(4);
    expect(context?.truncated).toBe(true);
    expect(context?.items.some(item => item.sourceEventId === 'irrelevant')).toBe(false);
  });

  test('FAIL→PASS sem mudança observada entre as revisões não vira conhecimento', () => {
    const unchanged = row();
    const root = unchanged.payload as { data: { evidence: { transcripts: Array<{ entries: unknown[]; commandObservations: Array<{ editRevision: number }> }> } } };
    root.data.evidence.transcripts[0]!.entries = [];
    root.data.evidence.transcripts[0]!.commandObservations[1]!.editRevision = 0;
    expect(deriveRecoveryEvidenceContext({ rows: [unchanged], relevantCommands: [GATE], includedScope: [FILE] })).toBeNull();
  });
  test('não carrega transcript livre/raciocínio e redige segredo em patch', () => {
    const context = deriveRecoveryEvidenceContext({
      rows: [row({ patch: `diff --git a/${FILE} b/${FILE}\n+const apiKey = "valor-secreto";\n+class UsefulFix {}` })],
      relevantCommands: [GATE], includedScope: [FILE],
    });
    const rendered = renderRecoveryEvidence(context!);
    expect(rendered).not.toContain('SEGREDO-NAO-DEVE-VAZAR');
    expect(rendered).not.toContain('valor-secreto');
    expect(rendered).toContain('apiKey=<redacted>');
    expect(rendered).toContain('UsefulFix');
  });

  test('sem evidência relevante (inclusive item sem lineage) preserva o caminho antigo', () => {
    expect(deriveRecoveryEvidenceContext({ rows: [], relevantCommands: [GATE], includedScope: [FILE] })).toBeNull();
  });

  test('reconstrução a partir das mesmas linhas persistidas sobrevive a restart', () => {
    const persisted = [row()];
    const first = deriveRecoveryEvidenceContext({ rows: persisted, relevantCommands: [GATE], includedScope: [FILE] });
    const afterRestart = deriveRecoveryEvidenceContext({
      rows: JSON.parse(JSON.stringify(persisted)) as PersistedCoderEvidenceRow[], relevantCommands: [GATE], includedScope: [FILE],
    });
    expect(afterRestart).toEqual(first);
  });

  test('legado sem fingerprint só casa por display exato e único; ambiguidade falha fechada', () => {
    const legacy = row({ command: redactSecrets(GATE, true), gateIdentity: null });
    expect(deriveRecoveryEvidenceContext({ rows: [legacy], relevantCommands: [GATE], includedScope: [FILE] })?.items).toHaveLength(1);
    const colliding = 'npm test --workspace=@anima/web -- app/api/other/route.test.ts';
    expect(redactSecrets(colliding, true)).toBe(redactSecrets(GATE, true));
    expect(deriveRecoveryEvidenceContext({ rows: [legacy], relevantCommands: [GATE, colliding], includedScope: [FILE] })).toBeNull();
    expect(deriveRecoveryEvidenceContext({ rows: [row({ command: 'npm test -- unrelated.test.ts', gateIdentity: null })], relevantCommands: [GATE], includedScope: [FILE] })).toBeNull();
  });

  test('caso real c284f09c seleciona FAIL→PASS e entrega o erro e o gate verde sem regra sobre o diagnóstico', () => {
    const realGate = 'npm test --workspace=@anima/web -- app/api/dev-readiness/route.test.ts';
    const realFile = 'apps/web/app/api/dev-readiness/route.test.ts';
    const runtimeName = ['Res', 'ponse'].join('');
    const real = row({
      id: '5ebf4d94-e6e5-40f5-b6ac-3e0a8a734f44', workItem: '2c7afe1d-996a-419c-994c-f142d18be0cd',
      attempt: 'c284f09c-dc43-4e4e-a8a1-592f3fadd561', command: redactSecrets(realGate, true),
      gateIdentity: null, failure: `ReferenceError: ${runtimeName} is not defined`, patch: `diff --git a/${realFile} b/${realFile}\n+installRuntimeShim()`,
    });
    const root = real.payload as { data: { evidence: { transcripts: Array<{ entries: Array<{ path: string }> }> } } };
    root.data.evidence.transcripts[0]!.entries[0]!.path = realFile;
    const context = deriveRecoveryEvidenceContext({ rows: [real], relevantCommands: [realGate], includedScope: [realFile] });
    expect(context?.items[0]).toMatchObject({
      sourceAttemptId: 'c284f09c-dc43-4e4e-a8a1-592f3fadd561',
      observedFailure: expect.stringContaining(`ReferenceError: ${runtimeName} is not defined`),
      provenCorrection: { passedCommand: redactSecrets(realGate, true), changedFiles: [realFile] },
    });
    expect(renderRecoveryEvidence(context!)).toContain('later proven passed');
  });

  test('successor percorre a lineage persistida; item sem lineage não recebe contexto', async () => {
    const parents = new Map([['successor', 'parent'], ['parent', 'root']]);
    const makeStore = (): RecoveryEvidenceStore => ({
      parentOf: async id => parents.get(id) ?? null,
      evidenceFor: async ids => ids.includes('root') ? [row()] : [],
    });
    const input = { workItemId: 'successor', relevantCommands: [GATE], includedScope: [FILE] };
    const inherited = await loadRecoveryEvidenceContextFromStore(makeStore(), input);
    expect(inherited?.items[0]?.sourceAttemptId).toBe('attempt-ancestor-1');
    // Novo store simula restart: continuidade vem das linhas, não de cache de processo.
    expect(await loadRecoveryEvidenceContextFromStore(makeStore(), input)).toEqual(inherited);
    expect(await loadRecoveryEvidenceContextFromStore(makeStore(), { ...input, workItemId: 'standalone' })).toBeNull();
  });
});
