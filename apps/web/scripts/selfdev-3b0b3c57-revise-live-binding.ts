// Revisa o successor de correction 3b0b3c57 para o menor recorte terminal do
// binding vivo. Não aprova, não executa, não chama provider e não concede authority.
import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { readExecutionContract } from '@/lib/work-orchestration/executor-selection';

const WORK_ITEM_ID = '3b0b3c57-a1d0-4bbe-a719-829b680ca6d1';
const EXPECTED_VERSION = 2;

const POST_TURN = 'apps/web/lib/work-orchestration/post-turn-observation.ts';
const POST_TURN_TEST = 'apps/web/lib/work-orchestration/post-turn-observation.test.ts';
const BACKLOG_DEPS = 'apps/web/lib/work-orchestration/autonomous-backlog-deps.ts';
const INCLUDED_SCOPE = [POST_TURN, POST_TURN_TEST, BACKLOG_DEPS];

const E1 = 'O caminho vivo de produção é provado atravessando buildProjectBacklogCycleDeps(...).runTurn até persistPostTurnHostObservations; a prova não pode chamar apenas settleOpenAIActualCostReservation diretamente.';
const E2 = 'Após um terminal OpenAI elegível, reservationId correlacionada ao attempt, attemptId, provider-reported usage agregada, ProviderPricingV1 explícito e cohort/audit context chegam corretamente à primitive settleOpenAIActualCostReservation.';
const E3 = 'O callback real fornecido pelo caminho vivo alcança settlePaidComputeBudgetReservation exatamente uma vez com reservationId, custo real e trilha auditável correlacionados.';
const E4 = 'Pricing ou usage ausentes/inválidos, correlação inválida, provider/model/moeda incompatíveis ou custo acima da reservation impedem qualquer settlement e mantêm a reserva aberta; o teto nunca é inferido como custo real.';
const E5 = 'Replay do terminal é idempotente e não liquida a mesma reservation duas vezes.';
const E6 = 'A primitive e o teste já verificados no commit b6201d8daaa50036e91b39c98e1ecf46d0e45130 permanecem preservados e são reutilizados sem duplicação da lógica de settlement.';
const E7 = `A correção altera somente ${INCLUDED_SCOPE.join(', ')}; Ollama, RunPod, Verifier, migrations, reservas históricas, merge, deploy e origin/main permanecem intocados.`;
const EXPECTED_EFFECTS = [E1, E2, E3, E4, E5, E6, E7];

const VALIDATION_CRITERIA = [
  {
    label: 'Jest focal do binding vivo pós-turno pelo caller de produção',
    command: 'npm test --workspace=@anima/web -- post-turn-observation.test.ts openai-actual-cost-settlement.test.ts',
    proof: 'gate',
    covers: [E1, E2, E3, E4, E5, E6],
  },
  {
    label: 'Typecheck web do contrato terminal',
    command: 'npm run typecheck --workspace=@anima/web',
    proof: 'gate',
    covers: [E2, E3],
  },
  { label: 'Contenção de escopo observada pelo host', proof: 'scope', covers: [E7] },
];

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const service = createWorkOrchestrationService(client);
  const current = await service.getItem(WORK_ITEM_ID);
  if (!current.ok) throw new Error(`${current.error.code}: ${current.error.message}`);
  if (current.value.state !== 'proposed' || current.value.proposalVersion !== EXPECTED_VERSION) {
    throw new Error(`estado/versão inesperado: ${current.value.state} v${current.value.proposalVersion}`);
  }
  const rawSpec = current.value.intent['execution_spec'];
  if (typeof rawSpec !== 'object' || rawSpec === null || Array.isArray(rawSpec)) {
    throw new Error('execution_spec ausente');
  }
  const intent = {
    ...current.value.intent,
    execution_spec: {
      ...rawSpec,
      // Mantém a referência forte já aprovada para esta linha; o successor
      // derivado herdou um model local incompatível com coder_backend=openai.
      model: 'gpt-5.6-terra',
      correction_scope: {
        rework_scope: INCLUDED_SCOPE,
        remaining_scope: INCLUDED_SCOPE,
        effective_scope: INCLUDED_SCOPE,
      },
      validation_criteria: VALIDATION_CRITERIA,
    },
  };
  const proposal = {
    schemaVersion: 1 as const,
    data: {
      summary: 'Correction terminal mínima: ligar o terminal OpenAI ao actual-cost settlement canônico e provar o caller vivo.',
      objective: 'Retomar do checkpoint b6201d8daaa50036e91b39c98e1ecf46d0e45130 e completar somente o binding vivo pós-turno: usar reservation/attempt/usage/pricing/cohort autoritativos, reutilizar settleOpenAIActualCostReservation e fornecer callback real para settlePaidComputeBudgetReservation, com fail-closed e replay idempotente.',
      includedScope: INCLUDED_SCOPE,
      excludedScope: [
        'packages/core/src/compute-economics.ts',
        'packages/core/src/compute-economics.test.ts',
        'apps/web/lib/work-orchestration/openai-actual-cost-settlement.ts',
        'apps/web/lib/work-orchestration/openai-actual-cost-settlement.test.ts',
        'apps/web/lib/work-orchestration/openai-paid-compute.ts',
        'apps/web/lib/work-orchestration/openai-paid-compute.test.ts',
        'apps/web/lib/work-orchestration/autonomous-backlog-deps-router.test.ts',
        'supabase/migrations',
        'reservas históricas',
        'settlement de reservas antigas',
        'Verifier v2',
        'Ponto 1',
        'integração',
        'merge',
        'deploy',
        'origin/main',
        'Ollama',
        'RunPod',
      ],
      expectedEffects: EXPECTED_EFFECTS,
      risks: [
        'Sem ProviderPricingV1 aplicável, o caminho deve manter a reservation aberta com cost_unknown.',
        'A prova precisa atravessar o caller de produção; um teste unitário direto da primitive não satisfaz o aceite.',
      ],
    },
  };
  const revised = await service.reviseProposal({
    workItemId: WORK_ITEM_ID,
    expectedProposalVersion: EXPECTED_VERSION,
    intent,
    proposal,
  });
  if (!revised.ok) throw new Error(`${revised.error.code}: ${revised.error.message}`);
  const contract = readExecutionContract(revised.value.intent);
  console.log(JSON.stringify({
    workItemId: revised.value.id,
    state: revised.value.state,
    proposalVersion: revised.value.proposalVersion,
    includedScope: revised.value.proposal.data.includedScope,
    coderBackend: contract.coderBackend,
    model: contract.model,
    resumeCheckpointCommitSha: contract.resumeCheckpointCommitSha,
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
