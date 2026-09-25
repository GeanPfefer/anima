// ============================================================
// Preferência de compute POR UNIDADE — decisão humana distinta da authority paga.
//
// Três conceitos que não se confundem:
//   1. capacidade do runtime  — env de deploy (modelo OpenAI configurado, effort, timeout…);
//   2. preferência da unidade — ESTE contrato: o humano escolhe a estratégia para o item,
//      registrada como evento append-only `compute_preference_recorded`;
//   3. backend selecionado    — a decisão do Compute Router (`compute_routing_decided`).
//
// Preferência NÃO autoriza gasto. Com preferência `provider_api` e sem authority, a unidade
// ESPERA (`waiting_for_human_authorization`); o compute local nunca a substitui em silêncio.
// ============================================================

export type ComputePreferenceStrategyV1 = 'provider_api' | 'router_default';

export type ComputePreferenceV1 =
  | { readonly schemaVersion: 1; readonly strategy: 'provider_api'; readonly provider: 'openai'; readonly model: string }
  | { readonly schemaVersion: 1; readonly strategy: 'router_default' };

/** Mesma régua do RPC `record_compute_preference`. */
export const COMPUTE_PREFERENCE_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export const COMPUTE_PREFERENCE_EVENT_TYPE = 'compute_preference_recorded';

const recordOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Valida e normaliza uma preferência (formato persistido). Qualquer desvio ⇒ null. */
export function parseComputePreference(raw: unknown): ComputePreferenceV1 | null {
  const value = recordOf(raw);
  if (!value || value.schemaVersion !== 1) return null;
  const keys = Object.keys(value).length;
  if (value.strategy === 'router_default') return keys === 2 ? { schemaVersion: 1, strategy: 'router_default' } : null;
  if (value.strategy !== 'provider_api' || keys !== 4 || value.provider !== 'openai') return null;
  if (typeof value.model !== 'string' || !COMPUTE_PREFERENCE_MODEL_PATTERN.test(value.model)) return null;
  return { schemaVersion: 1, strategy: 'provider_api', provider: 'openai', model: value.model };
}

export interface ComputePreferenceEventV1 {
  readonly type: string;
  readonly payload: unknown;
  readonly occurredAt?: Date;
}

export interface RecordedComputePreferenceV1 {
  readonly preference: ComputePreferenceV1;
  readonly recordedAt: string | null;
}

/**
 * Preferência VIGENTE da unidade: a última `compute_preference_recorded` válida (eventos
 * em ordem ascendente). Um evento malformado não apaga a escolha anterior (é ignorado).
 */
export function projectComputePreference(events: readonly ComputePreferenceEventV1[]): RecordedComputePreferenceV1 | null {
  let current: RecordedComputePreferenceV1 | null = null;
  for (const event of events) {
    if (event.type !== COMPUTE_PREFERENCE_EVENT_TYPE) continue;
    const preference = parseComputePreference(recordOf(recordOf(event.payload)?.data)?.preference);
    if (preference) current = { preference, recordedAt: event.occurredAt?.toISOString() ?? null };
  }
  return current;
}

export type ComputePreferenceSourceV1 = 'work_item_preference' | 'legacy_contract';

/** O que o Router recebe como `preferred`, com a origem para auditoria. */
export interface EffectiveComputePreferenceV1 {
  readonly provider: 'openai';
  readonly model: string;
  readonly source: ComputePreferenceSourceV1;
}

/**
 * Preferência EFETIVA para o Router:
 *  - preferência explícita `provider_api` ⇒ autoritativa (modelo escolhido pelo humano);
 *  - preferência explícita `router_default` ⇒ nenhuma (Router padrão, local-first);
 *  - sem preferência ⇒ compatibilidade: contrato LEGADO com `coder_backend: openai` sem a
 *    marca `runtime_default` continua preferindo OpenAI no modelo do runtime. Um
 *    `coder_backend` carimbado pelo planner a partir do env é capacidade de deploy, não
 *    decisão da unidade ⇒ nenhuma preferência.
 */
export function resolveEffectiveComputePreference(input: {
  readonly recorded: ComputePreferenceV1 | null;
  readonly contract: { readonly coderBackend: string | null; readonly coderBackendSource: string | null };
  readonly runtimeOpenAIModel: string;
}): EffectiveComputePreferenceV1 | null {
  if (input.recorded) {
    return input.recorded.strategy === 'provider_api'
      ? { provider: 'openai', model: input.recorded.model, source: 'work_item_preference' }
      : null;
  }
  if (input.contract.coderBackend === 'openai' && input.contract.coderBackendSource !== 'runtime_default') {
    return { provider: 'openai', model: input.runtimeOpenAIModel, source: 'legacy_contract' };
  }
  return null;
}
