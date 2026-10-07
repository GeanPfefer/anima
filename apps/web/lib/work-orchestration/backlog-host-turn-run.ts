import { planAutonomousBacklogTurn, type AgenticRuntimeMode } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildProjectBacklogCycleDeps } from './autonomous-backlog-deps';
import { runAutonomousBacklogCycle } from './autonomous-backlog-driver';
import { runAutonomousBacklogHostTurn, type BacklogHostTurnResult } from './autonomous-backlog-host-turn';
import { classifyApprovedUnclassified, readPostApprovalClassificationConfig, type PostApprovalClassificationConfig, type PostApprovalClassificationEnsure } from './post-approval-classification';
import { ensurePlannedProjectClassification } from './planned-project-classification';

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
  /** Quando veio de um ato explícito, limita ESTA invocação ao item solicitado. */
  readonly requestedWorkItemId?: string;
  /** Overrides only for composition tests; production uses process.env and the caller's RLS client. */
  readonly postApprovalClassificationConfig?: PostApprovalClassificationConfig | null;
  readonly postApprovalClassificationEnsure?: PostApprovalClassificationEnsure;
  /**
   * Modo do laço do coder local. Ausente ⇒ `autonomous` (bounded) — é o que o Resident
   * Host e a rota HTTP recebem. `supervised` (sem teto de rodadas de investigação;
   * guarda de progresso + deadline) exige declaração EXPLÍCITA de um invocador
   * acompanhado por humano e, por segurança, um `requestedWorkItemId`.
   */
  readonly coderRuntimeMode?: AgenticRuntimeMode;
  /** Preflight opcional do node cloud pronto, antes da attempt (ver `buildProjectBacklogCycleDeps`). */
  readonly coderNodePreflight?: NonNullable<Parameters<typeof buildProjectBacklogCycleDeps>[2]>['coderNodePreflight'];
}

/**
 * Roda um host-turn bounded do backlog do projeto para um cliente autenticado. A SELEÇÃO
 * e a EXCLUSÃO MÚTUA permanecem server-side; o desfecho máximo é `review`. Devolve o
 * resultado tipado do host-turn (continuation | wait | stop + moreWorkAvailable).
 */
export function runProjectBacklogHostTurn(input: RunProjectBacklogHostTurnInput): Promise<BacklogHostTurnResult> {
  // SUPERVISED nunca vale para a fila: só para UM item pedido explicitamente.
  if (input.coderRuntimeMode === 'supervised' && !input.requestedWorkItemId) {
    return Promise.reject(new Error('coderRuntimeMode=supervised exige requestedWorkItemId (nunca vale para a fila autônoma).'));
  }
  const depsOptions = {
    ...(input.coderRuntimeMode ? { coderRuntimeMode: input.coderRuntimeMode } : {}),
    ...(input.coderNodePreflight ? { coderNodePreflight: input.coderNodePreflight } : {}),
  };
  const baseDeps = Object.keys(depsOptions).length > 0
    ? buildProjectBacklogCycleDeps(input.client, input.ownerInstanceId, depsOptions)
    : buildProjectBacklogCycleDeps(input.client, input.ownerInstanceId);
  const deps = input.requestedWorkItemId ? {
    ...baseDeps,
    // Amarração ao item pedido, MAS preservando as dependências `completed`: a projeção pura
    // precisa vê-las para satisfazer `depends_on_work_item_ids` (senão o próprio item pedido
    // sairia da fila por dependência "não-satisfeita"). Candidatos `completed` são INERTES —
    // nunca entram na fila nem executam —, então mantê-los não amplia o escopo da execução.
    readBacklog: async () => (await baseDeps.readBacklog()).filter(candidate =>
      candidate.item.id === input.requestedWorkItemId || candidate.item.state === 'completed'),
  } : baseDeps;
  const config = input.requestedWorkItemId ? null
    : input.postApprovalClassificationConfig === undefined
      ? readPostApprovalClassificationConfig(process.env) : input.postApprovalClassificationConfig;
  const attempted = new Set<string>();
  const cycleDeps = config ? {
    ...deps,
    readBacklog: async () => {
      const candidates = await deps.readBacklog();
      const summary = await classifyApprovedUnclassified(candidates, {
        since: config.since, attempted,
        ensure: input.postApprovalClassificationEnsure ?? ((id, version) => ensurePlannedProjectClassification(input.client, id, version)),
      });
      return summary.classified.length + summary.replayed.length > 0 ? deps.readBacklog() : candidates;
    },
  } : deps;
  return runAutonomousBacklogHostTurn({
    // Um ciclo bounded = o driver já provado, com `maxTurns = maxTurnsPerCycle`.
    runCycle: signal => runAutonomousBacklogCycle({ ...cycleDeps, maxTurns: input.maxTurnsPerCycle, signal }),
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
