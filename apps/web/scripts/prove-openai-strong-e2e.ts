import { projectAutonomousQueue, type CreateWorkProposalCommand } from '@anima/core';
import { resolveCliIdentity } from '@/cli/identity';
import { OpenAIProjectWorkPlanner, planExecutableProjectWork } from '@/lib/ai/project-work-planner';
import { createOpenAIPlannerAdmission } from '@/lib/work-orchestration/openai-paid-compute';
import { buildProjectBacklogCycleDeps } from '@/lib/work-orchestration/autonomous-backlog-deps';
import { readAutonomousBacklogCandidates } from '@/lib/work-orchestration/autonomous-backlog-read';
import { readAuthorizedBaseSha, readExecutionContract } from '@/lib/work-orchestration/executor-selection';
import { grantPaidComputeAuthorization } from '@/lib/work-orchestration/paid-compute-authorization-store';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { redactSecrets as redact } from './prove-e2e-redact';

// ============================================================
// Prova viva END-TO-END com COMPUTE FORTE (OpenAI) do ciclo de auto-desenvolvimento
// do Anima, até `review`. Difere de `prove-openai-paid-coder.ts` num ponto essencial:
// a proposta terminal executada NÃO é escrita à mão — é PLANEJADA pelo planejador
// OpenAI a partir da mensagem real do usuário, sob autoridade paga humana governada.
// Depois o coder OpenAI produz o diff em worktree isolada, o gate roda e o Verifier opina.
//
// Ordem imposta pelo ledger (endurecimento provider_api): uma autoridade paga de
// `provider_api` EXIGE um work item concreto — nunca um wildcard. O planejamento
// precede a proposta terminal, então o item é aberto primeiro com um PLACEHOLDER de
// admissão (rótulo honesto, sem execution_spec), a autoridade paga é concedida
// AMARRADA A ESTE item, e então o planejador FORTE (OpenAI) REPLANEJA a proposta
// terminal real (`revise_work_proposal`). A MESMA autoridade do item cobre o
// replanejamento (planner, sem reserva) e o attempt (coder, com reserva). O placeholder
// é só o contêiner de governança; a proposta EXECUTADA é a do planejador forte.
//
// Cadeia: mensagem → item (placeholder) → autoridade paga do item → planejador OpenAI
// (proposta terminal via replan) → aprovação → classificação → volta do backlog
// (coder OpenAI, worktree, gate, Verifier) → `review`. PARA em `review`: NÃO aceita,
// integra, publica nem mergeia. Identidade residente (Bearer/RLS), nunca service_role.
// Sem segredos em log/evidência.
//
// Requer no ambiente (apps/web/.env.local ou export): OPENAI_API_KEY, OPENAI_MODEL,
// ANIMA_WORKTREE_CODER_BACKEND=openai, ANIMA_WORKTREE_CODER_MODEL=<mesmo modelo pago>.
// ============================================================

const CEILING_USD = 0.25;

const TASK_MESSAGE = [
  'Adicione uma função pura de diagnóstico da configuração atual do Project Work Planner em apps/web/lib/ai.',
  'A função deve expor o provider efetivo do planejador ("openai" ou "local") e, quando o provider efetivo for "local", também o modelo local efetivo.',
  'Reutilize os defaults e as funções de configuração já existentes (por exemplo resolveConfiguredProjectPlannerProvider e a resolução do modelo local já usada pelo planejador local).',
  'A função deve ser PURA: não faz I/O, não faz chamadas HTTP e NUNCA retorna, lê ou incorpora API keys, tokens, cabeçalhos de autorização ou qualquer segredo.',
  'Não altere a seleção de provider nem o comportamento existente do planner.',
  'Adicione testes focados cobrindo: (1) a configuração default; (2) provider local com modelo explícito; (3) ausência de segredos no retorno.',
  'Use somente os arquivos mínimos necessários em apps/web/lib/ai e valide com um teste focado.',
].join(' ');

async function main(): Promise<void> {
  const identityResult = await resolveCliIdentity();
  if (!identityResult.ok) throw new Error(identityResult.error);
  const { client, userId } = identityResult.identity;

  const baseSha = await readAuthorizedBaseSha();
  if (!baseSha) throw new Error('HEAD não pôde ser resolvido como base autorizada.');

  const model = process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
  const service = createWorkOrchestrationService(client);

  // 1) Mensagem real do usuário (Camada 1: memória bruta), fonte da proposta.
  const source = await client.from('ai_conversations').insert({
    user_id: userId, role: 'user', content: TASK_MESSAGE,
  }).select('id').single();
  if (source.error || !source.data) throw new Error(`Falha ao persistir mensagem de origem: ${source.error?.message ?? 'sem linha'}`);
  const sourceMessageId = source.data.id;

  // 2) Abre o work item com um PLACEHOLDER de admissão (sem execution_spec). Rótulo
  //    honesto: será substituído pela proposta terminal do planejador forte. Existe só
  //    para satisfazer o escopo por-item que o ledger provider_api exige.
  const placeholder: CreateWorkProposalCommand = {
    sourceMessageId, impactLevel: 'low', capability: 'programming',
    intent: { planner: 'admission_placeholder' },
    proposal: { schemaVersion: 1, data: {
      summary: 'Placeholder de admissão — aguardando planejamento forte (OpenAI).',
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

  // 3) Autoridade paga HUMANA amarrada a ESTE item (ledger). Uma só autoridade cobre o
  //    replanejamento (planner) e o attempt (coder). Classe provider_api:<modelo>.
  const grant = await grantPaidComputeAuthorization(client, {
    providerId: 'openai', nodeId: null, resourceClass: `provider_api:${model}`, workItemId,
    maxDurationMs: 30 * 60_000, maxCost: { currency: 'USD', amount: CEILING_USD },
    validFrom: new Date(Date.now() - 30_000).toISOString(),
    validUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  if (!grant.ok) throw new Error(`Autorização paga do item recusada: ${grant.code} ${grant.message}`);

  // 4) PLANEJADOR FORTE: planejador OpenAI sob a admissão governada por-item. Produz a
  //    proposta terminal a partir da mensagem; o HOST valida e monta o execution_spec
  //    (coder_backend/model vêm de ANIMA_WORKTREE_CODER_*).
  const planner = new OpenAIProjectWorkPlanner({
    admission: createOpenAIPlannerAdmission(client, workItemId),
    userId, model,
  });
  const planningBase: CreateWorkProposalCommand = {
    sourceMessageId, impactLevel: 'low', capability: 'programming',
    intent: {}, proposal: placeholder.proposal,
  };
  const planned = await planExecutableProjectWork(TASK_MESSAGE, planningBase, planner);
  if (!planned.ok) {
    console.log(JSON.stringify({
      stage: 'planner_failed', plannerProvider: planner.id, model,
      workItemId, authorizationId: grant.authorizationId, baseSha,
      message: redact(planned.message),
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const plannedCommand = planned.command;
  const plannedSpec = readExecutionContract(plannedCommand.intent);
  const plannedValidation =
    (plannedCommand.intent as { execution_spec?: { validation_criteria?: unknown } })
      .execution_spec?.validation_criteria ?? null;

  // 5) Instala a proposta terminal PLANEJADA (não hardcoded) no item via replan.
  const revised = await service.reviseProposal({
    workItemId, expectedProposalVersion: placeholderVersion,
    intent: plannedCommand.intent, proposal: plannedCommand.proposal,
  });
  if (!revised.ok) throw new Error(`Instalação da proposta planejada recusada: ${revised.error.code} ${revised.error.message}`);
  const terminalVersion = revised.value.proposalVersion;

  // 6) Aprova + classifica a proposta terminal.
  const approved = await service.resolveApproval({
    workItemId, expectedProposalVersion: terminalVersion, decision: { type: 'approve' },
  });
  if (!approved.ok) throw new Error(`Aprovação recusada: ${approved.error.code} ${approved.error.message}`);

  const classified = await ensurePlannedProjectClassification(client, workItemId, terminalVersion);
  if (!classified.ok) throw new Error(`Classificação recusada: ${classified.code} ${classified.message}`);

  // 7) Volta do backlog: coder OpenAI em worktree isolada, gate, Verifier → review.
  //    O coder reserva o teto sob a MESMA autoridade do item, na 1ª chamada do attempt.
  const candidates = await readAutonomousBacklogCandidates(client);
  const entry = projectAutonomousQueue(candidates, new Date()).find(candidate => candidate.workItemId === workItemId);
  if (!entry) throw new Error('Item aprovado/classificado não entrou na fila autônoma projetada.');
  const deps = buildProjectBacklogCycleDeps(client, `strong-e2e-${crypto.randomUUID()}`);
  if (!deps.hostPermitsAutonomousWork()) throw new Error('Resource Governor não permitiu trabalho autônomo neste instante.');
  const turn = await deps.runTurn(entry, new AbortController().signal);

  // 8) Releitura de fatos persistidos.
  const item = await client.from('work_items').select('id,state,proposal_version,capability,updated_at').eq('id', workItemId).single();
  const events = await client.from('work_events').select('seq,event_type,author,proposal_version,payload,created_at')
    .eq('work_item_id', workItemId).order('seq', { ascending: true });
  const budget = await client.from('paid_compute_budget_events').select('*')
    .eq('authorization_id', grant.authorizationId).order('created_at', { ascending: true });

  console.log(redact(JSON.stringify({
    stage: 'complete',
    baseSha,
    plannerProvider: planner.id,
    model,
    workItemId,
    placeholderVersion,
    terminalVersion,
    authorizationId: grant.authorizationId,
    authorizationCeiling: { currency: 'USD', amount: CEILING_USD },
    plannedProposal: plannedCommand.proposal.data,
    plannedExecutionSpec: {
      executor: plannedSpec.executor, coderBackend: plannedSpec.coderBackend, model: plannedSpec.model,
      baseSha: plannedSpec.baseSha, validationCriteria: plannedValidation,
    },
    turn,
    persistedItem: item.data, itemReadError: item.error?.message ?? null,
    events: events.data ?? [], eventsReadError: events.error?.message ?? null,
    budgetEvents: budget.data ?? [], budgetReadError: budget.error?.message ?? null,
  }, null, 2)));
}

void main().catch(error => {
  console.error(redact(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
