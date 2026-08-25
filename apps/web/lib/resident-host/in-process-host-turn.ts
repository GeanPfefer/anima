import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createBearerClient } from '../supabase/bearer';
import { runProjectBacklogHostTurn } from '../work-orchestration/backlog-host-turn-run';
import type { BacklogHostTurnResult } from '../work-orchestration/autonomous-backlog-host-turn';
import type { HostTurnOutcome, ResidentIdentity } from './resident-host';

// ============================================================
// Adapter IN-PROCESS do `runHostTurn` do resident host (ADR-003, transporte).
//
// Substitui o `createHttpHostTurnPort` (que dependia do Next server em localhost:3000):
// compõe DIRETAMENTE a mesma composition root da rota (`runProjectBacklogHostTurn`),
// atrás de um cliente Supabase user-scoped construído do access token (Bearer →
// `auth.uid()` → RLS). Assim o processo residente executa o backlog SEM depender de um
// servidor HTTP vivo, preservando identidade user-scoped e SEM service_role.
//
// A composição é a MESMA da rota (nenhuma duplicação — ambos chamam
// `runProjectBacklogHostTurn`). Os seams (`buildClient`, `runHostTurn`) são injetáveis
// só para teste determinístico; o default é o caminho real.
// ============================================================

export interface InProcessHostTurnConfig {
  readonly ownerInstanceId: string;
  readonly maxTurnsPerCycle: number;
  readonly maxCycles: number;
}

export interface InProcessHostTurnSeams {
  /** Constrói o cliente user-scoped a partir do access token. Default = `createBearerClient`
   * (anon key + Bearer; NUNCA service_role). Injetável só para teste. */
  readonly buildClient?: (accessToken: string) => SupabaseClient<Database>;
  /** A composition root compartilhada com a rota. Injetável só para teste. */
  readonly runHostTurn?: (input: {
    readonly client: SupabaseClient<Database>;
    readonly ownerInstanceId: string;
    readonly maxTurnsPerCycle: number;
    readonly maxCycles: number;
    readonly signal: AbortSignal;
    readonly requestedWorkItemId?: string;
  }) => Promise<BacklogHostTurnResult>;
}

/** IDs distintos dos work_items tocados nas voltas do host-turn — puro. */
function touchedWorkItemIds(result: BacklogHostTurnResult): readonly string[] {
  const ids = new Set<string>();
  for (const cycle of result.cycles) {
    for (const turn of cycle.turns) {
      if (turn.workItemId) ids.add(turn.workItemId);
    }
  }
  return [...ids];
}

/** Mapeia o resultado tipado do host-turn no desfecho da engine — puro. */
export function mapHostTurnResult(result: BacklogHostTurnResult): HostTurnOutcome {
  return {
    ok: true,
    continuation: result.continuation,
    stopReason: result.stopReason,
    moreWorkAvailable: result.moreWorkAvailable,
    cyclesExecuted: result.cyclesExecuted,
    itemsTouched: result.itemsTouched,
    workItemIds: touchedWorkItemIds(result),
  };
}

/**
 * Porto `runHostTurn` in-process: constrói um cliente user-scoped do token e roda a
 * composition root real. Fail-closed sem access token (identidade ausente ⇒ não age).
 * Nunca lança: erros viram `{ok:false}` para a engine tratar com backoff. NUNCA usa
 * service_role — a única identidade é o Bearer do usuário.
 */
export function createInProcessHostTurnPort(
  config: InProcessHostTurnConfig,
  seams: InProcessHostTurnSeams = {},
): (identity: ResidentIdentity, signal: AbortSignal) => Promise<HostTurnOutcome> {
  const buildClient = seams.buildClient ?? createBearerClient;
  const runHostTurn = seams.runHostTurn ?? runProjectBacklogHostTurn;
  return async (identity, signal) => {
    // Fail-closed: sem token não há identidade user-scoped — não há caminho privilegiado.
    if (!identity.accessToken) return { ok: false, error: 'identity_missing' };
    try {
      const client = buildClient(identity.accessToken);
      const requestEvents=await client.from('work_events').select('work_item_id,proposal_version,seq,payload').eq('event_type','work_approved').order('seq',{ascending:false}).limit(100);
      if(requestEvents.error)return{ok:false,error:'execution_request_read_failed'};
      let requestedWorkItemId:string|undefined;
      for(const event of requestEvents.data??[]){
        const payload=event.payload as {data?:{authority?:unknown}}|null;
        if(!['autonomous_execution_request','retry_authorization'].includes(String(payload?.data?.authority)))continue;
        if(event.proposal_version===null)continue;
        const starts=await client.from('work_events').select('seq').eq('work_item_id',event.work_item_id).eq('event_type','execution_started').eq('proposal_version',event.proposal_version).gt('seq',event.seq).limit(1);
        if(!starts.error&&(starts.data?.length??0)===0){requestedWorkItemId=event.work_item_id;break;}
      }
      const result = await runHostTurn({
        client,
        ownerInstanceId: config.ownerInstanceId,
        maxTurnsPerCycle: config.maxTurnsPerCycle,
        maxCycles: config.maxCycles,
        signal,
        ...(requestedWorkItemId?{requestedWorkItemId}:{}),
      });
      return mapHostTurnResult(result);
    } catch (error) {
      if (signal.aborted) return { ok: false, error: 'cancelled' };
      return { ok: false, error: error instanceof Error ? error.message : 'in_process_failed' };
    }
  };
}
