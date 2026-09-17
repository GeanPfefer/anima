import {
  isPathExcluded,
  isPathReadable,
  isPathWritable,
  resolveWorkspaceAccessPolicy,
  supervisedWorkspaceAccessPolicy,
  workspaceAccessPolicyFromIncludedScope,
} from './workspace-access-policy';

describe('WorkspaceAccessPolicyV1 — READ e WRITE como autoridades distintas', () => {
  test('retrocompat: sem política, read == write == includedScope', () => {
    const p = workspaceAccessPolicyFromIncludedScope(['src/a.ts', 'src/b.ts'], ['src/secret.ts']);
    expect(p.readScope).toEqual({ kind: 'paths', paths: ['src/a.ts', 'src/b.ts'] });
    expect(isPathReadable('src/a.ts', p)).toBe(true);
    expect(isPathReadable('src/c.ts', p)).toBe(false); // fora do read==write
    expect(isPathWritable('src/a.ts', p)).toBe(true);
  });

  test('self-dev supervisionado: LER todo o workspace, ESCREVER só o Work Item', () => {
    const p = supervisedWorkspaceAccessPolicy(['src/a.ts']);
    expect(p.readScope).toEqual({ kind: 'workspace' });
    // Ler amplamente é permitido…
    expect(isPathReadable('packages/core/src/tipos.ts', p)).toBe(true);
    expect(isPathReadable('apps/web/lib/x.ts', p)).toBe(true);
    // …mas escrever só no Work Item.
    expect(isPathWritable('src/a.ts', p)).toBe(true);
    expect(isPathWritable('packages/core/src/tipos.ts', p)).toBe(false);
  });

  test('invariante: WRITE scope é sempre um subconjunto do READ scope (write sempre legível)', () => {
    const p = resolveWorkspaceAccessPolicy({
      writeScope: ['src/a.ts'],
      readScope: { kind: 'paths', paths: ['src/x.ts'] },
    });
    // O write scope é injetado no read scope mesmo que o caller não o inclua.
    expect(p.readScope).toEqual({ kind: 'paths', paths: expect.arrayContaining(['src/x.ts', 'src/a.ts']) });
    expect(isPathReadable('src/a.ts', p)).toBe(true);
  });

  test('excluído nunca é legível nem gravável, mesmo em modo workspace', () => {
    const p = resolveWorkspaceAccessPolicy({
      writeScope: ['src/a.ts'],
      readScope: { kind: 'workspace' },
      excluded: ['src/secret', 'infra/keys.ts'],
    });
    expect(isPathExcluded('src/secret/creds.ts', p)).toBe(true);
    expect(isPathReadable('src/secret/creds.ts', p)).toBe(false);
    expect(isPathReadable('infra/keys.ts', p)).toBe(false);
    expect(isPathWritable('infra/keys.ts', p)).toBe(false);
    expect(isPathReadable('src/ok.ts', p)).toBe(true);
  });

  test('fail-closed lexical: traversal e absoluto nunca são legíveis nem graváveis', () => {
    const p = supervisedWorkspaceAccessPolicy(['src/a.ts']);
    for (const bad of ['../fora.ts', '/etc/passwd', 'C:/x', 'a/../../b.ts', './']) {
      expect(isPathReadable(bad, p)).toBe(false);
      expect(isPathWritable(bad, p)).toBe(false);
    }
  });

  test('ler NÃO concede escrever: um arquivo do read scope amplo não é gravável', () => {
    const p = supervisedWorkspaceAccessPolicy(['src/a.ts']);
    const other = 'packages/core/src/deps.ts';
    expect(isPathReadable(other, p)).toBe(true);
    expect(isPathWritable(other, p)).toBe(false);
  });
});
