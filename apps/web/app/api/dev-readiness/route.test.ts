import { evaluateDevReadiness } from './route';

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key',
  ANIMA_RESIDENT_EMAIL: 'resident@example.test',
  ANIMA_RESIDENT_PASSWORD: 'private-password',
};

describe('dev readiness', () => {
  it('reports a ready development environment without exposing values', () => {
    const result = evaluateDevReadiness(validEnvironment);

    expect(result).toEqual({
      statusCode: 200,
      body: {
        ready: true,
        status: 'ready',
        missingVariables: [],
        invalidVariables: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain('public-anon-key');
    expect(JSON.stringify(result)).not.toContain('private-password');
  });

  it('reports missing and invalid variables in deterministic declaration order', () => {
    const result = evaluateDevReadiness({
      ...validEnvironment,
      NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '   ',
      ANIMA_RESIDENT_EMAIL: 'not-an-email',
      ANIMA_RESIDENT_PASSWORD: undefined,
    });

    expect(result).toEqual({
      statusCode: 503,
      body: {
        ready: false,
        status: 'not_ready',
        missingVariables: ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'ANIMA_RESIDENT_PASSWORD'],
        invalidVariables: ['NEXT_PUBLIC_SUPABASE_URL', 'ANIMA_RESIDENT_EMAIL'],
      },
    });
    expect(JSON.stringify(result)).not.toContain('not-a-url');
    expect(JSON.stringify(result)).not.toContain('not-an-email');
  });

  it('blocks the diagnostic explicitly in production before inspecting configuration', () => {
    expect(evaluateDevReadiness({ NODE_ENV: 'production' })).toEqual({
      statusCode: 403,
      body: {
        ready: false,
        status: 'blocked',
        reason: 'production',
        missingVariables: [],
        invalidVariables: [],
      },
    });
  });
});
