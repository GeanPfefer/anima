import type { MachineSnapshotV1, WorkloadCostObservationV1 } from './resource-observation';

// Resource Governor V0 — camada de CLASSIFICAÇÃO.
//
// Interpretação dos fatos observados, SEPARADA da evidência. A telemetria é fato;
// `low/medium/high/unknown` é parecer. Nada aqui decide executar/adiar — isso é a
// camada de advisory. E nada aqui executa efeito externo: são funções puras.
//
// FILOSOFIA (não thresholds universais): o custo de UM workload é classificado
// RELATIVO a uma distribuição de referência OBSERVADA — não a milissegundos mágicos
// tratados como verdade absoluta. "high" significa "caro PARA ESTA MÁQUINA/histórico",
// derivado dos próprios percentis dos dados. Sem amostras suficientes para ranquear, a
// resposta honesta é `unknown` — o V0 aprende com fatos, não inventa uma faixa.

/** Classe de custo: interpretação, não fato. `unknown` = evidência insuficiente. */
export type CostClass = 'low' | 'medium' | 'high' | 'unknown';

/** Pressão da máquina num instante: interpretação de um snapshot. `unknown` quando a
 * telemetria de memória está ausente. */
export type MachinePressure = 'low' | 'moderate' | 'high' | 'unknown';

/** Distribuição de custo (duração) derivada de observações — a REFERÊNCIA relativa da
 * qual as faixas low/medium/high emergem. As faixas são os próprios percentis dos
 * dados, não constantes universais. */
export interface CostDistribution {
  readonly count: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly maxMs: number;
}

/** Reserva interativa configurada — INJETADA pelo host/usuário, nunca embutida como
 * verdade universal no core. Diz quanto da máquina preservar e se o usuário está
 * ativo agora. */
export interface InteractiveReserve {
  /** O usuário está usando a máquina interativamente agora (ex.: um jogo aberto)? */
  readonly interactiveReserveActive: boolean;
  /** Fração mínima de RAM livre a preservar. Abaixo dela → pressão alta. */
  readonly minFreeMemFraction: number;
  /** Acima desta fração de RAM livre → sem pressão (confortável). */
  readonly comfortableFreeMemFraction: number;
}

/** Reserva padrão de referência (provisória e ajustável). NÃO é verdade universal —
 * é só um ponto de partida honesto que o host pode sobrescrever. */
export const DEFAULT_INTERACTIVE_RESERVE: InteractiveReserve = {
  interactiveReserveActive: false,
  minFreeMemFraction: 0.1,
  comfortableFreeMemFraction: 0.25,
};

/** Mínimo de amostras para ranquear custo. Abaixo disso não há espalhamento suficiente
 * para dizer "alto" ou "baixo" honestamente → `unknown`. */
export const MIN_SAMPLES_TO_RANK = 3;

/** Percentil por posto-mais-próximo (determinístico) sobre valores JÁ ordenados. */
const percentile = (sortedAsc: readonly number[], fraction: number): number => {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const rank = Math.ceil(fraction * sortedAsc.length);
  const index = Math.min(Math.max(rank, 1), sortedAsc.length) - 1;
  return sortedAsc[index]!;
};

/** Constrói a distribuição de custo (duração) a partir de observações. Determinística. */
export function buildCostDistribution(observations: readonly WorkloadCostObservationV1[]): CostDistribution {
  const durations = observations.map(o => o.durationMs).sort((a, b) => a - b);
  if (durations.length === 0) return { count: 0, p50Ms: 0, p90Ms: 0, maxMs: 0 };
  return {
    count: durations.length,
    p50Ms: percentile(durations, 0.5),
    p90Ms: percentile(durations, 0.9),
    maxMs: durations[durations.length - 1]!,
  };
}

/**
 * Classifica o custo de UMA duração relativo a uma distribuição de referência. Puro.
 * `unknown` quando a referência tem amostras insuficientes OU não há espalhamento
 * (todas as durações iguais → não dá para dizer alto/baixo). Caso contrário: `<= p50`
 * → low; entre p50 e p90 → medium; `>= p90` (a cauda cara) → high. As fronteiras são
 * os percentis dos dados — aprendidas, não universais.
 */
export function classifyObservationCost(durationMs: number, distribution: CostDistribution): CostClass {
  if (distribution.count < MIN_SAMPLES_TO_RANK) return 'unknown';
  if (distribution.maxMs <= 0 || distribution.p50Ms >= distribution.maxMs) return 'unknown';
  if (durationMs <= distribution.p50Ms) return 'low';
  if (durationMs < distribution.p90Ms) return 'medium';
  return 'high';
}

/** Severidade ordinal para desempate/agregação conservadora. */
export const COST_CLASS_SEVERITY: Readonly<Record<CostClass, number>> = { unknown: 0, low: 1, medium: 2, high: 3 };

/**
 * Classifica a pressão da máquina a partir de um snapshot e da reserva injetada.
 * `unknown` quando não há telemetria de memória confiável. Fronteiras vêm da reserva
 * (injetada), não de constantes universais no core.
 */
export function classifyMachinePressure(
  snapshot: MachineSnapshotV1 | null,
  reserve: InteractiveReserve = DEFAULT_INTERACTIVE_RESERVE,
): MachinePressure {
  if (!snapshot) return 'unknown';
  const { freeMemBytes, totalMemBytes } = snapshot;
  if (freeMemBytes === undefined || totalMemBytes === undefined || totalMemBytes <= 0) return 'unknown';
  const freeFraction = freeMemBytes / totalMemBytes;
  if (freeFraction < reserve.minFreeMemFraction) return 'high';
  if (freeFraction < reserve.comfortableFreeMemFraction) return 'moderate';
  return 'low';
}
