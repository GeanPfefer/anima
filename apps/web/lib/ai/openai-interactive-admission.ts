import {
  OpenAIAdmissionDenied,
  type OpenAIAdmissionControl,
} from './openai-paid-transport';

// ============================================================
// Admissão financeira dos consumidores INTERATIVOS da OpenAI (chat e planner).
//
// Hoje NÃO existe autoridade paga interativa persistida no ledger — o domínio de
// chat/planner ainda não tem um envelope humano de gasto. Portanto esta admissão
// RECUSA sempre, o que faz os chamadores caírem no provider LOCAL (observável),
// nunca numa chamada paga silenciosa.
//
// É deliberadamente o ÚNICO ponto de plugagem para uma futura autoridade interativa
// (Compute Router V1): quando existir um envelope por-usuário/orçamento, ele entra
// aqui — específico ao domínio, jamais um wildcard global ligado à mera presença de
// `OPENAI_API_KEY`. Mantém a invariante: necessidade de compute ≠ autorização de gasto.
// ============================================================
export function createInteractiveOpenAIAdmission(): OpenAIAdmissionControl {
  return {
    async admit(intent) {
      throw new OpenAIAdmissionDenied('interactive_paid_authority_absent', intent.consumer);
    },
  };
}
