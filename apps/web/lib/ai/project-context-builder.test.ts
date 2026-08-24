import { validateProjectAdvisorContext } from '@anima/core';
import { buildProjectAdvisorContext, PROJECT_ADVISOR_SOURCE_PATHS, sanitizeProjectContext, sanitizeProjectGitStatus } from './project-context-builder';

describe('Project Context Builder governado', () => {
  const originalRoot = process.env.ANIMA_PROJECT_ROOT;

  beforeAll(() => { process.env.ANIMA_PROJECT_ROOT = 'G:\\anima'; });
  afterAll(() => {
    if (originalRoot === undefined) delete process.env.ANIMA_PROJECT_ROOT;
    else process.env.ANIMA_PROJECT_ROOT = originalRoot;
  });

  test('seleciona as quatro classes com proveniência e orçamento limitado', async () => {
    const context = await buildProjectAdvisorContext('Como está o desenvolvimento do Anima e qual deveria ser nosso próximo passo?');
    expect(validateProjectAdvisorContext(context)).toEqual([]);
    expect(new Set(context.sources.map(source => source.authority))).toEqual(new Set([
      'canonical', 'observed_state', 'evidence', 'historical_record',
    ]));
    expect(context.sources.reduce((sum, source) => sum + source.content.length, 0)).toBeLessThanOrEqual(28_000);
    expect(context.sources.every(source => source.provenance.length > 0)).toBe(true);
  });

  test('usa allowlist explícita e nunca inclui configuração ou segredo', () => {
    expect(PROJECT_ADVISOR_SOURCE_PATHS.length).toBeGreaterThan(0);
    expect(PROJECT_ADVISOR_SOURCE_PATHS.some(path => /\.env|settings\.local|\.git\//i.test(path))).toBe(false);
    expect(sanitizeProjectContext(`api_key=super-secret-value token:${'abc123456789xyz'} sk-${'abcdefghijklmnop'}`))
      .toBe('[REDACTED] [REDACTED] [REDACTED]');
  });

  test('incorpora observação viva somente como fonte tipada e redigida', async () => {
    const context = await buildProjectAdvisorContext('estado atual do projeto Anima', [{
      id: 'live-test', authority: 'observed_state', provenance: 'read-only test', content: `token:${'abc123456789xyz'} state=review`,
    }]);
    const live = context.sources.find(source => source.id === 'live-test');
    expect(live?.content).toBe('[REDACTED] state=review');
    expect(live?.authority).toBe('observed_state');
  });

  test('remove caminhos locais sensíveis mesmo com prefixo porcelain do Git', () => {
    expect(sanitizeProjectGitStatus(' M apps/web/page.tsx\n?? .worktrees/\n?? .claude/settings.local.json\n?? apps/web/.env.local'))
      .toBe(' M apps/web/page.tsx');
  });
});
