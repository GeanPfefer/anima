import type { ObservedCoderInput, ObservedGateInput } from '@anima/core';
import { authenticateRequest } from '@/lib/supabase/request-auth';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { localRunnerRouteFromEnvironment, type ConfiguredWorkRoute } from '@/lib/work-orchestration/execution';
import { readExecutionContract, resolveExecutorRoute, type ExecutionContract } from '@/lib/work-orchestration/executor-selection';
import { composeSupervisorResourceAdvisory, type ResourceGovernorAdvisoryReport } from '@/lib/work-orchestration/resource-governor';
import { runSupervisorTurn } from '@/lib/work-orchestration/supervisor';
import { persistPostTurnHostObservations } from '@/lib/work-orchestration/post-turn-observation';

export const runtime = 'nodejs';
export const maxDuration = 1800;

// Ponto de entrada do laço mínimo do Supervisor V0: UMA volta por invocação.
// Não há daemon, agendador nem polling — a periodicidade, se um dia existir,
// pertence a quem chama. A autenticação real é obrigatória porque toda RPC do
// ciclo resolve `auth.uid()` e consulta a allowlist de orquestração. Aceita o
// cookie web e o `Authorization: Bearer` do mobile (paridade UX-04): a mesma
// autoridade RLS, o mesmo `runSupervisorTurn`, sem duplicar o Supervisor.
//
// A seleção de executor é EXPLÍCITA e vem do contrato persistido do item
// (`execution_spec.executor`), não de heurística: `project:anima` usa o executor
// de worktree; os demais seguem no runner Python legado. O Supervisor continua
// recebendo só uma rota, sem conhecer worktree/Ollama/OpenAI.

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const { client } = auth;

  const body = await request.json().catch(() => null) as {
    workItemId?: unknown;
    expectedProposalVersion?: unknown;
  } | null;
  const explicit = body !== null
    && (body.workItemId !== undefined || body.expectedProposalVersion !== undefined);
  if (explicit && (typeof body?.workItemId !== 'string'
    || !Number.isInteger(body.expectedProposalVersion)
    || Number(body.expectedProposalVersion) < 1)) {
    return Response.json({
      ok: false,
      error: { code: 'invalid_autonomous_selection', message: 'O trabalho e a versão precisam ser informados.' },
    }, { status: 400 });
  }

  let route: ConfiguredWorkRoute | null;
  // Contrato do executor selecionado nesta volta. Guardado para, DEPOIS do
  // desfecho, o host observar o git independentemente no caminho worktree.
  let executionContract: ExecutionContract | null = null;
  // Coletor host-side dos gates: o executor de worktree reporta aqui os fatos brutos
  // que o host mediu ao rodar cada gate (canal do host, separado do handoff atestado).
  const gateObservations: ObservedGateInput[] = [];
  // Coletor host-side do coder: o executor reporta cada duração wall-clock que o host
  // cronometrou ao redor de `backend.edit()`. Retries internos permanecem na mesma
  // tentativa e podem gerar múltiplas observações; a persistência agrega o custo total.
  const coderObservations: ObservedCoderInput[] = [];
  if (explicit) {
    const item = await client.from('work_items')
      .select('intent, state, proposal_version, impact_level, capability')
      .eq('id', body!.workItemId as string)
      .maybeSingle();
    const intent = item.data?.intent as {
      planner?: unknown;
      execution_spec?: {
        target?: { kind?: unknown; reference?: unknown };
        permissions?: unknown;
        validation_criteria?: unknown;
        limits?: { max_attempts?: unknown; max_duration_minutes?: unknown };
      };
    } | null;
    const approvedVersion = item.data?.state === 'approved'
      && item.data.proposal_version === body!.expectedProposalVersion
    const deterministic = approvedVersion
      && process.env.ANIMA_UX02_DETERMINISTIC_PROOF === '1'
      && intent?.execution_spec?.target?.reference === 'ux02-deterministic-decision';
    const spec = intent?.execution_spec;
    const projectPlanner = intent?.planner === 'openai_project_tools_v1'
      || intent?.planner === 'local_ollama_project_tools_v1';
    const plannedProject = approvedVersion
      && item.data?.impact_level === 'low'
      && item.data?.capability === 'programming'
      && projectPlanner
      && spec?.target?.kind === 'project'
      && spec.target.reference === 'anima'
      && Array.isArray(spec.permissions)
      && spec.permissions.length === 2
      && spec.permissions[0] === 'workspace_read'
      && spec.permissions[1] === 'workspace_write_isolated'
      && Array.isArray(spec.validation_criteria)
      && spec.validation_criteria.length > 0
      && spec.limits?.max_attempts === 3
      && spec.limits.max_duration_minutes === 30;
    if (deterministic || plannedProject) {
      const current = await client.rpc('current_work_intelligence_classification', {
        p_work_item_id: body!.workItemId as string,
      });
      const currentRoot = current.data as { classification?: unknown } | null;
      if (!current.error && !currentRoot?.classification) {
        const classified = await client.rpc('record_work_intelligence_classification', {
          p_work_item_id: body!.workItemId as string,
          p_expected_proposal_version: body!.expectedProposalVersion as number,
          p_expected_classification_revision: 0,
          p_classification: {
            schemaVersion: 1,
            complexity: 'bounded',
            risk: 'low',
            reversibility: 'reversible',
            planClarity: 'clear',
            urgency: 'normal',
            provenance: {
              kind: 'system_assessed',
              classifiedAt: new Date().toISOString(),
              classifierId: plannedProject ? String(intent?.planner) + '-bridge' : 'ux02-deterministic-proof',
              policyVersion: plannedProject ? 'project-planner-v1' : 'ux02-deterministic-v1',
            },
          },
        });
        if (classified.error) {
          return Response.json({ ok: false, error: { code: classified.error.code, message: classified.error.message } }, { status: 409 });
        }
      }
    }

    // Seleção EXPLÍCITA do executor pelo contrato persistido. O laço
    // supervisionado liga os checkpoints mid-flight (AUTO-05). O caminho
    // comandado (INT-04) do runner Python segue single-shot lá dentro.
    const contract = readExecutionContract(item.data?.intent);
    executionContract = contract;
    const selection = resolveExecutorRoute(contract, {
      gateObserver: outcome => gateObservations.push(outcome),
      coderObserver: outcome => coderObservations.push(outcome),
    });
    if (!selection.ok) {
      return Response.json({ ok: false, error: selection.error }, { status: 503 });
    }
    route = selection.route;
  } else {
    // Fila autônoma pura (sem item pedido): mantém o caminho legado do runner Python.
    route = localRunnerRouteFromEnvironment({ emitCheckpoints: true });
    if (!route) {
      return Response.json({ ok: false, error: { code: 'local_runner_not_configured', message: 'Executor local não configurado.' } }, { status: 503 });
    }
  }

  // A decisão humana que iniciou a tentativa é persistida antes da execução.
  // Depois disso, o ciclo não herda o lifetime do transporte HTTP: abandonar a
  // página ou perder a conexão não equivale a um pedido humano de cancelamento.
  // Limites aprovados, checkpoints, controle explícito e reconciliação continuam
  // sendo as fronteiras de interrupção do Supervisor V0.
  const executionSignal = new AbortController().signal;
  const result = await runSupervisorTurn({
    client, routes: [route],
    ownerInstanceId: process.env.ANIMA_SUPERVISOR_INSTANCE_ID ?? 'supervisor-v0',
    newId: () => crypto.randomUUID(),
    signal: executionSignal,
    requestedWork: explicit ? {
      workItemId: body!.workItemId as string,
      expectedProposalVersion: body!.expectedProposalVersion as number,
    } : undefined,
  });

  // Pós-terminal, quando a volta iniciou uma tentativa: o host persiste sua evidência
  // observada e o Verifier registra seu parecer. Mesma observação usada pelo driver do
  // backlog. Tudo FAIL-OPEN — nunca altera o desfecho da tentativa nem a resposta.
  await persistPostTurnHostObservations({
    client,
    result,
    contract: executionContract,
    gateObservations,
    coderObservations,
  });

  // (3) ADVISORY do Resource Governor (read-only), anexado ao read-model da resposta.
  // Bloco INDEPENDENTE e TOTALMENTE fail-open: deriva o custo dos workloads observados de
  // TODA a máquina (evidência de gate E de coder de todos os itens do usuário, isolada por
  // RLS — não só deste item, senão um item novo nunca teria histórico) + lê o snapshot vivo
  // da máquina (seam central) → um parecer por workload. Gate e coder coexistem como perfis
  // SEPARADOS (chave por workloadKind). Roda para qualquer terminal registrado (um gate falho
  // ou uma edição de coder também têm custo). NÃO decide, NÃO bloqueia, NÃO muda elegibilidade
  // nem o `value: result`: só informa. Toda a leitura (inclusive o fetch de eventos) está sob
  // try/catch — um defeito de telemetria/transporte vira advisory AUSENTE, jamais um erro que
  // altere a resposta do turno.
  let resourceGovernor: ResourceGovernorAdvisoryReport | undefined;
  if (result.selection && result.terminalKind !== null) {
    try {
      const service = createWorkOrchestrationService(client);
      const [gateEvents, coderEvents] = await Promise.all([
        service.listEventsByType('host_observed_gate_evidence_recorded'),
        service.listEventsByType('host_observed_coder_evidence_recorded'),
      ]);
      if (gateEvents.ok && coderEvents.ok) {
        resourceGovernor = composeSupervisorResourceAdvisory({ events: [...gateEvents.value, ...coderEvents.value] }) ?? undefined;
      }
    } catch {
      resourceGovernor = undefined;
    }
  }

  // Toda volta que o laço conduziu até um desfecho conhecido responde 200 com o
  // desfecho tipado: perder a corrida do claim é resultado normal do supervisor,
  // não erro de transporte. Só a incerteza real — tentativa aberta sem terminal
  // confiável — sobe como 500, porque exige nova invocação para fechar.
  const incomplete = result.outcome === 'execution_interrupted' || result.outcome === 'terminal_refused';
  // O advisory de recursos é anexado só quando existe (histórico suficiente): read-model
  // ao lado do desfecho, nunca dentro de `value` (o resultado do Supervisor é intocado).
  return Response.json(
    { ok: true, value: result, ...(resourceGovernor ? { resourceGovernor } : {}) },
    { status: incomplete ? 500 : 200 },
  );
}
