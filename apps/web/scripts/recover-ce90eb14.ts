import { randomUUID } from 'node:crypto';
import { projectAutonomousQueue } from '@anima/core';
import { resolveCliIdentity } from '@/cli/identity';
import { buildProjectBacklogCycleDeps } from '@/lib/work-orchestration/autonomous-backlog-deps';
import { readAutonomousBacklogCandidates } from '@/lib/work-orchestration/autonomous-backlog-read';
import { grantPaidComputeAuthorization } from '@/lib/work-orchestration/paid-compute-authorization-store';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';
import { readWorkRetryReadiness } from '@/lib/work-orchestration/retry-readiness';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { redactSecrets as redact } from './prove-e2e-redact';

// ============================================================
// RECOVERY CANÔNICO POR SUCCESSOR do Work Item falho ce90eb14, até `review`.
//
// Mecanismo canônico: private.record_recovery_successor (via propose_recovery_successor)
// — cria UM successor em `proposed`, preserva work_recovery_lineage e NÃO reescreve a
// evidência do predecessor. O successor herda o execution_spec do predecessor (executor
// worktree, coder_backend OpenAI, base_sha committed a55e316, escopo dos 2 arquivos
// aprovados, MESMO gate Jest) e o OBJETIVO carrega o diagnóstico REAL do gate como
// instrução de repair autoritativa. O CODER FORTE (OpenAI) produz a correção — a
// correção de scratch é só referência de diagnóstico, nunca aplicada à mão.
//
// Supervisão humana explícita do successor + autoridade paga OpenAI item/model-scoped
// (teto USD 0,25, TTL curto). UMA única tentativa (um runTurn no successor específico;
// coder OpenAI tem retry interno 0). PARA em `review`: NÃO aceita/integra/mergeia/publica.
// Identidade residente (Bearer/RLS), nunca service_role. Sem segredos em log.
// ============================================================

const ORIGINAL = 'ce90eb14-810d-4125-833c-4c7b35666855';
const CEILING_USD = 0.25;
const MODEL = 'gpt-5.6-terra';
const BASE_SHA = 'a55e3164ea3cadefcc6643e375b357277f694040';
// Checkpoint host-observado da última tentativa falha (attempt 1436d180): commit do
// coder (quase-correto) + branch. Retomar dele reaproveita 90% do trabalho E habilita a
// classificação canônica (o classificador recupera o planner subindo a linhagem até
// ce90eb14, que carrega openai_project_tools_v1) — sem forjar metadata de planner.
const RESUME_COMMIT = 'fbf17a8f882da7972d1daaf6d233d64e15e2b73c';
const RESUME_BRANCH = 'anima-work/1436d180-4794-4dcc-9084-81e4b4c8e8db';
const RECOVERY_SEQUENCE = 2; // seq 1 = successor de setup cancelado (intent não classificável).
const TTL_SECONDS = 1800; // 30 min: curto e revogado ao fim; cobre com folga uma tentativa.
// Chave de idempotência FIXA ⇒ re-execução replica o MESMO successor (nunca cria um 2º).
const IDEMPOTENCY_KEY = 'ce90eb14-9a55-4c03-8d1a-000000000004';

const VALIDATION_CRITERIA = [
  {
    label: 'Teste Jest focalizado do harness',
    covers: [
      'O harness exporta resolveTaskMessage, resolve --message-file com leitor injetável ou leitura UTF-8 padrão, aceita --message quando aplicável e preserva exatamente o conteúdo retornado após validar que não é vazio por trim.',
      'Argumentos sem mensagem, conteúdo vazio, flags/argumentos inválidos e falha de leitura produzem Error acionável que não expõe o conteúdo ou outros segredos.',
      'main usa a mensagem resolvida de process.argv.slice(2) em vez de TASK_MESSAGE, e a chamada automática é guardada para que importar o módulo nos testes não inicie o fluxo E2E.',
      'O teste Jest existente ganha describe("resolveTaskMessage", ...) com stubs jest.fn(), cobrindo arquivo válido, ausência de mensagem, conteúdo vazio, argumento inválido, preservação exata e erros sem segredos.',
    ],
    command: 'npm run test --workspace=@anima/web -- scripts/prove-openai-strong-e2e.test.ts',
  },
];

const ORIGINAL_OBJECTIVE =
  'Substituir a mensagem hardcoded por resolveTaskMessage(argv, readFile?), integrar a resolução no main e cobrir o contrato de parsing/leitura com o teste Jest focalizado já existente.';

// Diagnóstico REAL do gate (attempt 1436d180: Jest exit 1 por TS2552/TS18048) como
// instrução de repair autoritativa. O coder DEVE produzir o código; isto diz O QUE, não COMO.
const REPAIR_OBJECTIVE = [
  'Retomar o checkpoint da tentativa anterior (diff quase-correto já aplicado nos 2 arquivos) e corrigir APENAS os defeitos abaixo, produzindo a implementação CONTRACT-CORRECT. O coder DEVE produzir o código; este objetivo é a instrução de repair autoritativa derivada do gate real da tentativa anterior (attempt 1436d180: gate Jest terminou com exit 1 por erros de compilação; ts-jest faz typecheck, então a suíte nem rodou).',
  'Requisitos OBRIGATÓRIOS:',
  '1) Eliminar o TS2552: NÃO deixar nenhum uso residual de TASK_MESSAGE — toda referência deve usar a mensagem resolvida (há uma segunda ocorrência em planExecutableProjectWork(...) além da inserção em ai_conversations).',
  '2) Eliminar o TS18048 ("argument is possibly undefined"): fazer narrowing seguro de argv[index] antes de chamar métodos de string (sob noUncheckedIndexedAccess, argv[index] é string|undefined).',
  '3) Usar EXATAMENTE as flags --message e --message-file (aceitando a forma inline --flag=valor e a separada --flag valor).',
  '4) NÃO usar --task nem --task-file.',
  '5) Remover QUALQUER fallback/default hardcoded: não retornar uma mensagem embutida quando nenhuma for fornecida.',
  '6) Ausência de --message/--message-file deve lançar Error acionável.',
  '7) Conteúdo vazio (mensagem vazia ou arquivo vazio por trim) deve lançar Error.',
  '8) Falha de leitura deve lançar Error acionável SEM expor o conteúdo, o caminho sensível ou qualquer segredo.',
  '9) Preservar EXATAMENTE o conteúdo válido fornecido (não aparar/trim no retorno).',
  '10) main deve usar a mensagem resolvida via resolveTaskMessage(process.argv.slice(2)).',
  '11) Guardar a autoexecução: importar o módulo nos testes Jest NÃO pode disparar o fluxo E2E (guardar a chamada de main por process.argv[1]).',
  '12) Estender o arquivo Jest JÁ EXISTENTE apps/web/scripts/prove-openai-strong-e2e.test.ts, no mesmo estilo (describe/it/expect globais, jest.fn() para stubs).',
  '13) NÃO usar vitest, vi, node:test, bun:test, mocha nem qualquer runner além do Jest do repositório.',
  '14) Manter o diff restrito EXCLUSIVAMENTE aos 2 arquivos aprovados (prove-openai-strong-e2e.ts e prove-openai-strong-e2e.test.ts).',
  `Objetivo e aceite originais preservados: ${ORIGINAL_OBJECTIVE}`,
].join('\n');

async function main(): Promise<void> {
  const identityResult = await resolveCliIdentity();
  if (!identityResult.ok) throw new Error(identityResult.error);
  const { client } = identityResult.identity;
  const service = createWorkOrchestrationService(client);

  const executionSpec = {
    model: MODEL,
    limits: { max_attempts: 3, max_duration_minutes: 30 },
    target: { kind: 'project', reference: 'anima' },
    base_sha: BASE_SHA,
    executor: 'worktree',
    permissions: ['workspace_read', 'workspace_write_isolated'],
    coder_backend: 'openai',
    schema_version: 1,
    validation_criteria: VALIDATION_CRITERIA,
    // Retomada do checkpoint durável da tentativa falha (diff quase-correto). O worktree
    // parte deste commit; o diff continua contra base_sha (a55e316).
    resume_from_checkpoint: { base_sha: BASE_SHA, commit_sha: RESUME_COMMIT, branch: RESUME_BRANCH },
  };

  const proposal = {
    schema_version: 1,
    data: {
      summary: 'Recovery successor de ce90eb14: implementação contract-correct do harness E2E forte, guiada pelo diagnóstico real do gate.',
      objective: REPAIR_OBJECTIVE,
      included_scope: [
        'apps/web/scripts/prove-openai-strong-e2e.ts',
        'apps/web/scripts/prove-openai-strong-e2e.test.ts',
      ],
      excluded_scope: [
        'apps/web/package.json',
        'apps/web/scripts/prove-e2e-redact.ts',
        'Configuração global do Jest',
        'Demais scripts E2E',
        'Documentação e arquivos fora dos dois caminhos autorizados',
      ],
      expected_effects: [
        'O harness exporta resolveTaskMessage, resolve --message-file com leitor injetável ou leitura UTF-8 padrão, aceita --message quando aplicável e preserva exatamente o conteúdo retornado após validar que não é vazio por trim.',
        'Argumentos sem mensagem, conteúdo vazio, flags/argumentos inválidos e falha de leitura produzem Error acionável que não expõe o conteúdo ou outros segredos.',
        'main usa a mensagem resolvida de process.argv.slice(2) em vez de TASK_MESSAGE, e a chamada automática é guardada para que importar o módulo nos testes não inicie o fluxo E2E.',
        'O teste Jest existente ganha describe("resolveTaskMessage", ...) com stubs jest.fn(), cobrindo arquivo válido, ausência de mensagem, conteúdo vazio, argumento inválido, preservação exata e erros sem segredos.',
      ],
      risks: [
        'A implementação anterior falhou o gate por erros de compilação (TS2552 uso residual de TASK_MESSAGE; TS18048 argv[index] sem narrowing) e divergiu do contrato de flags — a correção deve eliminar ambos e usar exatamente --message/--message-file.',
        'A guarda de autoexecução deve ser compatível com o modo de transpiração usado pelo Jest e com a execução direta atual do script.',
        'Erros de leitura devem manter contexto suficiente para ação sem interpolar conteúdo de mensagem, caminhos sensíveis ou detalhes potencialmente secretos do sistema.',
      ],
    },
  };

  // 1) SUCCESSOR CANÔNICO — preserva lineage; NÃO reescreve evidência; idempotente.
  const successor = await client.rpc('propose_recovery_successor', {
    p_original_work_item_id: ORIGINAL,
    p_recovery_sequence: RECOVERY_SEQUENCE,
    p_impact_level: 'low',
    p_capability: 'programming',
    // Successor canônico copia SÓ execution_spec (planner é proveniência, não autoridade):
    // o classificador recupera o planner pela linhagem (resume_from_checkpoint habilita a subida).
    p_intent: { execution_spec: executionSpec },
    p_proposal: proposal,
    p_recovery_reason: 'recovery successor: gate Jest exit 1 (TS2552 TASK_MESSAGE residual + TS18048 argv[index]) e desvio de contrato --task→--message; coder forte corrige a partir do diagnóstico real.',
    p_idempotency_key: IDEMPOTENCY_KEY,
  });
  if (successor.error) throw new Error(`successor recusado: ${successor.error.code ?? ''} ${successor.error.message}`);
  const successorData = successor.data as { successorWorkItemId: string; lineageId: string; recoverySequence: number; replayed: boolean };
  const successorId = successorData.successorWorkItemId;
  const version = 1;

  // 2) SUPERVISÃO HUMANA explícita do successor PRIMEIRO — desbloqueia a admissão sob lease
  //    válido (readiness/retry/execução). NÃO reseta contadores nem altera limites globais.
  const lease = await client.rpc('grant_work_supervision', {
    p_work_item_id: successorId, p_expected_proposal_version: version, p_request_id: randomUUID(), p_ttl_seconds: TTL_SECONDS,
  });
  if (lease.error) throw new Error(`supervisão recusada: ${lease.error.code ?? ''} ${lease.error.message}`);
  const leaseData = lease.data as { leaseId: string; expiresAt: string; replayed: boolean };

  // 3) Traz o successor a um estado claimável, resumível pelo estado atual (idempotência):
  //    proposed → aprova; failed(retryável) → retry governado; approved → segue.
  const stateRead = await client.from('work_items').select('state').eq('id', successorId).single();
  if (stateRead.error || !stateRead.data) throw new Error(`estado do successor ilegível: ${stateRead.error?.message ?? 'sem linha'}`);
  const state = stateRead.data.state as string;
  let admissionPath: string;
  if (state === 'proposed') {
    const approved = await service.resolveApproval({ workItemId: successorId, expectedProposalVersion: version, decision: { type: 'approve' } });
    if (!approved.ok) throw new Error(`aprovação recusada: ${approved.error.code} ${approved.error.message}`);
    admissionPath = 'approved_from_proposed';
  } else if (state === 'failed') {
    const readiness = await readWorkRetryReadiness(client, successorId);
    if (readiness.status !== 'RETRY_READY' || !readiness.failureEventId) {
      throw new Error(`retry indisponível: ${readiness.reason ?? readiness.status} (used ${readiness.attemptsUsed}/${readiness.maxAttempts}).`);
    }
    const retried = await client.rpc('request_work_retry', {
      p_work_item_id: successorId, p_expected_proposal_version: readiness.proposalVersion,
      p_failure_event_id: readiness.failureEventId, p_retry_request_id: randomUUID(),
    });
    if (retried.error) throw new Error(`retry recusado: ${retried.error.code ?? ''} ${retried.error.message}`);
    admissionPath = 'retry_from_failed';
  } else if (state === 'approved') {
    admissionPath = 'already_approved';
  } else {
    throw new Error(`estado inesperado do successor: ${state}`);
  }

  // 4) Classifica como projeto planejado (idempotente; recupera o planner pela linhagem).
  const classified = await ensurePlannedProjectClassification(client, successorId, version);
  if (!classified.ok) throw new Error(`classificação recusada: ${classified.code} ${classified.message}`);

  // 5) AUTORIDADE PAGA OpenAI item/model-scoped, teto USD 0,25, validade curta.
  // maxDurationMs deve cobrir o max_duration do spec (30 min, exigido pela classificação),
  // senão a admissão do coder recusa por duration_exceeds_authorized. A janela de validade
  // é curta (uma tentativa) e o teto de custo (USD 0,25) é o limite financeiro real.
  const grant = await grantPaidComputeAuthorization(client, {
    providerId: 'openai', nodeId: null, resourceClass: `provider_api:${MODEL}`, workItemId: successorId,
    maxDurationMs: 30 * 60_000, maxCost: { currency: 'USD', amount: CEILING_USD },
    validFrom: new Date(Date.now() - 30_000).toISOString(),
    validUntil: new Date(Date.now() + 32 * 60_000).toISOString(),
  });
  if (!grant.ok) throw new Error(`autorização paga recusada: ${grant.code} ${grant.message}`);

  // 6) UMA ÚNICA tentativa: runTurn no successor específico (coder forte OpenAI, retry
  //    interno 0). Determinístico — a fila pode ter outros itens; selecionamos ESTE.
  const candidates = await readAutonomousBacklogCandidates(client);
  const entry = projectAutonomousQueue(candidates, new Date()).find(candidate => candidate.workItemId === successorId);
  let turn: unknown = null;
  let turnError: string | null = null;
  if (!entry) {
    turnError = 'successor aprovado/classificado não entrou na fila autônoma projetada (possível bloqueio de admissão).';
  } else {
    const deps = buildProjectBacklogCycleDeps(client, `recover-${randomUUID()}`);
    if (!deps.hostPermitsAutonomousWork()) {
      turnError = 'Resource Governor não permitiu trabalho autônomo neste instante.';
    } else {
      turn = await deps.runTurn(entry, new AbortController().signal);
    }
  }

  // 7) Releitura dos fatos persistidos do successor.
  const item = await client.from('work_items').select('id,state,proposal_version,capability,updated_at').eq('id', successorId).single();
  const events = await client.from('work_events').select('seq,event_type,author,proposal_version,payload,created_at')
    .eq('work_item_id', successorId).order('seq', { ascending: true });
  const budget = await client.from('paid_compute_budget_events').select('*')
    .eq('authorization_id', grant.authorizationId).order('created_at', { ascending: true });

  // 8) Revoga a supervisão (a autoridade paga expira sozinha pelo TTL curto).
  const revoke = await client.rpc('revoke_work_supervision', { p_work_item_id: successorId });

  console.log(redact(JSON.stringify({
    stage: 'complete',
    originalWorkItemId: ORIGINAL,
    successorWorkItemId: successorId,
    lineageId: successorData.lineageId,
    recoverySequence: successorData.recoverySequence,
    successorReplayed: successorData.replayed,
    admissionPath,
    proposalVersion: version,
    baseSha: BASE_SHA,
    includedScope: proposal.data.included_scope,
    supervision: { leaseId: leaseData.leaseId, expiresAt: leaseData.expiresAt, replayed: leaseData.replayed },
    authorizationId: grant.authorizationId,
    authorizationCeiling: { currency: 'USD', amount: CEILING_USD },
    turnError,
    turn,
    persistedItem: item.data, itemReadError: item.error?.message ?? null,
    events: events.data ?? [], eventsReadError: events.error?.message ?? null,
    budgetEvents: budget.data ?? [], budgetReadError: budget.error?.message ?? null,
    supervisionRevoked: !revoke.error,
  }, null, 2)));
}

void main().catch(error => {
  console.error(redact(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exitCode = 1;
});
