import { buildHostObservedGitEvidence, parseHostObservedGitEvidence, type HostObservedGitEvidenceV1 } from './index';
import type { Json } from '@anima/types';

const BASE = 'a'.repeat(40);
const COMMIT = 'b'.repeat(40);

const build = (over: Partial<Parameters<typeof buildHostObservedGitEvidence>[0]> = {}) =>
  buildHostObservedGitEvidence({
    workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
    baseSha: BASE, observedCommitSha: COMMIT,
    observedChangedFiles: ['src/a.ts'],
    observedDiffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }],
    observedAt: '2026-08-14T12:00:00.000Z',
    ...over,
  });

describe('buildHostObservedGitEvidence', () => {
  test('constrói evidência válida com cobertura git=true, gates=false', () => {
    const result = build();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.coverage).toEqual({ git: true, gates: false });
    expect(result.value.observedDiffSummary).toEqual({ filesChanged: 1, insertions: 3, deletions: 1, files: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }] });
  });

  test('ordena os caminhos canonicamente (determinismo)', () => {
    const a = build({ observedChangedFiles: ['src/z.ts', 'src/a.ts'], observedDiffFiles: [{ path: 'src/z.ts', insertions: 1, deletions: 0 }, { path: 'src/a.ts', insertions: 2, deletions: 0 }] });
    const b = build({ observedChangedFiles: ['src/a.ts', 'src/z.ts'], observedDiffFiles: [{ path: 'src/a.ts', insertions: 2, deletions: 0 }, { path: 'src/z.ts', insertions: 1, deletions: 0 }] });
    expect(a.ok && b.ok && a.value.observedChangedFiles).toEqual(['src/a.ts', 'src/z.ts']);
    expect(a).toEqual(b);
  });

  test.each([
    ['correlação', { workItemId: '' }, 'invalid_correlation'],
    ['SHA malformado', { observedCommitSha: 'xyz' }, 'invalid_git_reference'],
    ['base == commit', { observedCommitSha: BASE }, 'invalid_git_reference'],
    ['sem arquivos', { observedChangedFiles: [] as string[] }, 'invalid_diff'],
    ['timestamp inválido', { observedAt: 'ontem' }, 'invalid_timestamp'],
  ])('fail-closed: %s', (_label, over, defect) => {
    const result = build(over as Partial<Parameters<typeof buildHostObservedGitEvidence>[0]>);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.defect).toBe(defect);
  });
});

describe('parseHostObservedGitEvidence', () => {
  const serialized = (): Json => {
    const built = build();
    if (!built.ok) throw new Error('build falhou');
    return built.value as unknown as Json;
  };

  test('reconstrói o que foi construído (ida e volta)', () => {
    const parsed = parseHostObservedGitEvidence(serialized());
    expect(parsed).not.toBeNull();
    expect(parsed?.observedChangedFiles).toEqual(['src/a.ts']);
  });

  test.each([
    ['schemaVersion errado', (v: Record<string, Json>) => { v.schemaVersion = 2; }],
    ['cobertura adulterada (gates=true)', (v: Record<string, Json>) => { (v.coverage as Record<string, Json>).gates = true as unknown as Json; }],
    ['base == commit', (v: Record<string, Json>) => { v.observedCommitSha = v.baseSha as Json; }],
    ['sem arquivos', (v: Record<string, Json>) => { v.observedChangedFiles = []; }],
  ])('fail-closed no persistido: %s ⇒ null', (_label, mutate) => {
    const raw = JSON.parse(JSON.stringify(serialized())) as Record<string, Json>;
    mutate(raw);
    expect(parseHostObservedGitEvidence(raw as Json)).toBeNull();
  });

  test('coverage.gates é sempre false na reconstrução (nunca promove a observação de gate)', () => {
    const parsed = parseHostObservedGitEvidence(serialized()) as HostObservedGitEvidenceV1;
    expect(parsed.coverage.gates).toBe(false);
  });
});
