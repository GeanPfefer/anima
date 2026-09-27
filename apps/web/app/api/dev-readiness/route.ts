const REQUIRED_VARIABLES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

type RequiredVariable = (typeof REQUIRED_VARIABLES)[number];

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function GET() {
  if (process.env.NODE_ENV === 'production') {
    return Response.json(
      {
        ready: false,
        status: 'blocked',
        reason: 'production',
        missingVariables: [],
        invalidVariables: [],
      },
      { status: 403 },
    );
  }

  const missingVariables: RequiredVariable[] = [];
  const invalidVariables: RequiredVariable[] = [];

  for (const variable of REQUIRED_VARIABLES) {
    const rawValue = process.env[variable];
    if (rawValue === undefined || rawValue.trim() === '') {
      missingVariables.push(variable);
      continue;
    }

    if (variable === 'NEXT_PUBLIC_SUPABASE_URL' && !isHttpUrl(rawValue.trim())) {
      invalidVariables.push(variable);
    }
  }

  const ready = missingVariables.length === 0 && invalidVariables.length === 0;
  return Response.json(
    {
      ready,
      status: ready ? 'ready' : 'not_ready',
      missingVariables,
      invalidVariables,
    },
    { status: ready ? 200 : 503 },
  );
}
