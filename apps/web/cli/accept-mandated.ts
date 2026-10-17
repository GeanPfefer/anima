// Ponto de entrada do ACEITE SOB MANDATO (processo do operador/writer — NUNCA o do runner). Execute com o env do servidor
// (leitura pela sessão residente; escrita somente pelo Trusted System Writer) e o repositório confiável explícito:
//   node --no-warnings --experimental-transform-types --import ./scripts/ts-resolve.mjs --env-file=.env.local cli/accept-mandated.ts <item> --mandate <id> --repo <caminho>
// Recusa rodar com ANIMA_EXECUTION_* herdado e com segredos do grantor. Nenhuma credencial é lida aqui: o writer vem de
// `trustedSystemWriterFromEnvironment` e a sessão de leitura de `resolveCliIdentity`.
import { resolveCliIdentity } from './identity';
import { runAcceptMandatedCli, supabaseLedgerReader } from '../lib/work-orchestration/mandated-acceptance-run';
import { trustedSystemWriterFromEnvironment } from '../lib/work-orchestration/trusted-system-writer';

const code = await runAcceptMandatedCli(process.argv.slice(2), {
  env: process.env,
  writer: trustedSystemWriterFromEnvironment(process.env),
  resolveReader: async () => {
    const identity = await resolveCliIdentity(process.env);
    return identity.ok ? supabaseLedgerReader(identity.identity.client) : null;
  },
  write: (line) => process.stdout.write(`${line}\n`),
});
process.exitCode = code;
