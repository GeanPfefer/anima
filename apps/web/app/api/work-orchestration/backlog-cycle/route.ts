import type { AutonomousQueueEntry, ObservedCoderInput, ObservedGateInput } from '@anima/core';
import { authenticateRequest } from '@/lib/supabase/request-auth';
import { readExecutionContract, resolveExecutorRoute } from '@/lib/work-orchestration/executor-selection';
import { persistPostTurnHostObservations } from '@/lib/work-orchestration/post-turn-observation';
import { readAutonomousBacklogCandidates } from '@/lib/work-orchestration/autonomous-backlog-read';
import { runAutonomousBacklogCycle } from '@/lib/work-orchestration/autonomous-backlog-driver';
import { runSupervisorTurn, type SupervisorTurnResult } from '@/lib/work-orchestration/supervisor';

export const runtime = 'nodejs';
export const maxDuration = 1800;

// Ponto de entrada do DRIVER do backlog autônomo: UMA invocação explícita que
// processa VÁRIAS voltas elegíveis em sequência, com parada tipada. Não é daemon,
// agendador nem polling — a periodicidade, se um dia existir, pertence a quem chama.
//
// A política pura (`planAutonomousBacklogTurn`) decide executar-vs-parar sobre a
// fotografia do backlog (`readAutonomousBacklogCandidates`); o driver executa cada
// volta pela MESMA maquinaria do turno único (executor de worktree por contrato +
// `runSupervisorTurn` com `requestedWork` + observação host-side pós-volta). A
// SELEÇÃO e a EXCLUSÃO MÚTUA continuam server-side; o desfecho máximo continua
// `review`. Autenticação obrigatória (toda RPC resolve `auth.uid()`).

// Limite estrutural por invocação (anti-spin). Pequeno por padrão: uma invocação
// não deve varrer o backlog inteiro sem supervisão. NÃO é quota diária.
const DEFAULT_MAX_TURNS = 3;
const MAX_TURNS_CEILING = 10;

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const { client } = auth;

  const body = await request.json().catch(() => null) as { maxTurns?: unknown } | null;
  if (body?.maxTurns !== undefined && (!Number.isInteger(body.maxTurns) || Number(body.maxTurns) < 1)) {
    return Response.json({
      ok: false, error: { code: 'invalid_max_turns', message: 'maxTurns precisa ser um inteiro positivo.' },
    }, { status: 400 });
  }
  const maxTurns = Math.min(Number(body?.maxTurns ?? DEFAULT_MAX_TURNS), MAX_TURNS_CEILING);

  const ownerInstanceId = process.env.ANIMA_SUPERVISOR_INSTANCE_ID ?? 'supervisor-v0';

  // A execução do driver não herda o lifetime do transporte HTTP: abandonar a
  // página não cancela um ciclo em andamento. O limite estrutural `maxTurns` e as
  // fronteiras humanas são as paradas — coerente com a rota supervisor-turn.
  const driverSignal = new AbortController().signal;

  // Base de um resultado sintético do Supervisor para quando o contrato do item não
  // resolve um executor: o driver classifica `selection_not_executable` como parada
  // anti-spin (`turn_not_executable`), sem tentar executar às cegas.
  const notExecutable = (entry: AutonomousQueueEntry, code: string, message: string): SupervisorTurnResult => ({
    outcome: 'selection_not_executable', reconciliation: [],
    selection: {
      workItemId: entry.workItemId, approvedProposalVersion: entry.approvedProposalVersion,
      approvalSeq: entry.approvalSeq, targetReference: entry.targetReference,
      selectionPolicy: 'backlog_driver', queueSize: 0, runnerUpApprovalSeq: null, skippedOccupiedTargets: 0,
    },
    claimId: null, attemptId: null, terminalKind: null, routingDecision: null, routingAdjustment: null,
    claimReleased: false, requiresAnotherTurn: false, refusal: { code, message }, gaps: [],
  });

  const result = await runAutonomousBacklogCycle({
    readBacklog: () => readAutonomousBacklogCandidates(client),
    // Resource Governor: hoje advisory (read-only), sem gate canônico de execução.
    // O porto está pronto para recebê-lo; até lá o host permite (a proteção real
    // vem das guardas atômicas e da reserva interativa no orçamento).
    hostPermitsAutonomousWork: () => true,
    maxTurns,
    signal: driverSignal,
    runTurn: async (entry, signal) => {
      // Contrato persistido do item escolhido → executor de worktree (project:anima).
      const item = await client.from('work_items').select('intent').eq('id', entry.workItemId).maybeSingle();
      if (item.error || !item.data) {
        return notExecutable(entry, 'work_item_unavailable', 'O item selecionado não pôde ser lido para execução.');
      }
      const contract = readExecutionContract(item.data.intent);
      const gateObservations: ObservedGateInput[] = [];
      const coderObservations: ObservedCoderInput[] = [];
      const selection = resolveExecutorRoute(contract, {
        gateObserver: outcome => gateObservations.push(outcome),
        coderObserver: outcome => coderObservations.push(outcome),
      });
      if (!selection.ok) return notExecutable(entry, selection.error.code, selection.error.message);

      const turn = await runSupervisorTurn({
        client, routes: [selection.route], ownerInstanceId,
        newId: () => crypto.randomUUID(), signal,
        requestedWork: { workItemId: entry.workItemId, expectedProposalVersion: entry.approvedProposalVersion },
      });

      // Observação host-side pós-volta (evidência de gate/coder/git + parecer do
      // Verifier) — a MESMA da rota supervisor-turn. Fail-open: nunca altera o desfecho.
      await persistPostTurnHostObservations({ client, result: turn, contract, gateObservations, coderObservations });
      return turn;
    },
  });

  return Response.json({ ok: true, value: result }, { status: 200 });
}
