import type {
  EnforcementReadinessDecisionV0,
  EnforcementReadinessDisposition,
} from './enforcement-readiness-policy';

// ============================================================
// Readiness Calibration V0 — SHADOW/ADVISORY ONLY. O consumidor que faltava da cadeia
// shadow (Differential Evidence → Policy → Readiness → Change Authorization).
//
// A doc de orquestração diz que as decisões de readiness são persistidas "para permitir
// a COMPARAÇÃO POSTERIOR entre o outcome operacional real e o que a policy decidiria".
// Nada lia essas decisões. Este módulo faz exatamente essa comparação — e SÓ isso:
// dado o que a readiness DIRIA (por-gate, shadow) e o que o HUMANO de fato decidiu na
// revisão (`accept`/`request_changes`), classifica se a readiness teria concordado.
//
// FRONTEIRA (a mesma da cadeia inteira): puro, determinístico, versionado, SEM I/O,
// LLM, relógio, rede ou estado global. NÃO executa, promove, aprova, bloqueia nem
// altera qualquer state machine. `Evidence != Policy`; `Policy != Readiness`;
// `Readiness != Enforcement`; e aqui: `Calibration != Enforcement`. A calibração é
// EVIDÊNCIA HISTÓRICA para uma futura decisão HUMANA de maturidade — a política
// automática que a consumiria permanece EXPLICITAMENTE bloqueada (Marco 005 / doc de
// orquestração). Medir a acurácia da readiness NÃO concede autonomia a ninguém.
// ============================================================

/** Calibração canônica. Mudanças semânticas exigem nova versão. */
export const READINESS_CALIBRATION_VERSION = 'readiness-calibration-v0' as const;

/**
 * Disposição da readiness ROLLUP para a tentativa inteira. A readiness é por-gate; uma
 * decisão sobre a tentativa é o AGREGADO conservador (o gate mais fraco domina). Sem
 * nenhuma decisão de readiness ⇒ `no_readiness` (evidência shadow ausente/legada).
 */
export type AttemptReadinessDisposition = EnforcementReadinessDisposition | 'no_readiness';

/** Desfecho de revisão HUMANA observado do log (append-only). */
export type ObservedReviewOutcome = 'accepted' | 'changes_requested';

/**
 * Classificação da concordância readiness×humano. O sinal que importa para maturidade:
 * entre tentativas `eligible`, a taxa de `confirmed_eligible` vs `optimistic_miss`.
 * - `confirmed_eligible`   : readiness `eligible` E humano aceitou → readiness concordou (positivo).
 * - `optimistic_miss`      : readiness `eligible` MAS humano pediu mudanças → FALSO POSITIVO
 *   (a readiness teria sido otimista demais). O sinal mais crítico a vigiar.
 * - `conservative_confirmed`: readiness NÃO-elegível E humano pediu mudanças → reteve com razão.
 * - `conservative_overruled`: readiness NÃO-elegível MAS humano aceitou → conservadora demais
 *   OU o humano aceitou trabalho de evidência mais fraca (não é erro da readiness por si só).
 * - `no_signal`            : sem readiness (nada a calibrar).
 */
export type ReadinessCalibrationOutcome =
  | 'confirmed_eligible'
  | 'optimistic_miss'
  | 'conservative_confirmed'
  | 'conservative_overruled'
  | 'no_signal';

/** Severidade (conservadorismo) da disposição: maior = mais reteve. Ordena o rollup. */
const DISPOSITION_SEVERITY: Record<EnforcementReadinessDisposition, number> = {
  eligible: 0,
  requires_review: 1,
  insufficient_evidence: 2,
  blocked: 3,
};

/**
 * Rollup conservador das readiness por-gate para UMA tentativa: a disposição MAIS
 * conservadora (severidade máxima) domina — um único gate não-elegível torna a
 * tentativa inteira não-elegível. Sem decisões ⇒ `no_readiness`. Puro.
 */
export function rollupAttemptReadiness(
  decisions: readonly EnforcementReadinessDecisionV0[],
): AttemptReadinessDisposition {
  if (decisions.length === 0) return 'no_readiness';
  let worst: EnforcementReadinessDisposition = 'eligible';
  for (const decision of decisions) {
    if (DISPOSITION_SEVERITY[decision.disposition] > DISPOSITION_SEVERITY[worst]) {
      worst = decision.disposition;
    }
  }
  return worst;
}

/**
 * Classifica a concordância entre a readiness ROLLUP da tentativa e o desfecho HUMANO
 * de revisão — puro e determinístico. NÃO julga o humano nem a readiness como "certo/
 * errado": só nomeia o quadrante para acumular evidência histórica.
 */
export function classifyReadinessCalibration(
  rollup: AttemptReadinessDisposition,
  review: ObservedReviewOutcome,
): ReadinessCalibrationOutcome {
  if (rollup === 'no_readiness') return 'no_signal';
  if (rollup === 'eligible') {
    return review === 'accepted' ? 'confirmed_eligible' : 'optimistic_miss';
  }
  // rollup não-elegível (requires_review | insufficient_evidence | blocked)
  return review === 'accepted' ? 'conservative_overruled' : 'conservative_confirmed';
}

/** Um par calibrado (tentativa × revisão) pronto para agregação. */
export interface ReadinessCalibrationRecordV0 {
  readonly workItemId: string;
  readonly attemptId: string;
  readonly approvedProposalVersion: number;
  readonly rollup: AttemptReadinessDisposition;
  readonly review: ObservedReviewOutcome;
  readonly outcome: ReadinessCalibrationOutcome;
}

export interface ReadinessCalibrationSummaryV0 {
  readonly version: typeof READINESS_CALIBRATION_VERSION;
  readonly total: number;
  readonly byOutcome: Record<ReadinessCalibrationOutcome, number>;
  /** Tentativas em que a readiness diria `eligible` (confirmed + optimistic). */
  readonly eligibleAttempts: number;
  /**
   * Precisão de `eligible`: confirmados / (confirmados + otimistas). `null` sem
   * nenhuma tentativa elegível. É a métrica que uma decisão HUMANA de maturidade
   * poderia inspecionar — nunca uma promoção automática.
   */
  readonly eligiblePrecision: number | null;
}

const EMPTY_BY_OUTCOME = (): Record<ReadinessCalibrationOutcome, number> => ({
  confirmed_eligible: 0,
  optimistic_miss: 0,
  conservative_confirmed: 0,
  conservative_overruled: 0,
  no_signal: 0,
});

/**
 * Agrega registros calibrados em contagens e na precisão de `eligible` — pura. Sem
 * registros ⇒ zeros e precisão `null` (nunca fabrica confiança sobre amostra vazia).
 */
export function summarizeReadinessCalibration(
  records: readonly ReadinessCalibrationRecordV0[],
): ReadinessCalibrationSummaryV0 {
  const byOutcome = EMPTY_BY_OUTCOME();
  for (const record of records) byOutcome[record.outcome] += 1;
  const eligibleAttempts = byOutcome.confirmed_eligible + byOutcome.optimistic_miss;
  return {
    version: READINESS_CALIBRATION_VERSION,
    total: records.length,
    byOutcome,
    eligibleAttempts,
    eligiblePrecision: eligibleAttempts === 0 ? null : byOutcome.confirmed_eligible / eligibleAttempts,
  };
}
