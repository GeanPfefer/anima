// ============================================================
// Semântica PURA do ciclo de vida de um TURNO do DeepSeek Harness, do ponto de
// vista do HOST (candidato a CoderBackend — ADR-001; não substitui o executor).
//
// O Harness (AgentLoop do @deepseek-ai/dsh) roda o próprio laço agêntico e NÃO
// possui turn budget nativo — a própria documentação recomenda cancelar de um
// ponto de extensão de ciclo de vida (`agent/turn-stopping`/`agent/pre-step`).
// Este módulo NÃO importa o Harness: encapsula só as duas decisões PURAS que o
// host toma ao redor de um turno, para que sejam versionadas, determinísticas e
// testáveis sem provider, sem rede e sem node_modules.
//
//   1. `decideHarnessPreStep` — a decisão do hook `agent/pre-step`: quando o passo
//      prestes a rodar ultrapassa o orçamento, o host manda `agent.cancel({kind:
//      "hook", reason:"step-budget-exhausted:N"})`. É o seam OFICIAL para um step
//      budget do Resource Governor.
//   2. `classifyHarnessTurnEnd` — normaliza o `turn/end` durável (kind + reason)
//      num desfecho OBSERVADO do turno que NUNCA é tratado como sucesso: um turno
//      `completed` significa "o turno terminou", não "a tarefa foi concluída". O
//      sucesso é decidido EXCLUSIVAMENTE pelos gates do host (evidência do POC:
//      houve turno `completed` sem nenhuma alteração e com o modelo afirmando que
//      os testes passavam, enquanto `npm test` do host encontrou FAIL).
//
// Nada aqui está ratificado como valor final: o orçamento 12 é o valor com que o
// POC PROVOU o mecanismo, não a política canônica.
// ============================================================

/**
 * Orçamento de passos com que o POC PROVOU o hook `agent/pre-step` (turn/end
 * kind=aborted, reason.kind=hook, reason.reason=step-budget-exhausted:12). É
 * dado do POC, NÃO decisão canônica: o valor final é uma escolha do Resource
 * Governor, não deste módulo.
 */
export const POC_HARNESS_STEP_BUDGET = 12;

/** Limites sãos do orçamento de passos: um orçamento não positivo cancelaria o
 * primeiro passo (nunca deixaria o coder trabalhar) e um enorme derrotaria o
 * propósito de conter turnos em fuga. Fora dos limites cai no valor do POC. */
export const HARNESS_STEP_BUDGET_BOUNDS = { min: 1, max: 200 } as const;

/** Resolve um orçamento de passos para um inteiro positivo dentro dos limites.
 * Entrada malformada (não inteira, fora dos limites) volta ao valor do POC — é a
 * única forma de garantir que o hook nunca receba um orçamento inválido. */
export function resolveHarnessStepBudget(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return POC_HARNESS_STEP_BUDGET;
  return Math.max(HARNESS_STEP_BUDGET_BOUNDS.min, Math.min(raw, HARNESS_STEP_BUDGET_BOUNDS.max));
}

/** Motivo estável do cancelamento por orçamento — o texto EXATO que o POC gravou
 * no `turn/end` durável, para a evidência observada e a classificação nunca
 * divergirem no formato (`step-budget-exhausted:N`). */
export function harnessStepBudgetReason(budget: number): string {
  return `step-budget-exhausted:${resolveHarnessStepBudget(budget)}`;
}

/** Decisão do hook `agent/pre-step`: continuar ou cancelar o turno. Quando
 * cancela, `reason` é passado direto para `agent.cancel({kind:"hook", reason})`. */
export type HarnessPreStepDecision =
  | { readonly cancel: false }
  | { readonly cancel: true; readonly reason: string };

/**
 * Decide, no hook `agent/pre-step`, se o turno deve ser cancelado por esgotar o
 * orçamento de passos. Cancela quando o passo prestes a rodar ULTRAPASSA o
 * orçamento (POC: "ao ultrapassar N steps"). Fail-closed: um `step` malformado é
 * tratado como acima de qualquer orçamento (cancela) — nunca deixa um turno em
 * fuga continuar por causa de um contador inválido. PURA e sem efeitos.
 */
export function decideHarnessPreStep(input: { readonly step: number; readonly stepBudget: number }): HarnessPreStepDecision {
  const budget = resolveHarnessStepBudget(input.stepBudget);
  const step = Number.isInteger(input.step) ? input.step : Number.POSITIVE_INFINITY;
  if (step > budget) return { cancel: true, reason: harnessStepBudgetReason(budget) };
  return { cancel: false };
}

/** Formas possíveis de `turn/end.kind` que o host observa do Harness. */
export type HarnessTurnEndKind = 'completed' | 'aborted' | 'error';

/**
 * Desfecho OBSERVADO de um turno, normalizado pelo host. Nenhum destes é
 * "sucesso": o sucesso é decidido pelos gates do host, não pelo turno.
 *   - `completed-unverified`: o turno terminou por conta própria — evidência de
 *     que o coder parou, NÃO de que a tarefa foi concluída.
 *   - `aborted-by-step-budget`: o hook de orçamento cancelou o turno.
 *   - `aborted-other`: cancelado por outra razão (ex.: o `AbortSignal` do host).
 *   - `error`: o próprio turno/runtime falhou.
 */
export type HarnessObservedTurnOutcome =
  | 'completed-unverified'
  | 'aborted-by-step-budget'
  | 'aborted-other'
  | 'error';

/** O `turn/end` durável que o host lê do Harness: o `kind` e, quando abortado, a
 * razão estruturada (`reason.kind` / `reason.reason`). */
export interface HarnessTurnEnd {
  readonly kind: HarnessTurnEndKind;
  readonly reasonKind?: string | null;
  readonly reasonReason?: string | null;
}

/**
 * Normaliza um `turn/end` num desfecho observado do turno. Um `aborted` cujo
 * `reason.kind === 'hook'` e cujo `reason.reason` começa com
 * `step-budget-exhausted:` é o cancelamento do PRÓPRIO hook de orçamento; qualquer
 * outro `aborted` é `aborted-other`. `completed` vira SEMPRE `completed-unverified`
 * — a asserção de que "está pronto" é do modelo, nunca aceita como sucesso aqui.
 * PURA e sem efeitos.
 */
export function classifyHarnessTurnEnd(turnEnd: HarnessTurnEnd): HarnessObservedTurnOutcome {
  if (turnEnd.kind === 'error') return 'error';
  if (turnEnd.kind === 'aborted') {
    const byBudget = turnEnd.reasonKind === 'hook'
      && typeof turnEnd.reasonReason === 'string'
      && turnEnd.reasonReason.startsWith('step-budget-exhausted:');
    return byBudget ? 'aborted-by-step-budget' : 'aborted-other';
  }
  return 'completed-unverified';
}

/**
 * Invariante executável do POC (ponto 2): NENHUM desfecho de turno do Harness é,
 * por si só, sucesso. Existe para que qualquer chamador que fique tentado a
 * ramificar "if outcome === 'completed-unverified' → aceitar" tropece nesta
 * função e lembre que o veredito é dos gates do host. Sempre `false`.
 */
export function harnessTurnOutcomeIsAuthoritativeSuccess(_outcome: HarnessObservedTurnOutcome): false {
  return false;
}
