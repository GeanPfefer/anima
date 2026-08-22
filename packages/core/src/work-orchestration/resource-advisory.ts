import {
  buildCostDistribution,
  classifyMachinePressure,
  DEFAULT_INTERACTIVE_RESERVE,
  type CostClass,
  type CostDistribution,
  type InteractiveReserve,
  type MachinePressure,
} from './resource-classification';
import {
  findWorkloadCostProfile,
  projectWorkloadCostProfiles,
  type WorkloadCostProfile,
  type WorkloadCostProfileKey,
} from './resource-history';
import type { MachineSnapshotV1, WorkloadCostObservationV1 } from './resource-observation';

// Resource Governor V0 — camada de ADVISORY (apoio à decisão).
//
// A ÚLTIMA camada da separação: EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ ADVISORY/DECISÃO. A partir
// de (custo histórico conhecido + telemetria atual + reserva interativa), produz um
// parecer ESTRUTURADO sobre a adequação de rodar um workload AGORA. É uma função pura:
//
//   * NÃO executa ação nenhuma (não mata processo, não para Docker, não descarrega
//     modelo, não agenda nada) — é sensor + parecer, jamais atuador;
//   * NÃO afrouxa gate nem remove validação — decide QUANDO/COMO, nunca SE pode;
//   * é RECOMPUTÁVEL de observações + snapshot + reserva, sem estado próprio.
//
// A autoridade continua humana/política. O advisory só informa.

/** Recomendação estruturada. `insufficient_evidence` é a resposta honesta quando não
 * há histórico bastante para julgar o custo do workload. */
export type ExecutionAdvisory =
  | 'safe_to_run'
  | 'prefer_defer'
  | 'machine_exclusive_recommended'
  | 'insufficient_evidence';

export interface ResourceAdvisory {
  readonly recommendation: ExecutionAdvisory;
  readonly rationale: string;
  readonly basis: {
    readonly workloadClass: CostClass;
    readonly machinePressure: MachinePressure;
    readonly sampleCount: number;
    readonly reserveActive: boolean;
  };
}

/** Rótulo legível (PT-BR) da recomendação do advisory. Descritor de APRESENTAÇÃO
 * compartilhado web/mobile — a régua de `describeValidationOutcome`/`describeCostClass`.
 * Read-only: a recomendação informa, jamais atua. */
export const describeExecutionAdvisory = (recommendation: ExecutionAdvisory): string =>
  recommendation === 'safe_to_run' ? 'seguro rodar agora'
    : recommendation === 'prefer_defer' ? 'prefira adiar para uma janela ociosa'
    : recommendation === 'machine_exclusive_recommended' ? 'recomende uma janela de máquina exclusiva'
    : 'evidência insuficiente para recomendar';

/** Rótulo legível (PT-BR) da pressão da máquina. Compartilhado web/mobile. */
export const describeMachinePressure = (pressure: MachinePressure): string =>
  pressure === 'low' ? 'baixa' : pressure === 'moderate' ? 'moderada' : pressure === 'high' ? 'alta' : 'indeterminada';

export interface AdviseWorkloadExecutionInput {
  readonly profile: WorkloadCostProfile | null;
  readonly snapshot: MachineSnapshotV1 | null;
  readonly reserve?: InteractiveReserve;
}

const advisory = (
  recommendation: ExecutionAdvisory,
  rationale: string,
  workloadClass: CostClass,
  machinePressure: MachinePressure,
  sampleCount: number,
  reserveActive: boolean,
): ResourceAdvisory => ({
  recommendation,
  rationale,
  basis: { workloadClass, machinePressure, sampleCount, reserveActive },
});

/**
 * Produz o advisory de execução. Determinístico e puro. A lógica separa duas eixos:
 * o CUSTO do workload (do histórico, relativo) e a PRESSÃO da máquina (do snapshot,
 * relativo à reserva). Sem histórico utilizável → `insufficient_evidence` (não
 * inventamos um custo). Barato → sempre seguro. Caro → adia ou pede máquina exclusiva
 * conforme a reserva e a pressão atual.
 */
export function adviseWorkloadExecution(input: AdviseWorkloadExecutionInput): ResourceAdvisory {
  const reserve = input.reserve ?? DEFAULT_INTERACTIVE_RESERVE;
  const pressure = classifyMachinePressure(input.snapshot, reserve);
  const sampleCount = input.profile?.count ?? 0;
  const workloadClass: CostClass = input.profile?.predominantClass ?? 'unknown';
  const reserveActive = reserve.interactiveReserveActive;

  // Sem custo conhecido do workload, não há como julgar adequação — honestidade.
  if (input.profile === null || workloadClass === 'unknown') {
    return advisory('insufficient_evidence',
      'Sem histórico de custo suficiente para este workload; observe mais execuções antes de julgar.',
      workloadClass, pressure, sampleCount, reserveActive);
  }

  if (workloadClass === 'low') {
    return advisory('safe_to_run',
      'Workload historicamente barato: seguro rodar mesmo sob uso interativo.',
      workloadClass, pressure, sampleCount, reserveActive);
  }

  if (workloadClass === 'high') {
    if (reserveActive || pressure === 'high') {
      return advisory('machine_exclusive_recommended',
        reserveActive
          ? 'Workload historicamente caro e usuário ativo: recomende uma janela de máquina exclusiva.'
          : 'Workload historicamente caro e máquina sob pressão: recomende uma janela de máquina exclusiva.',
        workloadClass, pressure, sampleCount, reserveActive);
    }
    if (pressure === 'moderate') {
      return advisory('prefer_defer',
        'Workload historicamente caro e pressão moderada: prefira adiar para uma janela ociosa.',
        workloadClass, pressure, sampleCount, reserveActive);
    }
    return advisory('safe_to_run',
      'Workload caro, mas máquina livre e sem reserva interativa ativa: seguro rodar agora.',
      workloadClass, pressure, sampleCount, reserveActive);
  }

  // medium
  if (reserveActive && pressure === 'high') {
    return advisory('machine_exclusive_recommended',
      'Custo médio com usuário ativo e máquina sob pressão: recomende janela de máquina exclusiva.',
      workloadClass, pressure, sampleCount, reserveActive);
  }
  if (pressure === 'high' || (reserveActive && pressure !== 'low')) {
    return advisory('prefer_defer',
      'Custo médio com pressão/uso interativo: prefira adiar para reduzir contenção.',
      workloadClass, pressure, sampleCount, reserveActive);
  }
  return advisory('safe_to_run',
    'Custo médio e máquina com folga: seguro rodar agora.',
    workloadClass, pressure, sampleCount, reserveActive);
}

/** Advisory de UM workload histórico, emparelhado à sua chave `(kind, command, repo)`.
 * Read-only: informa, jamais atua. */
export interface WorkloadAdvisory {
  readonly key: WorkloadCostProfileKey;
  readonly advisory: ResourceAdvisory;
}

/**
 * Produz o advisory de CADA perfil histórico contra o MESMO snapshot e a MESMA reserva.
 * Puro e determinístico. Um turno do Supervisor exercita vários workloads (múltiplos
 * gates → múltiplos perfis); cada um recebe seu parecer RELATIVO ao seu próprio custo
 * histórico, sem colapsar workloads distintos num único juízo. Preserva a ordem
 * (já determinística) dos perfis. Não decide nem atua — só empilha pareceres.
 */
export function adviseWorkloadProfiles(
  profiles: readonly WorkloadCostProfile[],
  snapshot: MachineSnapshotV1 | null,
  reserve: InteractiveReserve = DEFAULT_INTERACTIVE_RESERVE,
): readonly WorkloadAdvisory[] {
  return profiles.map(profile => ({
    key: profile.key,
    advisory: adviseWorkloadExecution({ profile, snapshot, reserve }),
  }));
}

export interface AdviseDeclaredGatesInput {
  /** Comandos de gate DECLARADOS no contrato do item (o que ele VAI rodar). */
  readonly commands: readonly string[];
  /** Observações de custo MACHINE-WIDE (todos os itens) das quais tirar o histórico. */
  readonly observations: readonly WorkloadCostObservationV1[];
  readonly snapshot: MachineSnapshotV1 | null;
  readonly reserve?: InteractiveReserve;
}

/**
 * Advisory ANTES de rodar: para cada gate **declarado** no contrato do item, o parecer
 * relativo ao histórico **machine-wide** daquele comando + a pressão atual. Difere de
 * `adviseWorkloadProfiles` (que aconselha sobre o que JÁ foi observado): aqui um gate
 * declarado mas **nunca observado** aparece honestamente como `insufficient_evidence`,
 * em vez de sumir. Puro e determinístico; deduplica comandos e ignora vazios, preservando
 * a ordem de declaração. Não decide nem atua — só informa a decisão de rodar.
 */
export function adviseDeclaredGates(input: AdviseDeclaredGatesInput): readonly WorkloadAdvisory[] {
  const reserve = input.reserve ?? DEFAULT_INTERACTIVE_RESERVE;
  const distribution = buildCostDistribution(input.observations);
  const profiles = projectWorkloadCostProfiles(input.observations, distribution);
  const seen = new Set<string>();
  const advisories: WorkloadAdvisory[] = [];
  for (const command of input.commands) {
    if (typeof command !== 'string' || command.trim().length === 0 || seen.has(command)) continue;
    seen.add(command);
    const key: WorkloadCostProfileKey = { workloadKind: 'gate', command, repo: null };
    const profile = findWorkloadCostProfile(profiles, key);
    advisories.push({ key, advisory: adviseWorkloadExecution({ profile, snapshot: input.snapshot, reserve }) });
  }
  return advisories;
}

export interface AdviseDeclaredCoderInput {
  /** Identidade (`backendId` = provider:model) do coder que o item VAI rodar. `null` quando
   * o contrato não permite prevê-la (ex.: modelo não pinado) — honestamente omitido. */
  readonly backendId: string | null;
  /** Observações de custo do CODER machine-wide (só coder — proveniência preservada). */
  readonly observations: readonly WorkloadCostObservationV1[];
  readonly snapshot: MachineSnapshotV1 | null;
  readonly reserve?: InteractiveReserve;
}

/**
 * Advisory ANTES de rodar para o CODER declarado do item — o análogo de `adviseDeclaredGates`
 * para a inteligência que escreve o código (a parte tipicamente MAIS cara de um run). A
 * distribuição de referência é a do PRÓPRIO coder (só observações de coder), então a classe
 * significa "caro entre execuções de coder" e a semântica gate-only do advisory de gate
 * permanece intocada. `null` quando o backendId não é previsível (contrato sem modelo pinado):
 * honestidade em vez de um parecer sobre um workload que talvez nem seja o executado. Coder
 * declarado mas nunca observado vira `insufficient_evidence`. Puro e determinístico.
 */
export function adviseDeclaredCoder(input: AdviseDeclaredCoderInput): WorkloadAdvisory | null {
  if (typeof input.backendId !== 'string' || input.backendId.trim().length === 0) return null;
  const reserve = input.reserve ?? DEFAULT_INTERACTIVE_RESERVE;
  const distribution = buildCostDistribution(input.observations);
  const profiles = projectWorkloadCostProfiles(input.observations, distribution);
  const key: WorkloadCostProfileKey = { workloadKind: 'coder', command: input.backendId, repo: null };
  const profile = findWorkloadCostProfile(profiles, key);
  return { key, advisory: adviseWorkloadExecution({ profile, snapshot: input.snapshot, reserve }) };
}

/** Visão composta do Resource Governor: o read-model que a presentation/host consome. */
export interface ResourceGovernorView {
  readonly distribution: CostDistribution;
  readonly profiles: readonly WorkloadCostProfile[];
  readonly snapshot: MachineSnapshotV1 | null;
  readonly pressure: MachinePressure;
  /** Advisory para o workload-alvo, quando um alvo é informado; `null` caso contrário. */
  readonly advisory: ResourceAdvisory | null;
}

/** Autoridade de admissao de NOVO trabalho autonomo. Nao interrompe uma tentativa
 * ja iniciada: o host a consulta novamente antes de cada nova volta. */
export type ResourceAdmissionVerdict = 'permit' | 'defer' | 'fail_closed';

export interface ResourceAdmissionDecision {
  readonly verdict: ResourceAdmissionVerdict;
  readonly pressure: MachinePressure;
  readonly reason: 'host_ready' | 'resource_pressure' | 'resource_authority_unavailable';
}

/** Promove a pressao observada de advisory para gate de admissao. Somente pressao
 * baixa permite iniciar trabalho novo; telemetria indeterminada falha fechada. */
export function decideResourceAdmission(pressure: MachinePressure): ResourceAdmissionDecision {
  if (pressure === 'low') return { verdict: 'permit', pressure, reason: 'host_ready' };
  if (pressure === 'unknown') {
    return { verdict: 'fail_closed', pressure, reason: 'resource_authority_unavailable' };
  }
  return { verdict: 'defer', pressure, reason: 'resource_pressure' };
}

export interface ComposeResourceGovernorViewInput {
  readonly observations: readonly WorkloadCostObservationV1[];
  readonly snapshot: MachineSnapshotV1 | null;
  readonly reserve?: InteractiveReserve;
  readonly target?: WorkloadCostProfileKey | null;
}

/**
 * Compõe a visão do governor de ponta a ponta e de forma pura: distribuição de
 * referência (da máquina) → perfis históricos → advisory para o alvo. Recomputável do
 * conjunto de observações; sem efeito externo. É o seam central de leitura (a
 * presentation/host não recalcula as camadas por conta própria).
 */
export function composeResourceGovernorView(input: ComposeResourceGovernorViewInput): ResourceGovernorView {
  const reserve = input.reserve ?? DEFAULT_INTERACTIVE_RESERVE;
  const distribution = buildCostDistribution(input.observations);
  const profiles = projectWorkloadCostProfiles(input.observations, distribution);
  const pressure = classifyMachinePressure(input.snapshot, reserve);
  const targetProfile = input.target ? findWorkloadCostProfile(profiles, input.target) : null;
  const advisoryResult = input.target
    ? adviseWorkloadExecution({ profile: targetProfile, snapshot: input.snapshot, reserve })
    : null;
  return { distribution, profiles, snapshot: input.snapshot, pressure, advisory: advisoryResult };
}
