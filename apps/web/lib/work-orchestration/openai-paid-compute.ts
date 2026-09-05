import { evaluatePaidComputeAuthorization } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  OpenAIAdmissionDenied,
  type OpenAIAdmissionControl,
  type OpenAIAdmissionGrant,
  type OpenAICallIntent,
} from '@/lib/ai/openai-paid-transport';
import {
  readActivePaidComputeAuthorization,
  reservePaidComputeBudget,
} from './paid-compute-authorization-store';

export const openAIProviderResourceClass = (model: string): string => `provider_api:${model}`;

/**
 * Admissão financeira do PLANEJADOR OpenAI, ligada ao ledger de compute pago. É a
 * autoridade GOVERNADA que a admissão sempre-recusa (`createInteractiveOpenAIAdmission`)
 * deixa como ÚNICO ponto de plugagem. Só admite quando existe uma autorização HUMANA
 * ativa AMARRADA A ESTE work item (provider `openai`, node `openai-api`, classe
 * `provider_api:<modelo>`, teto de custo e validade), avaliada de forma PURA e
 * fail-closed (`evaluatePaidComputeAuthorization`). Sem autoridade ⇒ recusa
 * (`OpenAIAdmissionDenied`) ⇒ o orquestrador cai no planejador LOCAL, jamais numa
 * chamada paga silenciosa. Mantém a invariante: necessidade de compute ≠ autorização
 * de gasto — nunca um curinga ligado à mera presença de `OPENAI_API_KEY`.
 *
 * O escopo por work item é DELIBERADO e coerente com o endurecimento do ledger
 * (migration `..._paid_compute_provider_api_correlation`): uma autoridade `provider_api`
 * SEMPRE amarra um item concreto — nunca um wildcard que atravessaria itens/modelos.
 * O planejamento (re)planeja a proposta de um item que já existe; a mesma autoridade do
 * item cobre o replanejamento (planner) e o attempt (coder). Diferente do coder, o
 * planejador NÃO reserva exposição: não há attempt/execução ainda; a barreira é o
 * envelope humano ativo (teto + validade) e a passagem única e limitada do planejador
 * (timeout + limite de tool-calls). A credencial do provider NÃO é lida aqui — só a
 * borda única (`openai-paid-transport`) a conhece.
 */
export function createOpenAIPlannerAdmission(
  client: SupabaseClient<Database>,
  workItemId: string,
  requestedDurationMs = 5 * 60_000,
): OpenAIAdmissionControl {
  return {
    async admit(intent: OpenAICallIntent): Promise<OpenAIAdmissionGrant> {
      if (intent.consumer !== 'planner') {
        throw new OpenAIAdmissionDenied('planner_admission_wrong_consumer', intent.consumer);
      }
      const resourceClass = openAIProviderResourceClass(intent.model);
      const now = new Date();
      const authorization = await readActivePaidComputeAuthorization(client, {
        providerId: 'openai', nodeId: 'openai-api', resourceClass, workItemId, now,
      });
      const decision = evaluatePaidComputeAuthorization({
        billingMode: 'paid', providerId: 'openai', nodeId: 'openai-api',
        resourceClass, workItemId, requestedDurationMs,
        estimatedCost: authorization?.maxCostEstimate ?? null,
      }, authorization, now);
      if (!decision.authorized || !decision.requiresPayment) {
        throw new OpenAIAdmissionDenied(decision.authorized ? 'paid_not_required' : decision.reason, 'planner');
      }
      // Sem reserva por-item: ainda não há attempt/execução ao qual amarrar exposição.
      // A autoridade humana ativa do item (teto + validade) é a barreira; a passagem é única.
      return { consumer: 'planner', authorizationRef: decision.authorizationRef, reservationId: null };
    },
  };
}

/**
 * Admissão financeira do CODER OpenAI, ligada ao ledger de compute pago. É a
 * implementação da borda única (`OpenAIAdmissionControl`) para `consumer:'coder'`.
 *
 * A primeira rodada do attempt reserva conservadoramente TODO o teto humano;
 * rodadas seguintes revalidam a MESMA autoridade sem criar nova exposição; um
 * replay (attempt já com exposição aberta noutra execução) falha fechado, sem
 * segunda chamada ao provider. Não é estimativa de preço nem custo final.
 */
export function createOpenAICoderAdmission(
  client: SupabaseClient<Database>,
): OpenAIAdmissionControl {
  const admittedAttempts = new Map<string, OpenAIAdmissionGrant>();
  return {
    async admit(intent: OpenAICallIntent): Promise<OpenAIAdmissionGrant> {
      if (intent.consumer !== 'coder') {
        throw new OpenAIAdmissionDenied('coder_admission_wrong_consumer', intent.consumer);
      }
      const resourceClass = openAIProviderResourceClass(intent.model);
      const now = new Date();
      const authorization = await readActivePaidComputeAuthorization(client, {
        providerId: 'openai',
        nodeId: 'openai-api',
        resourceClass,
        workItemId: intent.workItemId,
        now,
      });
      const ceiling = authorization?.maxCostEstimate ?? null;
      const decision = evaluatePaidComputeAuthorization({
        billingMode: 'paid', providerId: 'openai', nodeId: 'openai-api',
        resourceClass, workItemId: intent.workItemId, requestedDurationMs: intent.maxDurationMs,
        estimatedCost: ceiling,
      }, authorization, now);
      if (!decision.authorized || !decision.requiresPayment) {
        throw new OpenAIAdmissionDenied(decision.authorized ? 'paid_not_required' : decision.reason, 'coder');
      }

      // Rodada seguinte do MESMO attempt: revalida a autoridade (acima) e reusa o
      // grant já materializado, sem nova reserva/exposição.
      const existing = admittedAttempts.get(intent.attemptId);
      if (existing) return existing;

      if (intent.callIndex !== 1 || ceiling === null) {
        throw new OpenAIAdmissionDenied('missing_initial_reservation', 'coder');
      }

      const reservation = await reservePaidComputeBudget(client, {
        authorizationId: decision.authorizationRef,
        idempotencyKey: `openai-attempt:${intent.attemptId}`,
        providerId: 'openai',
        nodeId: 'openai-api',
        resourceClass,
        workItemId: intent.workItemId,
        attemptId: intent.attemptId,
        leaseId: `provider-api:${intent.attemptId}`,
        estimate: ceiling,
      });
      if (!reservation.ok) {
        throw new OpenAIAdmissionDenied(reservation.code, 'coder');
      }
      // Replay significa que este attempt já abriu exposição em outra execução do
      // control plane. Falha fechada: não fazemos uma segunda chamada ao provider.
      if (reservation.action === 'replayed') {
        throw new OpenAIAdmissionDenied('authorization_already_consumed', 'coder');
      }
      const grant: OpenAIAdmissionGrant = {
        consumer: 'coder',
        authorizationRef: decision.authorizationRef,
        reservationId: reservation.reservationId,
      };
      admittedAttempts.set(intent.attemptId, grant);
      return grant;
    },
  };
}
