import { evaluatePaidComputeAuthorization } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OpenAIPaidCallInput } from './gpt-coder';
import {
  readActivePaidComputeAuthorization,
  reservePaidComputeBudget,
} from './paid-compute-authorization-store';

export const openAIProviderResourceClass = (model: string): string => `provider_api:${model}`;

/**
 * Gate financeiro do provider API. A primeira rodada reserva TODO o teto humano
 * do attempt, conservadoramente; rodadas seguintes revalidam a mesma autoridade
 * sem criar nova exposição. Não é estimativa de preço nem custo final.
 */
export function createOpenAIPaidCallAuthorizer(client: SupabaseClient<Database>) {
  const admittedAttempts = new Set<string>();
  return async (input: OpenAIPaidCallInput): Promise<void> => {
    const resourceClass = openAIProviderResourceClass(input.model);
    const now = new Date();
    const authorization = await readActivePaidComputeAuthorization(client, {
      providerId: input.providerId,
      nodeId: 'openai-api',
      resourceClass,
      workItemId: input.workItemId,
      now,
    });
    const ceiling = authorization?.maxCostEstimate ?? null;
    const decision = evaluatePaidComputeAuthorization({
      billingMode: 'paid', providerId: input.providerId, nodeId: 'openai-api',
      resourceClass, workItemId: input.workItemId, requestedDurationMs: input.maxDurationMs,
      estimatedCost: ceiling,
    }, authorization, now);
    if (!decision.authorized || !decision.requiresPayment) {
      throw new Error(`Compute pago OpenAI recusado: ${decision.reason}.`);
    }
    if (admittedAttempts.has(input.attemptId)) return;
    if (input.callIndex !== 1 || ceiling === null) throw new Error('Compute pago OpenAI sem reserva inicial válida.');

    const reservation = await reservePaidComputeBudget(client, {
      authorizationId: decision.authorizationRef,
      idempotencyKey: `openai-attempt:${input.attemptId}`,
      providerId: input.providerId,
      nodeId: 'openai-api',
      resourceClass,
      workItemId: input.workItemId,
      attemptId: input.attemptId,
      leaseId: `provider-api:${input.attemptId}`,
      estimate: ceiling,
    });
    if (!reservation.ok) throw new Error(`Reserva financeira OpenAI recusada: ${reservation.code}.`);
    // Replay significa que este attempt já abriu exposição em outra execução do
    // control plane. Falha fechada: não fazemos uma segunda chamada ao provider.
    if (reservation.action === 'replayed') throw new Error('Autorização OpenAI já consumida por este attempt.');
    admittedAttempts.add(input.attemptId);
  };
}
