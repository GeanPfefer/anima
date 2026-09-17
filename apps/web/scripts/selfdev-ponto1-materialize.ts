// OPERACIONAL (não commitar): MATERIALIZA canonicamente o próximo Work Item de self-dev
// (Ponto 1 — alinhar caminho legado ao Compute Router), via o pipeline REAL: mensagem →
// item (placeholder) → autoridade paga provider_api do item → planejador FORTE OpenAI
// (proveniência canônica 'openai_project_tools_v1', exigida pela classificação) → revise.
// PARA ANTES de aprovar: imprime a proposta planejada + análise de alinhamento
// (covers ⊆ expectedEffects) para inspeção humana/host. Identidade residente (Bearer/RLS),
// NUNCA service_role. NÃO aprova, NÃO executa, NÃO gasta com coder (só o planner).

process.env.ANIMA_AI_PROVIDER = 'openai';
process.env.ANIMA_WORKTREE_CODER_BACKEND = 'openai'; // ⇒ execution_spec.coder_backend='openai' (preferred p/ Router)

import type { CreateWorkProposalCommand } from '@anima/core';
import { resolveCliIdentity } from '@/cli/identity';
import { OpenAIProjectWorkPlanner, planExecutableProjectWork } from '@/lib/ai/project-work-planner';
import { createOpenAIPlannerAdmission } from '@/lib/work-orchestration/openai-paid-compute';
import { grantPaidComputeAuthorization, readActivePaidComputeAuthorization } from '@/lib/work-orchestration/paid-compute-authorization-store';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { readAuthorizedBaseSha, readExecutionContract } from '@/lib/work-orchestration/executor-selection';

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
const CEILING_USD = 0.5;

const TASK_MESSAGE = [
  'Corrija uma inconsistência estrutural no orquestrador autônomo do Anima, em apps/web.',
  'Arquivo alvo: apps/web/lib/work-orchestration/autonomous-backlog-deps.ts.',
  'Problema: no caminho legado (Compute Router DESLIGADO), a linha que decide o placement é',
  '`let placement = routedToOpenAI ? null : decideCoderPlacement(...)`. A guarda `routedToOpenAI`',
  'só cobre o Router LIGADO. Quando o backend efetivo do contrato já é OpenAI/provider_api',
  "(contract.coderBackend === 'openai'), o fluxo ainda calcula placement local e, sob defer ou",
  'ANIMA_ON_DEMAND_FORCE_BURST, tenta provisionar um node RunPod que o coder de API não usa —',
  'causando provisionamento desnecessário e falha antes do coder.',
  'Correção mínima: o placement deve ser null também quando o backend efetivo é openai/provider_api,',
  "espelhando a decisão do Router: `const placement = (routedToOpenAI || contract.coderBackend === 'openai')",
  '? null : decideCoderPlacement(...)`. Assim, coder provider_api NUNCA entra em placement/burst e',
  'prepareCloudCoderNode NUNCA é chamado nesse caso. Preserve integralmente o comportamento do',
  'caminho Ollama/local (nenhuma mudança de comportamento para coderBackend ollama/null).',
  'Escopo permitido: SOMENTE apps/web/lib/work-orchestration/autonomous-backlog-deps.ts e o arquivo',
  'de teste focal existente apps/web/lib/work-orchestration/autonomous-backlog-deps-router.test.ts',
  '(estenda o teste existente; não crie um segundo arquivo de teste).',
  'Adicione ao teste um caso: Router OFF + contract.coderBackend="openai" ⇒ placement null ⇒',
  'prepareCloudCoderNode NÃO é chamado (nenhuma reserva/burst RunPod); e um caso de regressão',
  'confirmando que o caminho ollama/local permanece inalterado.',
  'IMPORTANTE para os critérios de validação: use expected_effects e validation_covers ALINHADOS —',
  'cada string em validation_covers DEVE ser exatamente uma das strings de expected_effects (o Verifier',
  'reprova quando um covers não está em expected_effects). Use expected_effects enxutos que o teste focal',
  'realmente prova, por exemplo: (1) "Com o Compute Router OFF e coderBackend openai, o placement é null e',
  'prepareCloudCoderNode não é chamado (nenhum burst/reserva RunPod)."; (2) "O caminho Ollama/local',
  'permanece inalterado, comprovado por teste de regressão." O comando de validação focal deve ser o',
  'teste Jest do arquivo autonomous-backlog-deps-router.test.ts e cobrir exatamente esses expected_effects.',
].join(' ');

function log(o: unknown): void { console.log(JSON.stringify(o, null, 2)); }

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;
  const service = createWorkOrchestrationService(client);

  const baseSha = await readAuthorizedBaseSha();
  if (!baseSha) throw new Error('HEAD não pôde ser resolvido como base autorizada.');
  log({ step: 'base', userId, baseSha, model: MODEL });

  const source = await client.from('ai_conversations').insert({ user_id: userId, role: 'user', content: TASK_MESSAGE }).select('id').single();
  if (source.error || !source.data) throw new Error(`Falha ao persistir mensagem de origem: ${source.error?.message ?? 'sem linha'}`);
  const sourceMessageId = source.data.id;

  const placeholder: CreateWorkProposalCommand = {
    sourceMessageId, impactLevel: 'low', capability: 'programming',
    intent: { planner: 'admission_placeholder' },
    proposal: { schemaVersion: 1, data: {
      summary: 'Placeholder de admissão — aguardando planejamento forte (OpenAI) do Ponto 1.',
      objective: 'Abrir o item para conceder autoridade paga por-item antes do planejamento forte.',
      includedScope: ['(a definir pelo planejador forte)'],
      excludedScope: ['Integração', 'Merge', 'Publicação', 'main'],
      expectedEffects: ['A proposta terminal real será planejada pelo planejador OpenAI.'],
      risks: ['Nenhum: placeholder não executável, substituído antes de aprovar.'],
    } },
  };
  const created = await service.createProposal(placeholder);
  if (!created.ok) throw new Error(`Abertura do item (placeholder) recusada: ${created.error.code} ${created.error.message}`);
  const workItemId = created.value.id;
  const placeholderVersion = created.value.proposalVersion;
  log({ step: 'placeholder_created', workItemId, placeholderVersion });

  const now = Date.now();
  const grant = await grantPaidComputeAuthorization(client, {
    providerId: 'openai', nodeId: 'openai-api', resourceClass: `provider_api:${MODEL}`, workItemId,
    maxDurationMs: 30 * 60_000, maxCost: { currency: 'USD', amount: CEILING_USD },
    validFrom: new Date(now - 30_000).toISOString(), validUntil: new Date(now + 24 * 60 * 60_000).toISOString(),
  });
  if (!grant.ok) throw new Error(`Autorização paga do item recusada: ${grant.code} ${grant.message}`);
  log({ step: 'authority_granted', authorizationId: grant.authorizationId, ceiling: CEILING_USD });

  const planner = new OpenAIProjectWorkPlanner({ admission: createOpenAIPlannerAdmission(client, workItemId), userId, model: MODEL });
  const planningBase: CreateWorkProposalCommand = { sourceMessageId, impactLevel: 'low', capability: 'programming', intent: {}, proposal: placeholder.proposal };
  const planned = await planExecutableProjectWork(TASK_MESSAGE, planningBase, planner);
  if (!planned.ok) throw new Error(`Planner falhou: ${planned.message}`);

  const revised = await service.reviseProposal({ workItemId, expectedProposalVersion: placeholderVersion, intent: planned.command.intent, proposal: planned.command.proposal });
  if (!revised.ok) throw new Error(`Revise recusado: ${revised.error.code} ${revised.error.message}`);
  const terminalVersion = revised.value.proposalVersion;

  const spec = readExecutionContract(planned.command.intent);
  const criteria = ((planned.command.intent as { execution_spec?: { validation_criteria?: { label: string; command?: string; proof?: string; covers?: string[] }[] } }).execution_spec?.validation_criteria) ?? [];
  const expectedEffects = planned.command.proposal.data.expectedEffects ?? [];
  const expectedSet = new Set(expectedEffects);
  const unknownCovers = criteria.flatMap(c => (c.covers ?? []).filter(cov => !expectedSet.has(cov)));
  const uncoveredEffects = expectedEffects.filter(e => !criteria.some(c => (c.covers ?? []).includes(e)));

  log({ step: 'planned_terminal', workItemId, terminalVersion,
    plannerId: planned.command.intent && (planned.command.intent as { planner?: string }).planner,
    coderBackend: spec.coderBackend, model: spec.model, baseSha: spec.baseSha,
    includedScope: planned.command.proposal.data.includedScope,
    excludedScope: planned.command.proposal.data.excludedScope,
    expectedEffects,
    validationCriteria: criteria.map(c => ({ label: c.label, command: c.command ?? null, proof: c.proof ?? (c.command ? 'gate' : 'declared'), covers: c.covers ?? [] })),
    ALIGNMENT: { unknownCovers, uncoveredEffects, aligned: unknownCovers.length === 0 && uncoveredEffects.length === 0 },
    note: 'NÃO aprovado ainda. Inspecionar ALIGNMENT antes de aprovar/classificar/executar.',
  });

  const confirmAuth = await readActivePaidComputeAuthorization(client, { providerId: 'openai', nodeId: 'openai-api', resourceClass: `provider_api:${MODEL}`, workItemId, now: new Date() });
  log({ step: 'authority_confirm', authorizationId: confirmAuth?.authorizationId ?? null, maxCost: confirmAuth?.maxCostEstimate ?? null });
}

void main().catch(error => { console.error(error instanceof Error ? (error.stack ?? error.message) : String(error)); process.exitCode = 1; });
