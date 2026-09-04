// ============================================================
// A ÚNICA BORDA FINANCEIRA da OpenAI paga em produção.
//
// Invariante que este módulo torna verdadeira POR CONSTRUÇÃO: nenhum caminho de
// produção alcança o provider OpenAI pago sem admissão financeira explícita.
//
//   OpenAI call intent → financial admission → authorized transport → fetch/provider
//
// Regras estruturais:
//  - Este é o ÚNICO lugar do código que conhece a URL do provider e lê a chave
//    (`OPENAI_API_KEY`). Nenhum consumidor (coder, chat, planner) toca em fetch da
//    OpenAI nem na credencial diretamente. Um teste-guarda (openai-single-edge.guard)
//    prova isso varrendo a árvore. Assim a admissão não é apenas convenção: um novo
//    consumidor que tente falar com a OpenAI PRECISA passar por aqui.
//  - `admit()` roda ANTES de qualquer I/O de rede. Uma admissão ausente/recusada
//    (throw `OpenAIAdmissionDenied`) ⇒ ZERO chamadas ao provider (fail-closed).
//  - Cada consumidor carrega seu próprio ENVELOPE/correlação no `OpenAICallIntent`
//    (o coder amarra work item/attempt/proposal version; chat/planner carregam o
//    usuário). Nenhum consumidor finge ser outro. Isto mantém a borda compatível com
//    o futuro Compute Router V1 (necessidade de compute ≠ autorização de gasto).
// ============================================================

/** Endpoint da Responses API. Só este módulo o conhece em produção. */
export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export type OpenAIConsumer = 'coder' | 'chat' | 'planner';

/**
 * Intenção tipada de UMA chamada paga à OpenAI. Discriminada por consumidor: cada
 * um traz a correlação que o seu domínio justifica — o coder amarra trabalho real
 * (work item/attempt/proposal version), enquanto chat/planner são interativos e
 * amarram apenas o usuário. Nunca um envelope global sem dono.
 */
export type OpenAICallIntent =
  | {
      readonly consumer: 'coder';
      readonly workItemId: string;
      readonly attemptId: string;
      readonly approvedProposalVersion: number;
      readonly model: string;
      readonly callIndex: number;
      readonly maxDurationMs: number;
    }
  | { readonly consumer: 'chat'; readonly userId: string; readonly model: string }
  | { readonly consumer: 'planner'; readonly userId: string; readonly model: string };

/** Prova auditável de que a chamada foi financeiramente admitida. */
export interface OpenAIAdmissionGrant {
  readonly consumer: OpenAIConsumer;
  readonly authorizationRef: string;
  readonly reservationId: string | null;
}

/**
 * Recusa de admissão financeira. NÃO é um erro de transporte: é o gate dizendo que
 * a chamada paga não pode acontecer. Consumidores interativos (chat/planner) tratam
 * isso como sinal para cair no provider LOCAL; o coder, cujo backend foi escolhido a
 * montante, propaga como falha do attempt. Nunca vira fallback pago silencioso.
 */
export class OpenAIAdmissionDenied extends Error {
  constructor(
    readonly reason: string,
    readonly consumer: OpenAIConsumer,
  ) {
    super(`Admissão de OpenAI paga recusada (${consumer}): ${reason}`);
    this.name = 'OpenAIAdmissionDenied';
  }
}

/**
 * O gate financeiro. Implementações decidem a admissão por consumidor/envelope:
 * o coder consulta o ledger de compute pago; chat/planner consultam a autoridade
 * interativa (hoje inexistente ⇒ recusa, disparando o fallback local). `admit`
 * RESOLVE com um grant quando a chamada paga pode prosseguir; REJEITA com
 * `OpenAIAdmissionDenied` quando não.
 */
export interface OpenAIAdmissionControl {
  admit(intent: OpenAICallIntent): Promise<OpenAIAdmissionGrant>;
}

/** Lê a credencial do provider. SÓ a borda faz isto. Vazia/ausente ⇒ null. */
export function readOpenAIApiKey(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const key = env.OPENAI_API_KEY;
  return typeof key === 'string' && key.trim().length > 0 ? key : null;
}

export interface AdmittedOpenAIResponsesInput {
  readonly admission: OpenAIAdmissionControl;
  readonly intent: OpenAICallIntent;
  /** Corpo da requisição (específico do consumidor: input/tools/structured output). */
  readonly body: unknown;
  readonly signal: AbortSignal;
  /** Injetável em teste. Em produção, o `fetch` global. */
  readonly fetchImpl?: typeof fetch;
  /** Injetável em teste. Em produção, `process.env`. */
  readonly env?: Record<string, string | undefined>;
  /** Chave explícita para teste determinístico. Produção lê do env aqui dentro. */
  readonly apiKey?: string;
}

/**
 * O ÚNICO transporte de produção para a OpenAI paga. `admit()` roda antes de
 * qualquer rede: se recusar (throw), a função propaga e NENHUM fetch acontece.
 * Só depois de admitida a chamada a chave é lida e o provider é contatado.
 * Devolve a `Response` crua e o grant — o consumidor faz o parsing do seu protocolo.
 */
export async function fetchAdmittedOpenAIResponses(
  input: AdmittedOpenAIResponsesInput,
): Promise<{ readonly response: Response; readonly grant: OpenAIAdmissionGrant }> {
  // Fail-closed: a admissão é a PRIMEIRA coisa. Um throw aqui impede o fetch.
  const grant = await input.admission.admit(input.intent);

  const apiKey = input.apiKey !== undefined ? input.apiKey : readOpenAIApiKey(input.env);
  if (!apiKey || apiKey.trim().length === 0) {
    throw new OpenAIAdmissionDenied('openai_key_missing', input.intent.consumer);
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    signal: input.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.body),
  });
  return { response, grant };
}
