import { planAutonomousBacklogTurn } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildProjectBacklogCycleDeps } from './autonomous-backlog-deps';
import { runAutonomousBacklogCycle } from './autonomous-backlog-driver';
import { runAutonomousBacklogHostTurn, type BacklogHostTurnResult } from './autonomous-backlog-host-turn';

// ============================================================
// Composition root COMPARTILHADA do host-turn do projeto (ADR-003, transporte).
//
// Dado um cliente Supabase JÁ AUTENTICADO como o usuário (Bearer → `auth.uid()` → RLS),
// compõe a maquinaria real de continuação de backlog: `buildProjectBacklogCycleDeps`
// (executor de worktree + Supervisor + observação host-side) → `runAutonomousBacklogCycle`
// por ciclo → `runAutonomousBacklogHostTurn` com dois bounds estruturais e peek read-only.
//
// É a ÚNICA composição — usada TANTO pela rota HTTP `POST /…/backlog-host-turn` QUANTO
// pelo adapter IN-PROCESS do resident host. Nenhuma duplicação: a rota e o processo
// residente convergem aqui. A autoridade de identidade é o cliente injetado; esta função
// nunca constrói cliente, nunca vê token, nunca usa service_role. O `signal` é do chamador
// (a rota passa um sinal desacoplado do HTTP; o resident host passa o seu, para propagar
// cancelamento host → host-turn → ciclo → supervisor → executor).
// ============================================================

export interface RunProjectBacklogHostTurnInput {
  /** Cliente Supabase autenticado COMO O USUÁRIO (RLS). Autoridade de identidade. */
  readonly client: SupabaseClient<Database>;
  readonly ownerInstanceId: string;
  /** Bound estrutural por ciclo (voltas do Supervisor). */
  readonly maxTurnsPerCycle: number;
  /** Bound estrutural por host-turn (ciclos). Produto = teto absoluto de execuções. */
  readonly maxCycles: number;
  /** Cancelamento cooperativo do chamador. */
  readonly signal: AbortSignal;
}

/**
 * Roda um host-turn bounded do backlog do projeto para um cliente autenticado. A SELEÇÃO
 * e a EXCLUSÃO MÚTUA permanecem server-side; o desfecho máximo é `review`. Devolve o
 * resultado tipado do host-turn (continuation | wait | stop + moreWorkAvailable).
 */
export function runProjectBacklogHostTurn(input: RunProjectBacklogHostTurnInput): Promise<BacklogHostTurnResult> {
  const deps = buildProjectBacklogCycleDeps(input.client, input.ownerInstanceId);
  return runAutonomousBacklogHostTurn({
    // Um ciclo bounded = o driver já provado, com `maxTurns = maxTurnsPerCycle`.
    runCycle: signal => runAutonomousBacklogCycle({ ...deps, maxTurns: input.maxTurnsPerCycle, signal }),
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
    maxCycles: input.maxCycles,
    signal: input.signal,
  });
}
