// Ponto de entrada do GRANTOR de mandatos de aceite. Execute com um env-file PRÓPRIO (sem as credenciais do runner):
//   node --no-warnings --experimental-transform-types --import ./scripts/ts-resolve.mjs --env-file=<grantor.env> cli/mandate.ts <comando> ...
// O arquivo <grantor.env> contém apenas NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e ANIMA_MANDATE_GRANTOR_EMAIL.
// A senha é digitada em prompt oculto; nunca é lida do ambiente, impressa ou gravada.
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { createBearerClient } from '../lib/supabase/bearer';
import { runMandateCli } from '../lib/work-orchestration/mandate-grantor-cli';

function promptHidden(label: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({ write(chunk, _enc, cb) { if (!muted) process.stderr.write(chunk); cb(); } });
    const rl = createInterface({ input: process.stdin, output, terminal: true });
    process.stderr.write(label);
    muted = true;
    rl.question('', (answer) => { muted = false; rl.close(); process.stderr.write('\n'); resolve(answer); });
  });
}

async function signIn({ email, password }: { email: string; password: string }): Promise<{ accessToken: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon }, body: JSON.stringify({ email, password }) });
    if (!res.ok) return null;
    const body = await res.json() as { access_token?: unknown };
    return typeof body.access_token === 'string' ? { accessToken: body.access_token } : null;
  } catch { return null; }
}

const code = await runMandateCli(process.argv.slice(2), {
  env: process.env, promptHidden, signIn, clientFor: createBearerClient, write: (line) => process.stdout.write(`${line}\n`),
});
process.exitCode = code;
