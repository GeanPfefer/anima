import {
  adviseWorkloadProfiles,
  buildCostDistribution,
  classifyMachinePressure,
  composeResourceGovernorView,
  DEFAULT_INTERACTIVE_RESERVE,
  deriveWorkloadCostObservationsFromEvents,
  projectWorkloadCostProfiles,
  type CostDistribution,
  type InteractiveReserve,
  type MachinePressure,
  type MachineSnapshotV1,
  type ResourceGovernorView,
  type WorkEvent,
  type WorkloadAdvisory,
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

// ---------------------------------------------------------------------------
// Consumidor read-only para o read-model do Supervisor.
//
// O `/supervisor-turn` NÃO tem um único alvo: um turno exercita vários gates. Em vez do
// advisory de UM alvo (composeResourceGovernorView), este consumidor produz o advisory de
// CADA workload histórico contra o snapshot vivo — o parecer que a resposta do turno
// carrega ao lado do desfecho. Continua ADVISORY: informa, não bloqueia, não muda
// elegibilidade, não atua. `null` quando não há observação alguma (histórico insuficiente
// = nada a aconselhar, resposta honesta em vez de um parecer inventado).
//
// MACHINE-SCOPED: os eventos alimentados são a evidência de gate de TODOS os itens do
// usuário (leitura machine-wide isolada por RLS), não de um único item. O custo de um
// workload é da MÁQUINA, não do item — `npm run typecheck` custa o mesmo independentemente
// de qual item o rodou. Assim um item NOVO já herda o custo que a máquina aprendeu em
// outros itens, em vez de começar sempre em `insufficient_evidence`. A agregação por
// comando já é machine-wide no core (a chave do perfil é (kind, command, repo), não o item).

/** Report read-only do Resource Governor anexado ao resultado de um turno do Supervisor.
 * `snapshot`/`pressure` = contexto vivo da máquina; `distribution` = a referência relativa
 * de custo (o que "caro" significa aqui); `advisories` = um parecer por workload histórico. */
export interface ResourceGovernorAdvisoryReport {
  readonly snapshot: MachineSnapshotV1 | null;
  readonly pressure: MachinePressure;
  readonly distribution: CostDistribution;
  readonly advisories: readonly WorkloadAdvisory[];
}

export interface SupervisorResourceAdvisoryInput {
  /** Evidência de gate machine-wide (todos os itens do usuário) da qual derivar o custo. */
  readonly events: readonly WorkEvent[];
  /** Reserva interativa configurada (injetada). Default = referência provisória. */
  readonly reserve?: InteractiveReserve;
  /** Leitor de snapshot (injetável). Default = leitura real do host via node:os. */
  readonly readSnapshot?: () => MachineSnapshotV1;
}

/**
 * Compõe o advisory do Supervisor a partir do estado real: histórico derivado dos eventos
 * + snapshot vivo + reserva → um parecer por perfil histórico. Puro dados os injetáveis;
 * a única impureza é a leitura do host, isolada atrás de `readSnapshot` (seam central — a
 * telemetria não se espalha pelos executores). Nunca atua: devolve só o read-model, ou
 * `null` quando não há histórico de custo para aconselhar.
 */
export function composeSupervisorResourceAdvisory(
  input: SupervisorResourceAdvisoryInput,
): ResourceGovernorAdvisoryReport | null {
  const observations = deriveWorkloadCostObservationsFromEvents(input.events);
  if (observations.length === 0) return null;
  const reserve = input.reserve ?? DEFAULT_INTERACTIVE_RESERVE;
  const snapshot = (input.readSnapshot ?? readMachineSnapshot)();
  const distribution = buildCostDistribution(observations);
  const profiles = projectWorkloadCostProfiles(observations, distribution);
  return {
    snapshot,
    pressure: classifyMachinePressure(snapshot, reserve),
    distribution,
    advisories: adviseWorkloadProfiles(profiles, snapshot, reserve),
  };
}
