// Project Builder V0 — T5. Ato HUMANO/operacional da integração Git de candidato EXTERNO. NÃO foi executado nesta etapa:
// exige a migration 20261026000000 aplicada ao Supabase residente (checkpoint humano) e ANIMA_EXTERNAL_TARGET + ANIMA_EXTERNAL_INTEGRATION.
//   authorize <workItemId> <authorizationId>   registra a autorização humana (lê o SHA atual do destino; só ff_only)
//   execute   <workItemId> <authorizationId>   executa o efeito autorizado e grava o recibo pelo Trusted System Writer
// Uso: npx tsx scripts/external-integration-run.ts authorize|execute <id> <authorizationId>
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveCliIdentity } from '../cli/identity';
import { createWorkOrchestrationService } from '../lib/work-orchestration/server';
import { createExternalReviewDeps, externalAcceptanceRefusal } from '../lib/work-orchestration/external-candidate-review';
import {
  authorizeExternalIntegrationEffect, EXTERNAL_INTEGRATION_ENV, executeAuthorizedExternalIntegration, operatorWorkTreeOptions, parseExternalIntegrationConfig,
  supabaseExternalLeasePort,
} from '../lib/work-orchestration/external-integration';
import { verifyExternalTargetForContract } from '../lib/work-orchestration/external-target-resolver';
import { createTrustedGitRunner } from '../lib/work-orchestration/trusted-git';
import { defaultTrustedSystemWriter } from '../lib/work-orchestration/trusted-system-writer';

const [command, workItemId, authorizationId] = process.argv.slice(2);
if ((command !== 'authorize' && command !== 'execute') || !workItemId || !authorizationId) {
  console.error('uso: external-integration-run.ts authorize|execute <workItemId> <authorizationId>');
  process.exit(2);
}
const config = parseExternalIntegrationConfig(process.env[EXTERNAL_INTEGRATION_ENV]);
if (!config.ok) { console.error(`${config.code}: ${config.message}`); process.exit(2); }

const identity = await resolveCliIdentity();
if (!identity.ok) { console.error(identity.error); process.exit(2); }
const { client, userId } = identity.identity;
const service = createWorkOrchestrationService(client);
const common = {
  getItem: (id: string) => service.getItem(id as never), listEvents: (id: string) => service.listEvents(id as never),
  config: config.config, verifyTarget: (c: Parameters<typeof verifyExternalTargetForContract>[0]) => verifyExternalTargetForContract(c),
  gitFor: (gitDir: string) => createTrustedGitRunner({ gitDir }), exists: existsSync,
};

if (command === 'authorize') {
  const outcome = await authorizeExternalIntegrationEffect({ workItemId, authorizationId }, {
    ...common,
    rpc: async (args) => { const { data, error } = await client.rpc('authorize_external_integration_effect', args); return { data, error: error ? { message: error.message } : null }; },
  });
  console.log(JSON.stringify(outcome, null, 2));
  process.exit(outcome.ok ? 0 : 1);
}

const reviewDeps = createExternalReviewDeps(client, userId, service);
const outcome = await executeAuthorizedExternalIntegration({ workItemId, integrationAuthorizationId: authorizationId }, {
  ...common,
  lease: supabaseExternalLeasePort(client),
  humanReviewRefusal: (id) => externalAcceptanceRefusal(id, reviewDeps),
  persist: defaultTrustedSystemWriter().integrationReceipt,
  workTreeOptions: operatorWorkTreeOptions((args) => { try { return execFileSync('git', [...args], { encoding: 'utf8', cwd: tmpdir(), windowsHide: true }).trim(); } catch { return null; } }),
  ownerInstanceId: `external-integration-${process.pid}-${Date.now().toString(36)}`,
});
console.log(JSON.stringify(outcome, null, 2));
process.exit(outcome.status === 'integrated' ? 0 : 1);
