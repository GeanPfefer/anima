// Project Builder V0/V1 — T5. Ato HUMANO/operacional da integração Git de candidato EXTERNO por script (legado do V0).
// A interface OFICIAL agora é a CLI: `anima work external integrate inspect|authorize|execute` (V1-01). Este script é um adaptador
// fino sobre o MESMO serviço (lib/work-orchestration/external-integration-service.ts) e preserva o contrato original de saída:
//   authorize <workItemId> <authorizationId>   registra a autorização humana (lê o SHA atual do destino; só ff_only)
//   execute   <workItemId> <authorizationId>   executa o efeito autorizado e grava o recibo pelo Trusted System Writer
// Requer ANIMA_EXTERNAL_TARGET + ANIMA_EXTERNAL_INTEGRATION (e a migration T5). Rodar com as flags de node do repositório:
//   node --no-warnings --experimental-transform-types --import ./scripts/ts-resolve.mjs --env-file-if-exists=.env.local scripts/external-integration-run.ts ...
import { resolveCliIdentity } from '../cli/identity';
import { createWorkOrchestrationService } from '../lib/work-orchestration/server';
import { authorizeExternalIntegration, createExternalIntegrationRuntime, executeExternalIntegration } from '../lib/work-orchestration/external-integration-service';

const [command, workItemId, authorizationId] = process.argv.slice(2);
if ((command !== 'authorize' && command !== 'execute') || !workItemId || !authorizationId) {
  console.error('uso: external-integration-run.ts authorize|execute <workItemId> <authorizationId>');
  process.exit(2);
}

const identity = await resolveCliIdentity();
if (!identity.ok) { console.error(identity.error); process.exit(2); }
const { client, userId } = identity.identity;
const runtime = createExternalIntegrationRuntime(client, userId, createWorkOrchestrationService(client));
if (!runtime.config.ok) { console.error(`${runtime.config.code}: ${runtime.config.message}`); process.exit(2); }

if (command === 'authorize') {
  const result = await authorizeExternalIntegration(workItemId, runtime, authorizationId);
  console.log(JSON.stringify(result.ok
    ? { ok: true, action: result.action, operationKey: result.operationKey, expectedTargetSha: result.expectedTargetSha, targetRef: result.targetRef }
    : { ok: false, reason: result.code }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const outcome = await executeExternalIntegration(workItemId, authorizationId, runtime);
console.log(JSON.stringify(outcome, null, 2));
process.exit(outcome.status === 'integrated' ? 0 : 1);
