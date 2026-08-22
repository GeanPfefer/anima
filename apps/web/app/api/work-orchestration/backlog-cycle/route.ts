import { authenticateRequest } from '@/lib/supabase/request-auth';
import { buildProjectBacklogCycleDeps } from '@/lib/work-orchestration/autonomous-backlog-deps';
import { runAutonomousBacklogCycle } from '@/lib/work-orchestration/autonomous-backlog-driver';

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
//
// A CONTINUAÇÃO entre voltas de UMA invocação já é feita por `maxTurns > 1`. A
// continuação entre CICLOS (host-turn) vive em `backlog-host-turn`.

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
  const deps = buildProjectBacklogCycleDeps(client, ownerInstanceId);

  // A execução do driver não herda o lifetime do transporte HTTP: abandonar a
  // página não cancela um ciclo em andamento. O limite estrutural `maxTurns` e as
  // fronteiras humanas são as paradas — coerente com a rota supervisor-turn.
  const driverSignal = new AbortController().signal;

  const result = await runAutonomousBacklogCycle({ ...deps, maxTurns, signal: driverSignal });

  return Response.json({ ok: true, value: result }, { status: 200 });
}
