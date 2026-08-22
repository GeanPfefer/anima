import { planAutonomousBacklogTurn } from '@anima/core';
import { authenticateRequest } from '@/lib/supabase/request-auth';
import { buildProjectBacklogCycleDeps } from '@/lib/work-orchestration/autonomous-backlog-deps';
import { runAutonomousBacklogCycle } from '@/lib/work-orchestration/autonomous-backlog-driver';
import { runAutonomousBacklogHostTurn } from '@/lib/work-orchestration/autonomous-backlog-host-turn';

export const runtime = 'nodejs';
export const maxDuration = 1800;

// Ponto de entrada da CONTINUAÇÃO do backlog: UMA invocação de host que roda até
// `maxCycles` ciclos bounded, continuando sozinha enquanto um ciclo bater no seu
// bound (`max_turns_reached`) e houver mais trabalho, e parando com veredito TIPADO
// (continue | wait | stop) + `moreWorkAvailable`. Não é daemon nem always-on: dois
// limites estruturais (`maxTurnsPerCycle × maxCycles`) tetam a invocação.
//
// Cada ciclo usa a MESMA maquinaria real da rota `backlog-cycle` (worktree/qwen3-coder
// + observação host-side), via `buildProjectBacklogCycleDeps`. SELEÇÃO/EXCLUSÃO
// server-side; desfecho máximo `review`. Autenticação obrigatória.

const DEFAULT_MAX_TURNS_PER_CYCLE = 1;
const DEFAULT_MAX_CYCLES = 2;
const MAX_TURNS_PER_CYCLE_CEILING = 10;
const MAX_CYCLES_CEILING = 10;

// Ausente ⇒ default (válido); presente e inteiro≥1 ⇒ o valor; presente e inválido ⇒ erro.
const parseBound = (value: unknown): { ok: true; value: number | undefined } | { ok: false } =>
  value === undefined ? { ok: true, value: undefined }
    : (Number.isInteger(value) && Number(value) >= 1 ? { ok: true, value: Number(value) } : { ok: false });

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const { client } = auth;

  const body = await request.json().catch(() => null) as { maxTurnsPerCycle?: unknown; maxCycles?: unknown } | null;
  const tpc = parseBound(body?.maxTurnsPerCycle);
  const mc = parseBound(body?.maxCycles);
  if (!tpc.ok || !mc.ok) {
    return Response.json({
      ok: false,
      error: { code: 'invalid_bounds', message: 'maxTurnsPerCycle e maxCycles precisam ser inteiros positivos.' },
    }, { status: 400 });
  }
  const maxTurnsPerCycle = Math.min(tpc.value ?? DEFAULT_MAX_TURNS_PER_CYCLE, MAX_TURNS_PER_CYCLE_CEILING);
  const maxCycles = Math.min(mc.value ?? DEFAULT_MAX_CYCLES, MAX_CYCLES_CEILING);

  const ownerInstanceId = process.env.ANIMA_SUPERVISOR_INSTANCE_ID ?? 'supervisor-v0';
  const deps = buildProjectBacklogCycleDeps(client, ownerInstanceId);

  // Execução do host-turn NÃO herda o lifetime do transporte HTTP; os bounds
  // estruturais e as fronteiras humanas são as paradas.
  const driverSignal = new AbortController().signal;

  const result = await runAutonomousBacklogHostTurn({
    // Um ciclo bounded = o driver já provado, com `maxTurns = maxTurnsPerCycle`.
    runCycle: signal => runAutonomousBacklogCycle({ ...deps, maxTurns: maxTurnsPerCycle, signal }),
    // Peek read-only usado só no bound de host: sobrou `execute_next` por fazer?
    peekMoreWork: async () => {
      const candidates = await deps.readBacklog();
      const decision = planAutonomousBacklogTurn({
        candidates,
        now: new Date(),
        hostPermitsAutonomousWork: deps.hostPermitsAutonomousWork(),
      });
      return decision.action === 'execute_next';
    },
    maxCycles,
    signal: driverSignal,
  });

  return Response.json({ ok: true, value: result }, { status: 200 });
}
