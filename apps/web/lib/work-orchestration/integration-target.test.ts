import { branchPublicationTargetFromEnvironment, BRANCH_PUBLICATION_PROVIDER_ID } from './integration-target';

const base = {
  ANIMA_INTEGRATION_REPOSITORY_ID: 'https://github.com/anima/anima',
  ANIMA_INTEGRATION_REMOTE_NAME: 'origin',
  ANIMA_INTEGRATION_BASE_BRANCH: 'main',
  ANIMA_INTEGRATION_REPO_ROOT: process.platform === 'win32' ? 'C:\\repo\\anima' : '/repo/anima',
} as unknown as NodeJS.ProcessEnv;

describe('branchPublicationTargetFromEnvironment', () => {
  test('config completa reconstrói o alvo confiável com provider fixo do servidor', () => {
    const resolved = branchPublicationTargetFromEnvironment(base);
    expect(resolved).toEqual({
      repoRoot: base.ANIMA_INTEGRATION_REPO_ROOT,
      target: { providerId: BRANCH_PUBLICATION_PROVIDER_ID, repositoryId: 'https://github.com/anima/anima', remoteName: 'origin', baseBranch: 'main' },
    });
  });

  test.each(['ANIMA_INTEGRATION_REPOSITORY_ID', 'ANIMA_INTEGRATION_REMOTE_NAME', 'ANIMA_INTEGRATION_BASE_BRANCH'] as const)(
    'sem %s falha fechado (null): sem config explícita não há capacidade de push',
    key => expect(branchPublicationTargetFromEnvironment({ ...base, [key]: '' })).toBeNull(),
  );

  test('remote ou base inseguros (espaço, refspec, traversal) falham fechado', () => {
    expect(branchPublicationTargetFromEnvironment({ ...base, ANIMA_INTEGRATION_REMOTE_NAME: 'ori gin' })).toBeNull();
    expect(branchPublicationTargetFromEnvironment({ ...base, ANIMA_INTEGRATION_BASE_BRANCH: 'main:x' })).toBeNull();
    expect(branchPublicationTargetFromEnvironment({ ...base, ANIMA_INTEGRATION_BASE_BRANCH: '../evil' })).toBeNull();
    expect(branchPublicationTargetFromEnvironment({ ...base, ANIMA_INTEGRATION_REMOTE_NAME: 'a*b' })).toBeNull();
  });

  test('repoRoot relativo falha fechado', () => {
    expect(branchPublicationTargetFromEnvironment({ ...base, ANIMA_INTEGRATION_REPO_ROOT: 'relativo/anima' })).toBeNull();
  });

  test('sem ANIMA_INTEGRATION_REPO_ROOT usa a raiz absoluta do projeto', () => {
    const { ANIMA_INTEGRATION_REPO_ROOT, ...withoutRoot } = base as Record<string, string>;
    void ANIMA_INTEGRATION_REPO_ROOT;
    const resolved = branchPublicationTargetFromEnvironment(withoutRoot as NodeJS.ProcessEnv);
    expect(resolved).not.toBeNull();
    expect(resolved!.repoRoot.length).toBeGreaterThan(0);
  });

  test('o cliente não influencia: a função só lê o ambiente do servidor', () => {
    // Não há parâmetro por onde um payload de cliente entre; o provider é fixo.
    expect(branchPublicationTargetFromEnvironment(base)!.target.providerId).toBe(BRANCH_PUBLICATION_PROVIDER_ID);
  });
});
