import { GET } from './route';

const originalEnvironment = process.env;
const originalResponseDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Response');

const responseJson = jest.fn((body: unknown, init?: ResponseInit) => ({
  status: init?.status ?? 200,
  json: async () => body,
}));

beforeAll(() => {
  Object.defineProperty(globalThis, 'Response', {
    configurable: true,
    writable: true,
    value: { json: responseJson },
  });
});

afterAll(() => {
  if (originalResponseDescriptor) {
    Object.defineProperty(globalThis, 'Response', originalResponseDescriptor);
  } else {
    delete (globalThis as { Response?: typeof Response }).Response;
  }
});

beforeEach(() => {
  process.env = {
    ...originalEnvironment,
    NODE_ENV: 'development',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key',
  };
  responseJson.mockClear();
});

afterEach(() => {
  process.env = originalEnvironment;
});

async function readResponse() {
  const response = GET();
  return { status: response.status, body: await response.json() };
}

describe('dev readiness GET', () => {
  it('reports ready with both required variables without exposing their values', async () => {
    const result = await readResponse();

    expect(result).toEqual({
      status: 200,
      body: {
        ready: true,
        status: 'ready',
        missingVariables: [],
        invalidVariables: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain('http://127.0.0.1:54321');
    expect(JSON.stringify(result)).not.toContain('public-anon-key');
  });

  it('reports a missing URL', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    expect(await readResponse()).toEqual({
      status: 503,
      body: {
        ready: false,
        status: 'not_ready',
        missingVariables: ['NEXT_PUBLIC_SUPABASE_URL'],
        invalidVariables: [],
      },
    });
  });

  it('reports an invalid URL without exposing its value', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'not-a-secret-url';
    const result = await readResponse();

    expect(result).toEqual({
      status: 503,
      body: {
        ready: false,
        status: 'not_ready',
        missingVariables: [],
        invalidVariables: ['NEXT_PUBLIC_SUPABASE_URL'],
      },
    });
    expect(JSON.stringify(result)).not.toContain('not-a-secret-url');
  });

  it('reports a missing anon key', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    expect(await readResponse()).toEqual({
      status: 503,
      body: {
        ready: false,
        status: 'not_ready',
        missingVariables: ['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
        invalidVariables: [],
      },
    });
  });

  it('reports an empty anon key', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '   ';

    expect(await readResponse()).toEqual({
      status: 503,
      body: {
        ready: false,
        status: 'not_ready',
        missingVariables: ['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
        invalidVariables: [],
      },
    });
  });

  it('blocks production before inspecting configuration', async () => {
    process.env = { NODE_ENV: 'production' };

    expect(await readResponse()).toEqual({
      status: 403,
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
