const REQUIRED_VARIABLES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'ANIMA_RESIDENT_EMAIL',
  'ANIMA_RESIDENT_PASSWORD',
] as const;

type RequiredVariable = (typeof REQUIRED_VARIABLES)[number];

type DevReadinessBody =
  | {
      readonly ready: false;
      readonly status: 'blocked';
      readonly reason: 'production';
      readonly missingVariables: readonly [];
      readonly invalidVariables: readonly [];
    }
  | {
      readonly ready: boolean;
      readonly status: 'ready' | 'not_ready';
      readonly missingVariables: readonly RequiredVariable[];
      readonly invalidVariables: readonly RequiredVariable[];
    };

export interface DevReadinessResult {
  readonly statusCode: 200 | 403 | 503;
  readonly body: DevReadinessBody;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValid(variable: RequiredVariable, value: string): boolean {
  if (variable === 'NEXT_PUBLIC_SUPABASE_URL') return isHttpUrl(value);
  if (variable === 'ANIMA_RESIDENT_EMAIL') return isValidEmail(value);
  return value.length > 0;
}

export function evaluateDevReadiness(env: NodeJS.ProcessEnv): DevReadinessResult {
  if (env.NODE_ENV === 'production') {
    return {
      statusCode: 403,
      body: {
        ready: false,
        status: 'blocked',
        reason: 'production',
        missingVariables: [],
        invalidVariables: [],
      },
    };
  }

  const missingVariables: RequiredVariable[] = [];
  const invalidVariables: RequiredVariable[] = [];

  for (const variable of REQUIRED_VARIABLES) {
    const rawValue = env[variable];
    if (rawValue === undefined || rawValue.trim() === '') {
      missingVariables.push(variable);
      continue;
    }
    if (!isValid(variable, rawValue.trim())) invalidVariables.push(variable);
  }

  const ready = missingVariables.length === 0 && invalidVariables.length === 0;
  return {
    statusCode: ready ? 200 : 503,
    body: {
      ready,
      status: ready ? 'ready' : 'not_ready',
      missingVariables,
      invalidVariables,
    },
  };
}

export function GET() {
  const result = evaluateDevReadiness(process.env);
  return Response.json(result.body, { status: result.statusCode });
}
