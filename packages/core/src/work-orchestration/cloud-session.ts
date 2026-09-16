// ============================================================
// RESILIENT CLOUD SESSION V1 — sessão cloud resiliente (PURA, determinística).
//
// Uma AUTORIZAÇÃO humana abre um ENVELOPE de sessão (teto de custo, teto de duração, 1 node por
// vez). Dentro desse envelope o Anima pode, SOZINHO, trocar de máquina/GPU quando uma máquina
// falha em publicar endpoint ou fica insalubre — SEM pedir nova autorização humana por Pod
// intermediário. A escolha CLOUD × LOCAL × API de terceiros continua HUMANA; a troca de
// máquina/placement DENTRO de cloud self-hosted é autônoma, sempre dentro do envelope.
//
// Este módulo NÃO cria Pod, NÃO chama provider, NÃO gasta, NÃO persiste. Ele responde duas
// perguntas puras:
//   1. classifyCloudProvisionFailure — esta falha de provisão é recuperável trocando de máquina,
//      exige parar porque o provider está fora, ou é terminal (auth/quota/governança)?
//   2. planNextCloudSessionAction — dado o envelope, o progresso (tempo/custo/tentativas) e o
//      próximo candidato elegível, provisiono outro ou paro (e por qual razão exata)?
//
// A governança REAL é o bound: custo total, duração da sessão, candidatos disponíveis e saúde do
// provider. O contador de tentativas é só uma REDE DEFENSIVA técnica — nunca o limite que para
// uma sessão supervisionada enquanto ainda há budget e alternativa segura.
// ============================================================

import type { RequirementMoneyV1 } from './cloud-resource-requirements';

// ---- 1. CLASSIFICAÇÃO DE FALHA DE MACHINE PROVISIONING ------------------------------------

/**
 * Classe estrutural de uma falha de provisão, na perspectiva da SESSÃO (não do adapter):
 *   - `endpoint_publication_timeout` (D): o Pod ficou RUNNING mas o endpoint SSH nunca publicou
 *     dentro do deadline. A capacidade EXISTIU; a máquina/placement específico foi lento/ruim —
 *     OUTRA máquina pode publicar. Recuperável trocando de placement.
 *   - `placement_unhealthy` (C): o recurso subiu mas túnel/health/modelo falharam — máquina ruim.
 *     Recuperável trocando de placement.
 *   - `candidate_capacity_absent` (A): a SKU pedida nunca chegou a RUNNING (sem capacidade agora).
 *     Recuperável trocando de candidato/GPU.
 *   - `provider_unavailable` (B): rede/5xx/throttle do provider — global. NÃO martelar criando
 *     Pods; parar a sessão agora.
 *   - `non_recoverable`: auth inválida, quota estourada, identidade não persistida, abort — nenhuma
 *     troca de máquina conserta; parar.
 */
export type CloudProvisionFailureClassV1 =
  | 'endpoint_publication_timeout'
  | 'placement_unhealthy'
  | 'candidate_capacity_absent'
  | 'provider_unavailable'
  | 'non_recoverable';

/**
 * O que a sessão deve fazer diante da classe:
 *   - `reprovision`: excluir ESTE placement e tentar o próximo candidato elegível (dentro do
 *     envelope).
 *   - `halt_provider_unavailable`: parar agora — provider fora; criar mais Pods só desperdiçaria.
 *   - `halt_terminal`: parar — a falha não é recuperável por outra máquina.
 */
export type CloudSessionDispositionV1 = 'reprovision' | 'halt_provider_unavailable' | 'halt_terminal';

export interface CloudProvisionFailureAssessmentV1 {
  readonly reason: string;
  readonly failureClass: CloudProvisionFailureClassV1;
  readonly disposition: CloudSessionDispositionV1;
  /** Se o placement que falhou deve ser marcado como NÃO reutilizável nesta sessão. */
  readonly excludePlacement: boolean;
}

// ALLOWLIST fail-closed: só razões PROVADAMENTE recuperáveis por troca de máquina reprovisionam.
// Qualquer razão desconhecida cai em `non_recoverable` (não queima budget em retry cego).
const RECOVERABLE_PLACEMENT: ReadonlyMap<string, CloudProvisionFailureClassV1> = new Map([
  // Pod RUNNING, endpoint não publicou na janela — a barreira observada 2026-09-10 (pod yi133…).
  ['endpoint_unpublished', 'endpoint_publication_timeout'],
  // Nunca chegou a RUNNING: sem capacidade para aquela SKU agora.
  ['capacity_unavailable', 'candidate_capacity_absent'],
  // Subiu mas o health externo (modelo/inferência) reprovou.
  ['health_failed', 'placement_unhealthy'],
  // Pod CRIADO e REST do provider alcançável, mas o túnel para ESTA máquina não ficou utilizável
  // (mapping oscilou/sumiu, TCP não roteou, ssh não subiu, ou o Pod terminou na espera). É máquina
  // ruim — trocar de placement resolve. NÃO é indisponibilidade global (essa é `provider_unreachable`,
  // emitida só quando a própria REST fica inalcançável). Barreira observada na prova viva 2026-09-10
  // (2º A40: publicou 69.30.85.9:22132 e o mapping oscilou) — antes colapsava, enganosamente, em HALT.
  ['tunnel_unavailable', 'placement_unhealthy'],
  // Falha genérica de provisão APÓS o recurso existir (túnel/modelo/parse) — máquina ruim.
  ['provision_failed', 'placement_unhealthy'],
]);

// Provider GLOBAL fora: não adianta trocar de máquina; parar sem martelar.
const PROVIDER_UNAVAILABLE: ReadonlySet<string> = new Set(['provider_unreachable', 'rate_limited']);

/**
 * Classifica, PURA e fail-closed, uma razão de falha de provisão na disposição da sessão. A razão
 * vem do `ProvisionOutcome.reason` (adapter) ou da preparação do node. Determinística: a mesma
 * razão sempre mapeia para a mesma classe/disposição.
 */
export function classifyCloudProvisionFailure(reason: string): CloudProvisionFailureAssessmentV1 {
  const recoverable = RECOVERABLE_PLACEMENT.get(reason);
  if (recoverable) {
    return { reason, failureClass: recoverable, disposition: 'reprovision', excludePlacement: true };
  }
  if (PROVIDER_UNAVAILABLE.has(reason)) {
    return { reason, failureClass: 'provider_unavailable', disposition: 'halt_provider_unavailable', excludePlacement: false };
  }
  return { reason, failureClass: 'non_recoverable', disposition: 'halt_terminal', excludePlacement: false };
}

// ---- 2. ENVELOPE DE SESSÃO + PLANNER DE REPROVISIONAMENTO ---------------------------------

/** Rede defensiva técnica de tentativas — NUNCA o limite primário (esse é budget/duração/
 * candidatos/saúde do provider). Generoso de propósito: numa sessão pequena o esgotamento de
 * candidatos para antes; o teto só barra loops patológicos. */
export const DEFAULT_MAX_PROVISION_ATTEMPTS = 16;

/**
 * Envelope de uma sessão cloud resiliente — o que a autorização humana concede à SESSÃO INTEIRA
 * (não a uma máquina). Dentro dele o Anima troca de máquina sozinho.
 */
export interface CloudSessionEnvelopeV1 {
  readonly schemaVersion: 1;
  /** Id de correlação da sessão — todo o arco (candidato→falha→teardown→settlement→próximo) o
   * compartilha, para reconstruir a sessão a partir da evidência. */
  readonly cloudSessionId: string;
  /** Teto monetário DURO da sessão inteira. `null` = sem teto agregado nesta camada (a autoridade
   * paga por-tentativa continua o teto duro no ledger). Nunca reservado por máquina; o excesso de
   * cada tentativa é liberado por settlement para a próxima. */
  readonly maxTotalCost: RequirementMoneyV1 | null;
  /** Teto de relógio de parede da sessão inteira (ms). */
  readonly maxSessionDurationMs: number;
  /** Nodes pagos simultâneos. FIXO em 1 — jamais dois Pods ao mesmo tempo. */
  readonly maxConcurrentNodes: 1;
  /** Rede defensiva de tentativas (ver DEFAULT_MAX_PROVISION_ATTEMPTS). */
  readonly maxProvisionAttempts: number;
  /** Tentativas permitidas no MESMO placement antes de excluí-lo. A identidade de placement mais
   * fina disponível ANTES do create é o `gpuTypeId` (SKU) — a REST v1 / gpuTypes do RunPod NÃO
   * expõe id de máquina física pré-create (só o `pod.id` pós-create). Default 1 (exclui a SKU na
   * primeira falha recuperável). Elevar (ex.: 2) permite RE-tentar a mesma SKU, já que cada create
   * pode cair em OUTRA máquina física — mitigando "queimar a SKU inteira por uma máquina ruim". */
  readonly maxAttemptsPerPlacement: number;
}

export interface DeriveCloudSessionEnvelopeInput {
  readonly cloudSessionId: string;
  readonly maxTotalCost?: RequirementMoneyV1 | null;
  readonly maxSessionDurationMs: number;
  readonly maxProvisionAttempts?: number;
  readonly maxAttemptsPerPlacement?: number;
}

/**
 * Constrói um envelope de sessão validado. `maxConcurrentNodes` é SEMPRE 1 (invariante de
 * segurança). Fail-closed: duração não-positiva ou id em branco ⇒ `null`. `maxTotalCost` inválido
 * (amount não-finito/negativo) ⇒ `null` (não deixa uma sessão paga sem teto por engano quando um
 * teto foi pedido). PURA.
 */
export function deriveCloudSessionEnvelope(input: DeriveCloudSessionEnvelopeInput): CloudSessionEnvelopeV1 | null {
  if (typeof input.cloudSessionId !== 'string' || input.cloudSessionId.trim() === '') return null;
  if (!Number.isFinite(input.maxSessionDurationMs) || input.maxSessionDurationMs <= 0) return null;
  if (input.maxTotalCost != null) {
    if (typeof input.maxTotalCost.currency !== 'string' || input.maxTotalCost.currency.trim() === ''
      || !Number.isFinite(input.maxTotalCost.amount) || input.maxTotalCost.amount < 0) return null;
  }
  const attempts = input.maxProvisionAttempts;
  const maxProvisionAttempts = Number.isInteger(attempts) && (attempts as number) > 0
    ? (attempts as number) : DEFAULT_MAX_PROVISION_ATTEMPTS;
  const perPlacement = input.maxAttemptsPerPlacement;
  const maxAttemptsPerPlacement = Number.isInteger(perPlacement) && (perPlacement as number) > 0
    ? (perPlacement as number) : 1;
  return {
    schemaVersion: 1,
    cloudSessionId: input.cloudSessionId,
    maxTotalCost: input.maxTotalCost ?? null,
    maxSessionDurationMs: input.maxSessionDurationMs,
    maxConcurrentNodes: 1,
    maxProvisionAttempts,
    maxAttemptsPerPlacement,
  };
}

/** Sinal de parada derivado da ÚLTIMA falha (o orquestrador o mantém entre voltas). */
export type CloudSessionHaltSignalV1 = 'none' | 'provider_unavailable' | 'terminal';

export interface CloudSessionProgressV1 {
  /** Tempo decorrido da sessão (ms) — `now - startedAt`. */
  readonly elapsedMs: number;
  /** Custo COMMITTED da autoridade lido do ledger (reservado − voidado − excesso liberado por
   * settlement). Reflete settlements já feitos nesta sessão. `null` quando não há teto agregado. */
  readonly committedCost: RequirementMoneyV1 | null;
  /** Quantas provisões já foram TENTADAS nesta sessão. */
  readonly attemptsMade: number;
  /** Disposição da última falha (ou `none` na primeira volta / após sucesso parcial). */
  readonly halt: CloudSessionHaltSignalV1;
  /** Razão terminal para observabilidade quando `halt === 'terminal'`. */
  readonly terminalReason: string | null;
}

/** Próximo candidato ELEGÍVEL já escolhido pelo matcher (inventário − placements excluídos). */
export interface CloudSessionCandidateRefV1 {
  /** Chave de exclusão do placement — `providerId:gpuTypeId`. */
  readonly placementId: string;
  /** Custo estimado da lease para este candidato; `null` = preço indisponível. */
  readonly estimatedCost: RequirementMoneyV1 | null;
}

export type CloudSessionStopReasonV1 =
  | 'terminal_failure'
  | 'provider_unavailable'
  | 'session_budget_exhausted'
  | 'cost_estimate_unavailable'
  | 'currency_mismatch'
  | 'session_deadline_reached'
  | 'attempt_limit_reached'
  | 'no_more_candidates';

export type CloudSessionActionV1 =
  | { readonly action: 'provision'; readonly placementId: string; readonly estimatedCost: RequirementMoneyV1 | null }
  | { readonly action: 'stop'; readonly reason: CloudSessionStopReasonV1; readonly detail: string };

/**
 * Decide, PURA e determinística, a próxima ação da sessão. Ordem de precedência das barreiras (a
 * primeira que dispara vence) — desenhada para que governança REAL sempre preceda a rede
 * defensiva:
 *   1. última falha terminal        → stop `terminal_failure`;
 *   2. provider global fora         → stop `provider_unavailable` (não martelar);
 *   3. deadline da sessão vencido    → stop `session_deadline_reached`;
 *   4. sem candidato elegível        → stop `no_more_candidates`;
 *   5. teto de custo (fail-closed):
 *        - estimativa ausente        → stop `cost_estimate_unavailable`;
 *        - moeda divergente          → stop `currency_mismatch`;
 *        - committed + estimativa > teto → stop `session_budget_exhausted`;
 *   6. rede defensiva de tentativas  → stop `attempt_limit_reached`;
 *   7. caso contrário                → provision (placement do próximo candidato).
 *
 * O teto vem ANTES do contador defensivo de propósito: enquanto há budget e alternativa segura, a
 * sessão continua; o contador só barra loops patológicos que não deveriam ocorrer.
 */
export function planNextCloudSessionAction(input: {
  readonly envelope: CloudSessionEnvelopeV1;
  readonly progress: CloudSessionProgressV1;
  readonly nextCandidate: CloudSessionCandidateRefV1 | null;
}): CloudSessionActionV1 {
  const { envelope, progress, nextCandidate } = input;

  if (progress.halt === 'terminal') {
    return { action: 'stop', reason: 'terminal_failure', detail: progress.terminalReason ?? 'terminal provision failure' };
  }
  if (progress.halt === 'provider_unavailable') {
    return { action: 'stop', reason: 'provider_unavailable', detail: progress.terminalReason ?? 'provider globally unavailable' };
  }
  if (progress.elapsedMs >= envelope.maxSessionDurationMs) {
    return { action: 'stop', reason: 'session_deadline_reached', detail: `elapsed ${progress.elapsedMs}ms ≥ ${envelope.maxSessionDurationMs}ms` };
  }
  if (nextCandidate === null) {
    return { action: 'stop', reason: 'no_more_candidates', detail: 'nenhum candidato/placement elegível restante' };
  }

  if (envelope.maxTotalCost != null) {
    const ceiling = envelope.maxTotalCost;
    const estimate = nextCandidate.estimatedCost;
    if (estimate === null) {
      return { action: 'stop', reason: 'cost_estimate_unavailable', detail: `placement ${nextCandidate.placementId} sem estimativa de custo sob teto agregado` };
    }
    const committedAmount = progress.committedCost?.amount ?? 0;
    if (progress.committedCost != null && progress.committedCost.currency.toUpperCase() !== ceiling.currency.toUpperCase()) {
      return { action: 'stop', reason: 'currency_mismatch', detail: `committed ${progress.committedCost.currency} ≠ teto ${ceiling.currency}` };
    }
    if (estimate.currency.toUpperCase() !== ceiling.currency.toUpperCase()) {
      return { action: 'stop', reason: 'currency_mismatch', detail: `estimativa ${estimate.currency} ≠ teto ${ceiling.currency}` };
    }
    if (committedAmount + estimate.amount > ceiling.amount) {
      return {
        action: 'stop', reason: 'session_budget_exhausted',
        detail: `committed ${committedAmount} + estimativa ${estimate.amount} > teto ${ceiling.amount} ${ceiling.currency}`,
      };
    }
  }

  if (progress.attemptsMade >= envelope.maxProvisionAttempts) {
    return { action: 'stop', reason: 'attempt_limit_reached', detail: `tentativas ${progress.attemptsMade} ≥ rede defensiva ${envelope.maxProvisionAttempts}` };
  }

  return { action: 'provision', placementId: nextCandidate.placementId, estimatedCost: nextCandidate.estimatedCost };
}
