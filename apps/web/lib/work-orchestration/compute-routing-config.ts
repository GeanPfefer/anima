import {
  resolveOpenAICoderContext,
  resolveOpenAICoderModel,
  resolveOpenAICoderOutputTokens,
  resolveOpenAICoderReasoningEffort,
  resolveOpenAICoderTimeoutMs,
  type OpenAICoderReasoningEffort,
} from './gpt-coder';
import { openAIProviderResourceClass } from './openai-paid-compute';

/**
 * Configuração EFETIVA de compute que o operador deu ao processo (Resident Host / rota),
 * resolvida pelas MESMAS funções que o Router e o coder OpenAI usam na volta. Serve para
 * observabilidade no arranque e para falhar cedo: um valor inválido aparece aqui, não na
 * primeira volta paga. Nunca expõe a credencial — só se ela está presente.
 *
 * O operador escolhe a estratégia e os limites (Router ligado, modelo, esforço, timeout,
 * saída); o Router escolhe por contrato; o compute pago continua exigindo authority
 * válida por work item — nada aqui concede ou presume autoridade.
 */
export type ComputeRoutingConfigV1 =
  | {
      readonly ok: true;
      readonly routerEnabled: boolean;
      readonly openAICoder: {
        readonly credentialPresent: boolean;
        readonly model: string;
        readonly resourceClass: string;
        readonly reasoningEffort: OpenAICoderReasoningEffort | null;
        readonly timeoutMs: number;
        readonly outputTokens: number;
        readonly operationalContextCap: number;
      };
    }
  | { readonly ok: false; readonly routerEnabled: boolean; readonly error: string };

export function describeComputeRoutingConfig(
  env: Record<string, string | undefined> = process.env,
): ComputeRoutingConfigV1 {
  const routerEnabled = env.ANIMA_COMPUTE_ROUTER_V1_ENABLED === '1';
  try {
    const model = resolveOpenAICoderModel(env);
    return {
      ok: true,
      routerEnabled,
      openAICoder: {
        credentialPresent: typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY.trim().length > 0,
        model,
        resourceClass: openAIProviderResourceClass(model),
        reasoningEffort: resolveOpenAICoderReasoningEffort(env),
        timeoutMs: resolveOpenAICoderTimeoutMs(env),
        outputTokens: resolveOpenAICoderOutputTokens(env),
        operationalContextCap: resolveOpenAICoderContext(model, env).operationalCap,
      },
    };
  } catch (error) {
    return { ok: false, routerEnabled, error: error instanceof Error ? error.message : String(error) };
  }
}
