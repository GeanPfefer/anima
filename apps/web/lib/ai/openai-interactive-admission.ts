import {
  OpenAIAdmissionDenied,
  type OpenAIAdmissionControl,
} from './openai-paid-transport';

// ============================================================
// Admissão financeira dos consumidores INTERATIVOS da OpenAI (chat e planner).
//
// A seleção explícita de GPT no request do compositor é a autoridade interativa
// estreita para chat/planner. Ela não vale para coder, work item, compute autônomo
// ou qualquer outro efeito e nunca autoriza troca de provider.
//
// É deliberadamente o ÚNICO ponto de plugagem para uma futura autoridade interativa
// (Compute Router V1): quando existir um envelope por-usuário/orçamento, ele entra
// aqui — específico ao domínio, jamais um wildcard global ligado à mera presença de
// `OPENAI_API_KEY`. Mantém a invariante: necessidade de compute ≠ autorização de gasto.
// ============================================================
export function createInteractiveOpenAIAdmission(): OpenAIAdmissionControl {
  return {
    async admit(intent) {
      if ((intent.consumer !== 'chat' && intent.consumer !== 'planner') || !intent.userId || intent.userId === 'unknown') {
        throw new OpenAIAdmissionDenied('interactive_provider_selection_absent', intent.consumer);
      }
      return {
        consumer: intent.consumer,
        authorizationRef: `interactive-provider-selection:${intent.consumer}:${intent.userId}`,
        reservationId: null,
      };
    },
  };
}
