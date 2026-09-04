import { projectAutonomousQueue, type CreateWorkProposalCommand } from '@anima/core';
import { resolveCliIdentity } from '@/cli/identity';
import { buildProjectBacklogCycleDeps } from '@/lib/work-orchestration/autonomous-backlog-deps';
import { readAutonomousBacklogCandidates } from '@/lib/work-orchestration/autonomous-backlog-read';
import { readAuthorizedBaseSha, readExecutionContract } from '@/lib/work-orchestration/executor-selection';
import { grantPaidComputeAuthorization } from '@/lib/work-orchestration/paid-compute-authorization-store';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';

// Prova viva do coder pago governado (OpenAI). Materializa (ou REUTILIZA) a menor unidade
// canônica, concede a autorização paga pelo ledger oficial e roda UMA volta do backlog pela
// borda do Resident Host. A admissão financeira (`createOpenAICoderAdmission`) reserva o teto
// humano na 1ª chamada ao provider. Para em `review`: NÃO aceita, integra nem publica.
// Uso: `... prove-openai-paid-coder.ts [--work-item <uuid>]` — sem o arg, cria a unidade nova.

const argWorkItem = (() => {
  const i = process.argv.indexOf('--work-item');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
})();

async function main(): Promise<void> {
  const identityResult = await resolveCliIdentity();
  if (!identityResult.ok) throw new Error(identityResult.error);
  const { client, userId } = identityResult.identity;
  const baseSha = await readAuthorizedBaseSha();
  if (!baseSha) throw new Error('HEAD não pôde ser resolvido como base autorizada.');

  let workItemId: string;
  let proposalVersion: number;

  if (argWorkItem) {
    // REUSO: unidade aprovada/classificada de uma execução anterior (append-only, sem duplicar).
    const existing = await client.from('work_items').select('id,state,proposal_version,intent').eq('id', argWorkItem).single();
    if (existing.error || !existing.data) throw new Error(`Work item ${argWorkItem} não encontrado: ${existing.error?.message ?? 'sem linha'}`);
    if (existing.data.state !== 'approved') throw new Error(`Work item ${argWorkItem} está em '${existing.data.state}', não 'approved' — não reutilizável para a prova.`);
    workItemId = existing.data.id;
    proposalVersion = existing.data.proposal_version;
  } else {
    const originalRequest = [
      'Corrigir um bug de fronteira em packages/core/src/levels.ts:',
      'getEraForLevel deve devolver a primeira era abaixo de MIN_LEVEL e a última era acima de MAX_LEVEL.',
      'Adicionar cobertura explícita dos dois limites em packages/core/src/levels.test.ts.',
      'Não alterar outros arquivos e executar o teste focado declarado.',
    ].join(' ');
    const source = await client.from('ai_conversations').insert({
      user_id: userId, role: 'user', content: originalRequest,
    }).select('id').single();
    if (source.error || !source.data) throw new Error(`Falha ao persistir mensagem de origem: ${source.error?.message ?? 'sem linha'}`);

    const command: CreateWorkProposalCommand = {
      sourceMessageId: source.data.id,
      impactLevel: 'low',
      capability: 'programming',
      intent: {
        planner: 'openai_project_tools_v1',
        execution_spec: {
          schema_version: 1,
          target: { kind: 'project', reference: 'anima' },
          executor: 'worktree', coder_backend: 'openai', model: 'gpt-5.6-terra', base_sha: baseSha,
          permissions: ['workspace_read', 'workspace_write_isolated'],
          validation_criteria: [{
            label: 'Teste focado de fronteiras de nível',
            command: 'npm test --workspace=packages/core -- levels.test.ts',
          }],
          limits: { max_attempts: 1, max_duration_minutes: 30 },
        },
      },
      proposal: { schemaVersion: 1, data: {
        summary: 'Corrigir a seleção de era fora dos limites de nível.',
        objective: 'Garantir que níveis abaixo e acima dos limites sejam associados às eras extremas corretas.',
        includedScope: ['packages/core/src/levels.ts', 'packages/core/src/levels.test.ts'],
        excludedScope: ['Banco de dados', 'Aplicações web e mobile', 'Publicação ou merge'],
        expectedEffects: ['Nível abaixo de MIN_LEVEL retorna Despertar', 'Nível acima de MAX_LEVEL retorna Lenda', 'Teste focado passa'],
        risks: ['Mudança limitada ao comportamento fora do intervalo suportado'],
      } },
    };
    const service = createWorkOrchestrationService(client);
    const created = await service.createProposal(command);
    if (!created.ok) throw new Error(`Proposta recusada: ${created.error.code} ${created.error.message}`);
    workItemId = created.value.id;
    proposalVersion = created.value.proposalVersion;

    const approved = await service.resolveApproval({
      workItemId, expectedProposalVersion: proposalVersion, decision: { type: 'approve' },
    });
    if (!approved.ok) throw new Error(`Aprovação recusada: ${approved.error.code} ${approved.error.message}`);

    const classified = await ensurePlannedProjectClassification(client, workItemId, proposalVersion);
    if (!classified.ok) throw new Error(`Classificação recusada: ${classified.code} ${classified.message}`);
  }

  // Modelo pago do contrato do item → classe de recurso que o gate financeiro revalida.
  const contractItem = await client.from('work_items').select('intent').eq('id', workItemId).single();
  if (contractItem.error || !contractItem.data) throw new Error(`Falha ao reler o contrato do item: ${contractItem.error?.message ?? 'sem linha'}`);
  const model = readExecutionContract(contractItem.data.intent).model ?? 'gpt-5.6-terra';

  const validFrom = new Date(Date.now() - 30_000);
  const validUntil = new Date(Date.now() + 30 * 60_000);
  const authorization = await grantPaidComputeAuthorization(client, {
    providerId: 'openai', nodeId: null, resourceClass: `provider_api:${model}`, workItemId,
    maxDurationMs: 30 * 60_000, maxCost: { currency: 'USD', amount: 0.25 },
    validFrom: validFrom.toISOString(), validUntil: validUntil.toISOString(),
  });
  if (!authorization.ok) throw new Error(`Autorização paga recusada: ${authorization.code} ${authorization.message}`);

  const candidates = await readAutonomousBacklogCandidates(client);
  const entry = projectAutonomousQueue(candidates, new Date()).find(candidate => candidate.workItemId === workItemId);
  if (!entry) throw new Error('Item aprovado/classificado não entrou na fila autônoma projetada.');
  const deps = buildProjectBacklogCycleDeps(client, `paid-openai-proof-${crypto.randomUUID()}`);
  if (!deps.hostPermitsAutonomousWork()) throw new Error('Resource Governor não permitiu trabalho autônomo neste instante.');
  const turn = await deps.runTurn(entry, new AbortController().signal);

  const item = await client.from('work_items').select('id,state,proposal_version,updated_at').eq('id', workItemId).single();
  const events = await client.from('work_events').select('seq,event_type,author,proposal_version,payload,created_at')
    .eq('work_item_id', workItemId).order('seq', { ascending: true });
  const budget = await client.from('paid_compute_budget_events').select('*')
    .eq('authorization_id', authorization.authorizationId).order('created_at', { ascending: true });
  console.log(JSON.stringify({
    reusedWorkItem: argWorkItem !== null,
    baseSha, workItemId, proposalVersion, model, authorizationId: authorization.authorizationId,
    authorizationCeiling: { currency: 'USD', amount: 0.25 }, turn,
    persistedItem: item.data, itemReadError: item.error?.message ?? null,
    events: events.data ?? [], eventsReadError: events.error?.message ?? null,
    budgetEvents: budget.data ?? [], budgetReadError: budget.error?.message ?? null,
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
