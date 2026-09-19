import { classifyChangeAuthorization } from './index';
import { isPathWritable, supervisedWorkspaceAccessPolicy } from './workspace-access-policy';

const classify = (declaredScope: readonly string[], changedFiles: readonly string[], excludedScope: readonly string[] = []) =>
  classifyChangeAuthorization({ declaredScope, excludedScope, changedFiles });

describe('Change Authorization Evidence V0 (classifier)', () => {
  test('path exato autorizado ⇒ changed file dentro do escopo', () => {
    const ev = classify(['src/foo.ts'], ['src/foo.ts']);
    expect(ev).toMatchObject({
      source: 'work_item_included_scope', status: 'verified',
      authorizedChangedFiles: ['src/foo.ts'], unauthorizedChangedFiles: [],
    });
  });

  test('múltiplos paths autorizados', () => {
    const ev = classify(['src/foo.ts', 'src/bar.ts'], ['src/bar.ts']);
    expect(ev.status).toBe('verified');
    expect(ev.authorizedChangedFiles).toEqual(['src/bar.ts']);
    expect(ev.unauthorizedChangedFiles).toEqual([]);
  });

  test('arquivo alterado FORA do escopo autorizado', () => {
    const ev = classify(['src/foo.ts'], ['src/outro.ts']);
    expect(ev.authorizedChangedFiles).toEqual([]);
    expect(ev.unauthorizedChangedFiles).toEqual(['src/outro.ts']);
  });

  test('mistura dentro + fora preserva ambos os fatos', () => {
    const ev = classify(['src/foo.ts'], ['src/foo.ts', 'src/outro.ts']);
    expect(ev.authorizedChangedFiles).toEqual(['src/foo.ts']);
    expect(ev.unauthorizedChangedFiles).toEqual(['src/outro.ts']);
  });

  test('excludedScope: um path DECLARADO mas excluído nunca é autorizado (semântica canônica)', () => {
    const ev = classify(['src/foo.ts'], ['src/foo.ts'], ['src/foo.ts']);
    // Declarado no escopo, mas excluído ⇒ não writable ⇒ não autorizado.
    expect(ev.unauthorizedChangedFiles).toEqual(['src/foo.ts']);
    expect(ev.authorizedChangedFiles).toEqual([]);
  });

  test('escopo com entrada em PROSA ⇒ parcialmente verificável', () => {
    const ev = classify(['src/foo.ts', 'migrar tela X'], ['src/foo.ts']);
    expect(ev.status).toBe('partially_verifiable');
    expect(ev.verifiableAuthorizedPaths).toEqual(['src/foo.ts']);
    expect(ev.unverifiableScopeEntries).toEqual(['migrar tela X']);
    expect(ev.authorizedChangedFiles).toEqual(['src/foo.ts']);
  });

  test('escopo totalmente verificável', () => {
    expect(classify(['src/foo.ts', 'src/bar.ts'], []).status).toBe('verified');
  });

  test('nenhum path verificável (só prosa) ⇒ unavailable', () => {
    const ev = classify(['migrar tela X', 'não tocar no mobile'], ['src/foo.ts']);
    expect(ev.status).toBe('unavailable');
    expect(ev.verifiableAuthorizedPaths).toEqual([]);
  });

  test('escopo vazio ⇒ unavailable, tudo não autorizado', () => {
    const ev = classify([], ['src/foo.ts']);
    expect(ev.status).toBe('unavailable');
    expect(ev.unauthorizedChangedFiles).toEqual(['src/foo.ts']);
  });

  test('MESMA semântica que isPathWritable/WorkspaceAccessPolicy existente', () => {
    const declaredScope = ['src/foo.ts', 'src/bar.ts'];
    const excludedScope = ['src/bar.ts'];
    const changedFiles = ['src/foo.ts', 'src/bar.ts', 'src/outro.ts'];
    const policy = supervisedWorkspaceAccessPolicy(declaredScope, excludedScope);
    const ev = classify(declaredScope, changedFiles, excludedScope);
    for (const f of changedFiles) {
      const authorized = ev.authorizedChangedFiles.includes(f);
      expect(authorized).toBe(isPathWritable(f, policy));
    }
  });

  test('determinismo: mesma entrada ⇒ mesma evidência', () => {
    expect(classify(['src/foo.ts'], ['src/foo.ts'])).toEqual(classify(['src/foo.ts'], ['src/foo.ts']));
  });

  test('INVARIANTE: gate target foo.test.ts, change auth foo.ts, coder altera foo.ts ⇒ autorizado', () => {
    // Change Authorization Scope é foo.ts (o gate target foo.test.ts é OUTRO escopo).
    const ev = classify(['src/foo.ts'], ['src/foo.ts']);
    expect(ev.authorizedChangedFiles).toEqual(['src/foo.ts']);
    expect(ev.unauthorizedChangedFiles).toEqual([]);
    expect(ev.status).toBe('verified');
  });
});
