import {
  composeResourceGovernorView,
  DEFAULT_INTERACTIVE_RESERVE,
  deriveWorkloadCostObservationsFromEvents,
  type InteractiveReserve,
  type MachineSnapshotV1,
  type ResourceGovernorView,
  type WorkEvent,
  type WorkloadCostProfileKey,
} from '@anima/core';
import { readMachineSnapshot } from './machine-telemetry';

// Seam central host-side do Resource Governor V0 (leitura). Em vez de espalhar
// telemetria por cada executor, um único ponto:
//
//   1. DERIVA o histórico de custo do log append-only já persistido (evidência de
//      gate observada pelo host — reaproveita o durationMs real, sem schema novo);
//   2. lê uma AMOSTRA barata e pontual do estado atual da máquina (node:os);
//   3. COMPÕE a visão do governor (distribuição + perfis + pressão + advisory).
//
// É ADVISORY e recomputável: nenhuma ação externa, nenhuma decisão. Não mata processo,
// não para Docker/Supabase, não descarrega modelo, não agenda. Só informa "dado o custo
// histórico deste workload e a pressão atual, seria adequado rodar agora?". A autoridade
// segue humana/política; o snapshot e a reserva são injetáveis para teste determinístico.

export interface HostResourceGovernorInput {
  /** Log de eventos do qual derivar o histórico de custo (o slice que o caller tiver). */
  readonly events: readonly WorkEvent[];
  /** Reserva interativa configurada (injetada). Default = referência provisória. */
  readonly reserve?: InteractiveReserve;
  /** Workload-alvo para o advisory; ausente → visão sem advisory (só histórico). */
  readonly target?: WorkloadCostProfileKey | null;
  /** Leitor de snapshot (injetável). Default = leitura real do host via node:os. */
  readonly readSnapshot?: () => MachineSnapshotV1;
}

/**
 * Compõe a visão do governor a partir do estado real: histórico derivado dos eventos +
 * snapshot vivo + reserva. Puro dado os inputs injetados; a única impureza é a leitura
 * do host, isolada atrás de `readSnapshot`. Nunca atua — devolve só o read-model.
 */
export function composeHostResourceGovernorView(input: HostResourceGovernorInput): ResourceGovernorView {
  const observations = deriveWorkloadCostObservationsFromEvents(input.events);
  const snapshot = (input.readSnapshot ?? readMachineSnapshot)();
  return composeResourceGovernorView({
    observations,
    snapshot,
    reserve: input.reserve ?? DEFAULT_INTERACTIVE_RESERVE,
    target: input.target ?? null,
  });
}
