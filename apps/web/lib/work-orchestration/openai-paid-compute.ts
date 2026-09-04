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
