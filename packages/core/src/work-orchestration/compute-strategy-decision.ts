// ============================================================
// CLOUD RESOURCE MATCHING V1 — DECISÃO ESTRATÉGICA DE COMPUTE (humana), pura.
//
// Há DOIS níveis distintos de decisão, e este módulo cobre o PRIMEIRO:
//
//   1. ESTRATÉGIA DE COMPUTE — decisão HUMANA. Entre `local` (Goma), `cloud_self_hosted`
//      (GPU alugada que a Goma orquestra) e `third_party_api` (OpenAI/Anthropic). O Anima
//      MEDE e COMPARA, mas NÃO escolhe sozinho entre nuvem e API terceira: quando há mais de
//      uma estratégia paga plausível — ou qualquer estratégia paga entraria sem seleção humana
//      prévia — apresenta a comparação e AGUARDA a escolha humana. Preferência: `local`
//      primeiro, quando realmente suficiente.
//
//   2. RECURSO TÁTICO DENTRO DA ESTRATÉGIA — decisão do ANIMA (ver `cloud-resource-matching`).
//      Depois que o humano escolheu (ex.: `cloud_self_hosted`), o Anima escolhe sozinho o
//      recurso concreto compatível (A40, A6000, L40S, A100, …) dentro dos requisitos/budget.
//
// Coerente com o manifesto: ações financeiras/estratégicas exigem aprovação humana prévia.
// Este módulo é PURO e determinístico — não observa provider, não persiste, não gasta.
// ============================================================

export type ComputeStrategyV1 = 'local' | 'cloud_self_hosted' | 'third_party_api';

/** Uma estimativa monetária associada a uma dimensão de comparação. `null` = desconhecida. */
export interface StrategyMoneyV1 {
  readonly currency: string;
  readonly amount: number;
}

/**
 * Uma estratégia candidata com as dimensões OBJETIVAS que o humano compara. Todas as dimensões
 * além de `available`/`meetsRequirements` são descritivas (para a projeção de comparação) e não
 * alteram a decisão de FRONTEIRA (quem escolhe é o humano) — servem para que a escolha seja
 * informada. `null` em qualquer dimensão significa "não medido/indisponível", nunca "zero".
 */
export interface ComputeStrategyOptionV1 {
  readonly strategy: ComputeStrategyV1;
  /** A estratégia está operável agora (provider/hardware alcançável). */
  readonly available: boolean;
  /** A estratégia consegue, em capacidade, rodar o workload pretendido. */
  readonly meetsRequirements: boolean;
  readonly estimatedHourlyCost: StrategyMoneyV1 | null;
  readonly estimatedTotalCost: StrategyMoneyV1 | null;
  /** Latência típica de setup/provisionamento em ms (ex.: cold-start de Pod). `null` = n/d. */
  readonly provisioningLatencyMs: number | null;
  /** VRAM disponível na estratégia (GiB), quando aplicável. */
  readonly availableVramGiB: number | null;
  /** Qualidade esperada do resultado (0..1), quando estimável. */
  readonly expectedQuality: number | null;
  /** Depende de um provider proprietário fechado (ex.: API terceira). */
  readonly proprietaryDependency: boolean;
  /** Confiança na avaliação (0..1) — deriva de evidência histórica/telemetria. */
  readonly confidence: number | null;
  /** Nota curta de evidência histórica (ex.: "Bobcat A40 PASS"). Livre, opcional. */
  readonly evidenceNote: string | null;
}

export type ComputeStrategyReasonCodeV1 =
  | 'human_selected'
  | 'local_sufficient'
  | 'multiple_strategies_plausible'
  | 'selected_strategy_infeasible'
  | 'no_viable_strategy';

export interface ComputeStrategyComparisonV1 {
  readonly schemaVersion: 1;
  /** Estratégia preferida a sinalizar ao humano (ex.: `local` quando suficiente). `null` quando
   * não há preferência clara. NUNCA é uma escolha — só uma recomendação para a decisão humana. */
  readonly preferred: ComputeStrategyV1 | null;
  readonly options: readonly ComputeStrategyOptionV1[];
}

export type ComputeStrategyDecisionV1 =
  // Estratégia resolvida sem exigir (nova) decisão humana: ou o humano já escolheu, ou o local
  // é suficiente e é a ÚNICA estratégia viável (sem escolha estratégica a fazer, sem gasto).
  | { readonly schemaVersion: 1; readonly status: 'selected'; readonly strategy: ComputeStrategyV1; readonly reasonCode: 'human_selected' | 'local_sufficient'; readonly reason: string }
  // Fronteira humana: existe escolha estratégica (paga) plausível — apresenta comparação e aguarda.
  | { readonly schemaVersion: 1; readonly status: 'human_decision_required'; readonly reasonCode: 'multiple_strategies_plausible'; readonly reason: string; readonly comparison: ComputeStrategyComparisonV1 }
  // Barreira real: nada viável, ou a estratégia que o humano escolheu não é factível agora.
  | { readonly schemaVersion: 1; readonly status: 'blocked'; readonly reasonCode: 'selected_strategy_infeasible' | 'no_viable_strategy'; readonly reason: string };

const isViable = (option: ComputeStrategyOptionV1): boolean => option.available && option.meetsRequirements;

/**
 * Decide a ESTRATÉGIA de compute — PURA e fail-safe para a fronteira humana.
 *
 *  - `humanSelected` presente e viável ⇒ `selected` (o humano já decidiu; o Anima não reabre).
 *  - `humanSelected` presente mas inviável ⇒ `blocked` (`selected_strategy_infeasible`): NÃO
 *    substitui silenciosamente a escolha humana por outra estratégia.
 *  - Sem seleção humana:
 *      • nenhuma viável ⇒ `blocked` (`no_viable_strategy`);
 *      • APENAS `local` viável ⇒ `selected` local (`local_sufficient`) — sem gasto, sem escolha
 *        estratégica a fazer;
 *      • qualquer estratégia PAGA viável (com ou sem local também viável) ⇒
 *        `human_decision_required`: entrar em nuvem/API é decisão humana. `preferred` aponta para
 *        `local` quando ele também é viável (preferência por local suficiente), senão `null`.
 *
 * O Anima NUNCA retorna `third_party_api` sem seleção humana explícita, e NUNCA escolhe sozinho
 * entre `cloud_self_hosted` e `third_party_api`.
 */
export function decideComputeStrategy(input: {
  readonly humanSelected: ComputeStrategyV1 | null;
  readonly options: readonly ComputeStrategyOptionV1[];
}): ComputeStrategyDecisionV1 {
  const viable = input.options.filter(isViable);

  if (input.humanSelected !== null) {
    const chosen = input.options.find(o => o.strategy === input.humanSelected);
    if (chosen && isViable(chosen)) {
      return { schemaVersion: 1, status: 'selected', strategy: input.humanSelected, reasonCode: 'human_selected',
        reason: `Estratégia escolhida pelo humano (${input.humanSelected}) é viável; o Anima não reabre a decisão.` };
    }
    return { schemaVersion: 1, status: 'blocked', reasonCode: 'selected_strategy_infeasible',
      reason: `A estratégia escolhida pelo humano (${input.humanSelected}) não é factível agora; nenhuma substituição silenciosa.` };
  }

  if (viable.length === 0) {
    return { schemaVersion: 1, status: 'blocked', reasonCode: 'no_viable_strategy',
      reason: 'Nenhuma estratégia de compute é viável (disponibilidade e/ou capacidade insuficientes).' };
  }

  const localViable = viable.some(o => o.strategy === 'local');
  const nonLocalViable = viable.filter(o => o.strategy !== 'local');
  if (localViable && nonLocalViable.length === 0) {
    return { schemaVersion: 1, status: 'selected', strategy: 'local', reasonCode: 'local_sufficient',
      reason: 'O compute local é suficiente e é a única estratégia viável — sem gasto e sem escolha estratégica.' };
  }

  return {
    schemaVersion: 1, status: 'human_decision_required', reasonCode: 'multiple_strategies_plausible',
    reason: 'Há estratégia paga plausível; a escolha entre local, nuvem própria e API terceira é uma decisão humana.',
    comparison: { schemaVersion: 1, preferred: localViable ? 'local' : null, options: input.options },
  };
}
