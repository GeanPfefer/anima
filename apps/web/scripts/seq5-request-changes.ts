// FASE 1 (decisão humana REQUEST_CHANGES, 2026-09-14): persiste request_changes no seq.5
// (dae3be71) pelo caminho CANÔNICO (runWorkReview -> service.reviewResult), review ->
// changes_requested. O reason NOMEIA os 4 arquivos do escopo aprovado (para deriveExplicitReworkScope
// colocar todos em rework na correção) e encoda os blockers humanos B1/B2/B3. Não aprova, não
// classifica, não executa, não toca compute pago/ledger/origin/main.
import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { runWorkReview } from '@/cli/app';

const WORK_ITEM_ID = 'dae3be71-412d-4730-92ac-bf25b36af758';

const REASON = [
  'REQUEST_CHANGES (decisão humana): o resultado 61eb2eb NÃO implementou o actual-cost settlement OpenAI',
  '(apenas envolveu o parecer do Verifier num try/catch e escreveu testes que passam sem asseverar o',
  'contrato). Critérios materiais E1, E2 e E3 NÃO satisfeitos. Refaça de fato o binding.',
  '',
  'Rework autorizado (todos já no escopo aprovado):',
  '- apps/web/lib/work-orchestration/post-turn-observation.ts',
  '- apps/web/lib/work-orchestration/post-turn-observation.test.ts',
  '- apps/web/lib/work-orchestration/autonomous-backlog-deps.ts',
  '- apps/web/lib/work-orchestration/autonomous-backlog-deps-router.test.ts',
  '',
  'B1 (settlement real em post-turn-observation.ts): correlacionar a reservation aberta pelo lease',
  'provider-api:<attemptId>; usar usage terminal provider-reported real; carregar provider/model/cohort;',
  'chamar a primitive de cálculo com ProviderPricingV1 explícito/versionado; adaptar OpenAISettlementAuditV1',
  'para {reservationId, settled: actualCost, costSource}; chamar settlePaidComputeBudgetReservation somente',
  'com settlement factual válido. Invariantes: pricing conhecido -> liquida custo real; pricing=null/ausente',
  '-> cost_unknown; nunca inventar custo; reserva aberta quando custo não é conhecível; reserved!=settled;',
  'over-reservation honesto; replay idempotente; nenhuma liquidação duplicada; nenhuma correlação com',
  'attempt/item errado.',
  '',
  'B2 (caller vivo em autonomous-backlog-deps.ts): buildProjectBacklogCycleDeps(...).runTurn deve fornecer',
  'ao adapter attemptId, reservation/lease, provider, model, pricing cohort/version e usage terminal',
  'provider-reported; o caminho real deve alcançar caller vivo -> post-turn adapter -> primitive -> store/RPC.',
  'Não basta provar que um hook foi chamado com observações vazias.',
  '',
  'B3 (testes/gates reais): provar semanticamente pricing conhecido -> settlement calculado; pricing=null ->',
  'cost_unknown e nenhum settlement inventado; usage ausente; pricing ausente/inválido; replay idempotente;',
  'over-reservation; provider incompatível; model incompatível; moeda incompatível; correlação correta',
  'attempt<->reservation; caller vivo alcançando adapter/primitive/store; Ollama intocado; RunPod intocado;',
  'nenhum arquivo fora do escopo. O gate do caller vivo (autonomous-backlog-deps-router.test.ts) NÃO pode',
  'passar apenas porque persistPostTurnHostObservations(...) foi chamado com observações vazias: deve provar',
  'a correlação e o caminho de settlement material.',
].join('\n');

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const service = createWorkOrchestrationService(client);

  const result = await runWorkReview(service, WORK_ITEM_ID, { type: 'request_changes', requestedChanges: REASON });
  console.log(JSON.stringify({ exitCode: result.exitCode, payload: result.payload }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
