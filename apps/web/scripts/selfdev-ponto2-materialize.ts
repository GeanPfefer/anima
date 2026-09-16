// OPERACIONAL (não commitar): materializa o Work Item governado do Ponto 2.
process.env.ANIMA_AI_PROVIDER = 'openai';
process.env.ANIMA_WORKTREE_CODER_BACKEND = 'openai';

import type { CreateWorkProposalCommand } from '@anima/core';
import { resolveCliIdentity } from '@/cli/identity';
import { OpenAIProjectWorkPlanner, planExecutableProjectWork } from '@/lib/ai/project-work-planner';
import { createOpenAIPlannerAdmission } from '@/lib/work-orchestration/openai-paid-compute';
import { grantPaidComputeAuthorization, readActivePaidComputeAuthorization } from '@/lib/work-orchestration/paid-compute-authorization-store';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { readAuthorizedBaseSha, readExecutionContract } from '@/lib/work-orchestration/executor-selection';

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
const CEILING_USD = 1.0;
const TASK_MESSAGE = [
  'Implemente no ANIMA um recorte mínimo e governado de OpenAI actual-cost settlement para attempts do coder provider_api.',
  'Descubra e reutilize os seams existentes: ProviderPricingV1 e calculateApiAttemptCost em packages/core, usage provider-reported persistido em host_observed_coder_evidence_recorded, a reservationId devolvida por createOpenAICoderAdmission, o ledger append-only e settlePaidComputeBudgetReservation, e a observação pós-turno.',
  'Invariantes: reserved não é settled; use usage real reportado pelo provider; pricing deve ser explícito, canônico, versionado e auditável (effectiveFrom/sourceRef); cost_source estimated é permitido quando honesto; persista evidência suficiente de usage, fórmula/pricing e settlement; nunca liquide acima da reserva; ausência/inconsistência de usage ou pricing, moeda/model/provider incompatível, ou custo acima da reserva devem falhar fechado e manter a reserva aberta; replay deve ser idempotente.',
  'Não altere nem quebre o settlement RunPod. Não mude Verifier v2. Não toque o fix do Ponto 1 em autonomous-backlog-deps-router.test.ts. Não faça settlement da reserva histórica c0edc775 neste item.',
  'Prefira uma API pura de decisão/cálculo em packages/core e um adaptador host-side estreito em apps/web, ligado ao término do attempt OpenAI somente depois de a evidência de usage estar disponível. Preserve provider request ids/proveniência quando existentes.',
  'Inclua testes focais cobrindo: custo por input não-cacheado + cache + output; pricing ausente/inválido ou usage ausente/inconsistente mantém reserva aberta; custo maior que reserva recusa settlement; settlement válido chama a RPC uma vez com estimated e dados auditáveis; replay não duplica; caminhos Ollama e RunPod não são alterados.',
  'Mantenha o escopo mínimo necessário. Não inclua migrations salvo se o contrato de evidência persistida existente for comprovadamente insuficiente; se uma migration for inevitável, explique no plano e inclua teste pgTAP e tipos, sem service_role.',
  'Use critérios validation_criteria proof-typed com covers exatamente iguais aos expected_effects. Gates devem ser comandos focais reais para os arquivos escolhidos. Não integrar, mergear, publicar, fazer deploy nem tocar origin/main.',
].join(' ');

const log = (value: unknown): void => console.log(JSON.stringify(value, null, 2));

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;
  const service = createWorkOrchestrationService(client);
  const baseSha = await readAuthorizedBaseSha();
  if (!baseSha) throw new Error('HEAD não pôde ser resolvido como base autorizada.');
  const source = await client.from('ai_conversations').insert({ user_id: userId, role: 'user', content: TASK_MESSAGE }).select('id').single();
  if (source.error || !source.data) throw new Error(source.error?.message ?? 'Mensagem de origem não persistida.');
  const placeholder: CreateWorkProposalCommand = {
    sourceMessageId: source.data.id, impactLevel: 'low', capability: 'programming', intent: { planner: 'admission_placeholder' },
    proposal: { schemaVersion: 1, data: { summary: 'Placeholder de admissão do Ponto 2.', objective: 'Planejar settlement OpenAI auditável.', includedScope: ['(a definir pelo planejador forte)'], excludedScope: ['Verifier v2', 'Ponto 1', 'origin/main', 'integração'], expectedEffects: ['A proposta terminal será produzida pelo planejador OpenAI.'], risks: ['Placeholder não executável.'] } },
  };
  const created = await service.createProposal(placeholder);
  if (!created.ok) throw new Error(`${created.error.code}: ${created.error.message}`);
  const workItemId = created.value.id;
  const grant = await grantPaidComputeAuthorization(client, { providerId: 'openai', nodeId: 'openai-api', resourceClass: `provider_api:${MODEL}`, workItemId, maxDurationMs: 45 * 60_000, maxCost: { currency: 'USD', amount: CEILING_USD }, validFrom: new Date(Date.now() - 30_000).toISOString(), validUntil: new Date(Date.now() + 86_400_000).toISOString() });
  if (!grant.ok) throw new Error(`${grant.code}: ${grant.message}`);
  const planner = new OpenAIProjectWorkPlanner({ admission: createOpenAIPlannerAdmission(client, workItemId), userId, model: MODEL });
  const planned = await planExecutableProjectWork(TASK_MESSAGE, { sourceMessageId: source.data.id, impactLevel: 'low', capability: 'programming', intent: {}, proposal: placeholder.proposal }, planner);
  if (!planned.ok) throw new Error(planned.message);
  const revised = await service.reviseProposal({ workItemId, expectedProposalVersion: created.value.proposalVersion, intent: planned.command.intent, proposal: planned.command.proposal });
  if (!revised.ok) throw new Error(`${revised.error.code}: ${revised.error.message}`);
  const spec = readExecutionContract(planned.command.intent);
  const criteria = ((planned.command.intent as { execution_spec?: { validation_criteria?: { label: string; command?: string; proof?: string; covers?: string[] }[] } }).execution_spec?.validation_criteria) ?? [];
  const effects = planned.command.proposal.data.expectedEffects ?? [];
  const expected = new Set(effects);
  const unknownCovers = criteria.flatMap(c => (c.covers ?? []).filter(value => !expected.has(value)));
  const uncoveredEffects = effects.filter(effect => !criteria.some(c => (c.covers ?? []).includes(effect)));
  const auth = await readActivePaidComputeAuthorization(client, { providerId: 'openai', nodeId: 'openai-api', resourceClass: `provider_api:${MODEL}`, workItemId, now: new Date() });
  log({ step: 'planned_terminal', workItemId, terminalVersion: revised.value.proposalVersion, authorizationId: grant.authorizationId, authorityConfirmed: auth?.authorizationId ?? null, model: MODEL, coderBackend: spec.coderBackend, includedScope: planned.command.proposal.data.includedScope, excludedScope: planned.command.proposal.data.excludedScope, expectedEffects: effects, validationCriteria: criteria, ALIGNMENT: { unknownCovers, uncoveredEffects, aligned: unknownCovers.length === 0 && uncoveredEffects.length === 0 } });
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
