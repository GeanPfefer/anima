// ============================================================
// PROVIDER_API COST SETTLEMENT V1 (B1) — derivação PURA do custo de uma attempt paga via
// provider de API (tokens) e decisão de liquidação da reserva do ledger.
//
//   usage observada  ≠  preço conhecido  ≠  custo liquidado
//
// O ledger reserva CONSERVADORAMENTE todo o teto humano na 1ª chamada da attempt
// (`openai-attempt:<attemptId>`, lease `provider-api:<attemptId>`). Sem este módulo a reserva
// ficava para sempre `cost_unknown`. Aqui o custo só é derivado quando há, ao mesmo tempo:
//   1. usage REPORTADA pelo provider e COMPLETA (toda chamada despachada reportou usage);
//   2. um preço AUTORITATIVO e VERSIONADO (`ProviderPricingEntryV1`) vigente no instante da
//      reserva, para o MESMO provider/modelo/moeda da reserva;
//   3. uma reserva aberta (não anulada) cujo teto comporta o custo derivado.
// Faltando qualquer um ⇒ `cost_unknown` explícito (NUNCA zero, NUNCA o teto como custo).
//
// Aritmética DECIMAL EXATA (BigInt): tarifas por milhão com no máximo 9 casas; custo exato em
// femto-unidades (1e-15); liquidação arredondada PARA CIMA ao micro (1e-6) — nunca sub-reporta.
// Custo derivado acima da reserva NÃO é clampado em silêncio: vira `requires_human_reconciliation`.
//
// Sucesso ou falha da attempt é IRRELEVANTE: o provider cobra por tokens consumidos, não pelo
// desfecho. O que importa é a usage observada (inclusive a acumulada numa attempt que falhou).
//
// NÃO persiste, NÃO chama provider, NÃO inventa preço. Quem grava o evento append-only `settled`
// (fonte `usage_priced` + proveniência) é a RPC do ledger, que re-impõe S ≤ R e a idempotência.
// ============================================================

import type { ProviderPricingV1 } from '../compute-economics';
import type { ObservedCoderInput, ProviderReportedUsageV1 } from './host-observed-coder-evidence';

/** Entrada AUTORITATIVA de preço: `ProviderPricingV1` + identidade imutável de versão e janela de
 * vigência [effectiveFrom, effectiveUntil). A mesma entrada serve às métricas econômicas
 * (`calculateApiAttemptCost`) e ao settlement. */
export interface ProviderPricingEntryV1 extends ProviderPricingV1 {
  /** Identidade estável e imutável desta versão de preço (ex.: `openai/<modelo>@2026-10-01`). */
  readonly pricingVersion: string;
  readonly effectiveFrom: string;
  /** Exclusivo. Ausente ⇒ vigente em aberto. */
  readonly effectiveUntil?: string;
  // Dimensões de cobrança que a versão DECLARA. Declarada ⇒ o settlement exige o fato de usage
  // correspondente reportado pelo provider (ausente ⇒ `cost_unknown`, nunca presunção).
  /** Tarifa de input ESCRITO em cache por milhão. Ausente ⇒ cache writes observados (> 0) não
   * são precificáveis por esta versão. */
  readonly cacheWriteInputPerMillion?: number;
  /** Maior input de UMA requisição coberto por estas tarifas. Requisição acima ⇒ tarifa de long
   * context, que esta versão não precifica ⇒ `cost_unknown`. */
  readonly longContextInputThresholdTokens?: number;
  /** Tier de processamento cujo preço esta versão descreve, como ecoado pelo provider. */
  readonly serviceTier?: string;
}

export interface ProviderPricingCatalogV1 {
  readonly schemaVersion: 1;
  /** Referência do catálogo (arquivo/revisão) — entra na proveniência do settlement. */
  readonly catalogRef: string;
  readonly entries: readonly ProviderPricingEntryV1[];
}

export type ProviderPricingCatalogParseResult =
  | { readonly ok: true; readonly catalog: ProviderPricingCatalogV1 }
  | { readonly ok: false; readonly reason: string };

/** Máximo de casas decimais aceito em uma tarifa por milhão de tokens. */
export const PRICING_RATE_MAX_DECIMALS = 9;
/** Casas decimais do valor liquidado (arredondado PARA CIMA). */
export const SETTLEMENT_AMOUNT_DECIMALS = 6;

const FEMTO_DECIMALS = 15;
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isNonNegInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validInstant = (value: unknown): value is string => nonBlank(value) && !Number.isNaN(Date.parse(value));

/** Converte um decimal (número JSON ou string) em inteiro escalado por 10^decimals, SEM perda.
 * Recusa notação exponencial, negativos, não-finitos e mais casas do que `decimals`. */
export function toScaledDecimal(value: number | string, decimals: number): bigint | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) {
    // Zeros à direita além da escala são inofensivos (ex.: "1.50000000000").
    if (!/^0*$/.test(fraction.slice(decimals))) return null;
  }
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(match[1]!) * 10n ** BigInt(decimals) + BigInt(padded === '' ? '0' : padded);
}

/** Formata um inteiro escalado como decimal canônico (sem zeros à direita). */
export function formatScaledDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

const validRate = (value: unknown): boolean =>
  (typeof value === 'number' || typeof value === 'string') && toScaledDecimal(value, PRICING_RATE_MAX_DECIMALS) !== null;

function sameEntry(a: ProviderPricingEntryV1, b: ProviderPricingEntryV1): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Valida um catálogo de preços. FAIL-CLOSED no catálogo INTEIRO: qualquer entrada inválida,
 * janela invertida ou `pricingVersion` duplicada com conteúdo divergente rejeita tudo — um
 * catálogo parcialmente confiável não é autoritativo.
 */
export function parseProviderPricingCatalog(value: unknown): ProviderPricingCatalogParseResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'catalog_not_object' };
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== 1) return { ok: false, reason: 'catalog_schema_version' };
  if (!nonBlank(root.catalogRef)) return { ok: false, reason: 'catalog_ref_missing' };
  if (!Array.isArray(root.entries)) return { ok: false, reason: 'catalog_entries_missing' };
  const entries: ProviderPricingEntryV1[] = [];
  for (const [index, raw] of root.entries.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: `entry_${index}_not_object` };
    const e = raw as Record<string, unknown>;
    if (e.schemaVersion !== 1) return { ok: false, reason: `entry_${index}_schema_version` };
    if (![e.pricingVersion, e.provider, e.model, e.currency, e.sourceRef].every(nonBlank)) {
      return { ok: false, reason: `entry_${index}_identity_incomplete` };
    }
    if (!validRate(e.inputPerMillion) || !validRate(e.outputPerMillion)
      || (e.cachedInputPerMillion !== undefined && !validRate(e.cachedInputPerMillion))) {
      return { ok: false, reason: `entry_${index}_rate_invalid` };
    }
    if (e.cacheWriteInputPerMillion !== undefined && !validRate(e.cacheWriteInputPerMillion)) {
      return { ok: false, reason: `entry_${index}_rate_invalid` };
    }
    if (e.longContextInputThresholdTokens !== undefined
      && !(isNonNegInt(e.longContextInputThresholdTokens) && e.longContextInputThresholdTokens > 0)) {
      return { ok: false, reason: `entry_${index}_long_context_threshold_invalid` };
    }
    if (e.serviceTier !== undefined && !nonBlank(e.serviceTier)) return { ok: false, reason: `entry_${index}_service_tier_invalid` };
    if (!validInstant(e.effectiveFrom)) return { ok: false, reason: `entry_${index}_effective_from_invalid` };
    if (e.effectiveUntil !== undefined
      && (!validInstant(e.effectiveUntil) || Date.parse(e.effectiveUntil) <= Date.parse(e.effectiveFrom))) {
      return { ok: false, reason: `entry_${index}_effective_window_invalid` };
    }
    const entry = raw as ProviderPricingEntryV1;
    const duplicate = entries.find(existing => existing.pricingVersion === entry.pricingVersion);
    if (duplicate && !sameEntry(duplicate, entry)) return { ok: false, reason: `entry_${index}_version_conflict` };
    if (!duplicate) entries.push(entry);
  }
  return { ok: true, catalog: { schemaVersion: 1, catalogRef: root.catalogRef, entries } };
}

export type PricingResolution =
  | { readonly ok: true; readonly entry: ProviderPricingEntryV1 }
  | { readonly ok: false; readonly reason: 'pricing_missing' | 'pricing_ambiguous' };

/** Seleciona a ÚNICA versão de preço vigente para provider/modelo no instante `at`.
 * Nenhuma ⇒ `pricing_missing`; mais de uma (janelas sobrepostas) ⇒ `pricing_ambiguous`. */
export function resolveProviderPricing(
  catalog: ProviderPricingCatalogV1,
  query: { readonly provider: string; readonly model: string; readonly at: string },
): PricingResolution {
  const at = Date.parse(query.at);
  if (Number.isNaN(at)) return { ok: false, reason: 'pricing_missing' };
  const matches = catalog.entries.filter(entry => entry.provider === query.provider && entry.model === query.model
    && Date.parse(entry.effectiveFrom) <= at
    && (entry.effectiveUntil === undefined || at < Date.parse(entry.effectiveUntil)));
  if (matches.length === 0) return { ok: false, reason: 'pricing_missing' };
  if (matches.length > 1) return { ok: false, reason: 'pricing_ambiguous' };
  return { ok: true, entry: matches[0]! };
}

// ------------------------------------------------------------
// Usage da attempt (agregada das observações do coder, inclusive de chamadas que falharam)
// ------------------------------------------------------------

export interface ProviderApiAttemptUsageV1 {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** Chamadas despachadas cujo response trouxe usage. */
  readonly reportedCallCount: number;
  // Fatos de precificação — presentes só quando TODA observação os reportou (senão: desconhecidos).
  readonly cacheWriteInputTokens?: number;
  readonly maxCallInputTokens?: number;
  readonly serviceTiers?: readonly string[];
  readonly providerModels?: readonly string[];
}

export type ProviderApiUsageAggregation =
  | { readonly status: 'complete'; readonly usage: ProviderApiAttemptUsageV1 }
  | { readonly status: 'absent' }
  | { readonly status: 'incomplete' }
  | { readonly status: 'inconsistent' };

/**
 * Agrega a usage reportada pelo provider em TODAS as observações do coder da attempt (sucesso,
 * falha ou cancelamento). Completa só quando cada observação com chamadas despachadas declara
 * cobertura (`reportedCallCount`/`unreportedCallCount`) e nenhuma chamada despachada ficou sem
 * usage. Observação legada sem cobertura ⇒ `incomplete` (não se presume completude).
 */
export function aggregateProviderApiAttemptUsage(observations: readonly Pick<ObservedCoderInput, 'providerUsage' | 'providerCallCount'>[]): ProviderApiUsageAggregation {
  const usages: ProviderReportedUsageV1[] = [];
  let incomplete = false;
  for (const observation of observations) {
    const usage = observation.providerUsage;
    if (!usage) {
      // Chamadas contadas mas nenhuma usage: pode ter havido consumo sem observação.
      if ((observation.providerCallCount ?? 0) > 0) incomplete = true;
      continue;
    }
    if (usage.schemaVersion !== 1
      || ![usage.inputTokens, usage.outputTokens, usage.totalTokens, usage.cachedInputTokens ?? 0].every(isNonNegInt)
      || usage.totalTokens !== usage.inputTokens + usage.outputTokens
      || (usage.cacheWriteInputTokens !== undefined && !isNonNegInt(usage.cacheWriteInputTokens))
      || (usage.cachedInputTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0) > usage.inputTokens
      || (usage.maxCallInputTokens !== undefined && (!isNonNegInt(usage.maxCallInputTokens) || usage.maxCallInputTokens > usage.inputTokens))) {
      return { status: 'inconsistent' };
    }
    if (!isNonNegInt(usage.reportedCallCount) || !isNonNegInt(usage.unreportedCallCount)
      || usage.reportedCallCount === 0 || usage.unreportedCallCount > 0) {
      incomplete = true;
    }
    usages.push(usage);
  }
  if (usages.length === 0) return incomplete ? { status: 'incomplete' } : { status: 'absent' };
  if (incomplete) return { status: 'incomplete' };
  const everyHas = (key: keyof ProviderReportedUsageV1): boolean => usages.every(u => u[key] !== undefined);
  const distinct = (key: 'serviceTiers' | 'providerModels'): readonly string[] => [...new Set(usages.flatMap(u => u[key] ?? []))].sort();
  return {
    status: 'complete',
    usage: {
      inputTokens: usages.reduce((sum, u) => sum + u.inputTokens, 0),
      cachedInputTokens: usages.reduce((sum, u) => sum + (u.cachedInputTokens ?? 0), 0),
      outputTokens: usages.reduce((sum, u) => sum + u.outputTokens, 0),
      totalTokens: usages.reduce((sum, u) => sum + u.totalTokens, 0),
      reportedCallCount: usages.reduce((sum, u) => sum + (u.reportedCallCount ?? 0), 0),
      ...(everyHas('cacheWriteInputTokens') ? { cacheWriteInputTokens: usages.reduce((sum, u) => sum + (u.cacheWriteInputTokens ?? 0), 0) } : {}),
      ...(everyHas('maxCallInputTokens') ? { maxCallInputTokens: Math.max(...usages.map(u => u.maxCallInputTokens ?? 0)) } : {}),
      ...(everyHas('serviceTiers') ? { serviceTiers: distinct('serviceTiers') } : {}),
      ...(everyHas('providerModels') ? { providerModels: distinct('providerModels') } : {}),
    },
  };
}

// ------------------------------------------------------------
// Decisão de settlement
// ------------------------------------------------------------

/** Fonte de custo do ledger para custo derivado de usage × preço versionado. Distinta de
 * `estimated` (preço/h × tempo de node) e de `provider_confirmed` (fatura do provider). */
export const USAGE_PRICED_COST_SOURCE = 'usage_priced' as const;

/** Estado da reserva no ledger, como lido do store. */
export interface ProviderApiReservationStateV1 {
  readonly reservationId: string;
  readonly providerId: string;
  readonly resourceClass: string | null;
  readonly attemptId: string | null;
  readonly currency: string;
  /** Reserva R (numeric do ledger). */
  readonly amount: number | string;
  readonly createdAt: string;
  readonly voided: boolean;
  /** Evento `settled` existente, quando houver. O ledger grava o EXCESSO liberado (R − S); o custo
   * liquidado S é derivado aqui em decimal exato (nunca por subtração em ponto flutuante). */
  readonly settlement: null | {
    readonly costSource: string | null;
    readonly releasedExcess: number | string;
    readonly pricingVersion: string | null;
  };
}

/** Proveniência persistida junto do evento `settled` (`usage_priced`). Json-compatível. */
export interface ProviderApiSettlementProvenanceV1 {
  readonly schemaVersion: 1;
  readonly method: typeof USAGE_PRICED_COST_SOURCE;
  readonly attemptId: string;
  readonly provider: string;
  readonly model: string;
  readonly catalogRef: string;
  readonly pricingVersion: string;
  readonly pricingSourceRef: string;
  readonly pricingEffectiveFrom: string;
  readonly currency: string;
  readonly rates: { readonly inputPerMillion: string; readonly cachedInputPerMillion: string; readonly outputPerMillion: string; readonly cacheWriteInputPerMillion?: string };
  /** Dimensões declaradas pela versão de preço e provadas pela usage (quando declaradas). */
  readonly serviceTier?: string;
  readonly longContextInputThresholdTokens?: number;
  readonly usage: ProviderApiAttemptUsageV1;
  /** Custo EXATO antes do arredondamento (decimal canônico). */
  readonly exactCost: string;
  readonly rounding: 'ceil_to_1e-6_capped_at_reservation';
}

export type ProviderApiCostUnknownReason =
  | 'usage_absent'
  | 'usage_incomplete'
  | 'usage_inconsistent'
  | 'pricing_catalog_absent'
  | 'pricing_missing'
  | 'pricing_ambiguous'
  | 'pricing_invalid'
  | 'provider_mismatch'
  | 'model_mismatch'
  | 'currency_mismatch'
  | 'reservation_invalid'
  /** A versão declara uma dimensão (tier, long context, cache write) cujo fato o provider não reportou. */
  | 'usage_pricing_facts_missing'
  | 'service_tier_mismatch'
  /** Alguma requisição excedeu o limiar de long context da versão (tarifa não precificada). */
  | 'long_context_unpriced'
  /** Usage tem categoria cobrável (cache writes) sem tarifa na versão. */
  | 'pricing_category_missing';

export type ProviderApiSettlementDecisionV1 =
  /** Liquidar: gravar S (decimal canônico) com fonte `usage_priced` e a proveniência. */
  | { readonly kind: 'settle'; readonly reservationId: string; readonly currency: string; readonly settledAmount: string; readonly provenance: ProviderApiSettlementProvenanceV1 }
  /** Reserva segue ABERTA: sem evidência suficiente. Nunca zero, nunca o teto como custo. */
  | { readonly kind: 'cost_unknown'; readonly reservationId: string; readonly reason: ProviderApiCostUnknownReason }
  /** Custo derivado excede a reserva: NÃO clampa em silêncio; reserva segue aberta p/ humano. */
  | { readonly kind: 'requires_human_reconciliation'; readonly reservationId: string; readonly reason: 'derived_cost_exceeds_reservation'; readonly derivedCost: string; readonly reserved: string; readonly currency: string }
  /** Replay: já liquidada com a MESMA versão/valor ⇒ no-op idempotente. */
  | { readonly kind: 'already_settled'; readonly reservationId: string; readonly settledAmount: string }
  /** Já liquidada com fonte/versão/valor DIVERGENTE ⇒ jamais liquida duas vezes. */
  | { readonly kind: 'settlement_conflict'; readonly reservationId: string; readonly existing: { readonly costSource: string | null; readonly settledAmount: string; readonly pricingVersion: string | null }; readonly proposed: { readonly settledAmount: string; readonly pricingVersion: string } }
  /** Reserva anulada (provider provadamente não chamado): nada a liquidar. */
  | { readonly kind: 'not_applicable'; readonly reservationId: string; readonly reason: 'reservation_voided' };

export interface DeriveProviderApiSettlementInput {
  readonly attemptId: string;
  readonly provider: string;
  readonly model: string;
  readonly reservation: ProviderApiReservationStateV1;
  readonly usage: ProviderApiUsageAggregation;
  readonly catalog: ProviderPricingCatalogV1 | null;
}

const providerApiResourceClass = (model: string): string => `provider_api:${model}`;

/**
 * Decide, de forma PURA e determinística, o que fazer com a reserva de uma attempt `provider_api`.
 * Ordem: reserva anulada → evidência (usage, preço) → coerência provider/modelo/moeda → custo exato
 * → teto da reserva → estado de settlement já existente (replay/conflito) → liquidar.
 */
export function deriveProviderApiSettlement(input: DeriveProviderApiSettlementInput): ProviderApiSettlementDecisionV1 {
  const { reservation } = input;
  const reservationId = reservation.reservationId;
  const unknown = (reason: ProviderApiCostUnknownReason): ProviderApiSettlementDecisionV1 => ({ kind: 'cost_unknown', reservationId, reason });

  if (reservation.voided) return { kind: 'not_applicable', reservationId, reason: 'reservation_voided' };
  const reservedFemto = toScaledDecimal(reservation.amount, FEMTO_DECIMALS);
  if (reservedFemto === null || reservedFemto <= 0n || !nonBlank(reservation.currency) || !validInstant(reservation.createdAt)
    || (reservation.attemptId !== null && reservation.attemptId !== input.attemptId)) {
    return unknown('reservation_invalid');
  }
  if (reservation.providerId !== input.provider) return unknown('provider_mismatch');
  if (reservation.resourceClass !== providerApiResourceClass(input.model)) return unknown('model_mismatch');

  if (input.usage.status === 'absent') return unknown('usage_absent');
  if (input.usage.status === 'incomplete') return unknown('usage_incomplete');
  if (input.usage.status === 'inconsistent') return unknown('usage_inconsistent');
  const usage = input.usage.usage;

  if (!input.catalog) return unknown('pricing_catalog_absent');
  // Preço vigente no instante em que a exposição foi aberta (início do gasto da attempt).
  const resolved = resolveProviderPricing(input.catalog, { provider: input.provider, model: input.model, at: reservation.createdAt });
  if (!resolved.ok) return unknown(resolved.reason);
  const pricing = resolved.entry;
  if (pricing.currency.trim().toUpperCase() !== reservation.currency.trim().toUpperCase()) return unknown('currency_mismatch');

  // Modelo ecoado pelo provider, quando reportado, precisa ser EXATAMENTE o precificado (sem
  // equivalência implícita entre alias e snapshot).
  if (usage.providerModels && usage.providerModels.some(model => model !== input.model)) return unknown('model_mismatch');
  if (pricing.serviceTier !== undefined) {
    if (!usage.serviceTiers || usage.serviceTiers.length === 0) return unknown('usage_pricing_facts_missing');
    if (usage.serviceTiers.some(tier => tier !== pricing.serviceTier)) return unknown('service_tier_mismatch');
  }
  if (pricing.longContextInputThresholdTokens !== undefined) {
    if (usage.maxCallInputTokens === undefined) return unknown('usage_pricing_facts_missing');
    if (usage.maxCallInputTokens > pricing.longContextInputThresholdTokens) return unknown('long_context_unpriced');
  }
  if (pricing.cacheWriteInputPerMillion !== undefined && usage.cacheWriteInputTokens === undefined) return unknown('usage_pricing_facts_missing');
  const cacheWriteTokens = usage.cacheWriteInputTokens ?? 0;
  if (cacheWriteTokens > 0 && pricing.cacheWriteInputPerMillion === undefined) return unknown('pricing_category_missing');

  const inputRate = toScaledDecimal(pricing.inputPerMillion, PRICING_RATE_MAX_DECIMALS);
  const outputRate = toScaledDecimal(pricing.outputPerMillion, PRICING_RATE_MAX_DECIMALS);
  const cachedRate = toScaledDecimal(pricing.cachedInputPerMillion ?? pricing.inputPerMillion, PRICING_RATE_MAX_DECIMALS);
  const cacheWriteRate = pricing.cacheWriteInputPerMillion === undefined ? 0n : toScaledDecimal(pricing.cacheWriteInputPerMillion, PRICING_RATE_MAX_DECIMALS);
  if (inputRate === null || outputRate === null || cachedRate === null || cacheWriteRate === null) return unknown('pricing_invalid');

  // custo(USD) = tokens × tarifa/1e6; tarifa = r9/1e9 ⇒ custo em femto-USD (1e-15) = tokens × r9. EXATO.
  // input = não-cacheado + lido do cache + escrito em cache (partição reportada pelo provider).
  const uncached = BigInt(usage.inputTokens - usage.cachedInputTokens - cacheWriteTokens);
  const exactFemto = uncached * inputRate + BigInt(usage.cachedInputTokens) * cachedRate
    + BigInt(cacheWriteTokens) * cacheWriteRate + BigInt(usage.outputTokens) * outputRate;
  if (exactFemto > reservedFemto) {
    return {
      kind: 'requires_human_reconciliation', reservationId, reason: 'derived_cost_exceeds_reservation',
      derivedCost: formatScaledDecimal(exactFemto, FEMTO_DECIMALS), reserved: formatScaledDecimal(reservedFemto, FEMTO_DECIMALS),
      currency: reservation.currency,
    };
  }
  // Arredonda PARA CIMA ao micro; se o arredondamento cruzar R (custo exato ≤ R), usa R.
  const microUnit = 10n ** BigInt(FEMTO_DECIMALS - SETTLEMENT_AMOUNT_DECIMALS);
  const ceiledFemto = ((exactFemto + microUnit - 1n) / microUnit) * microUnit;
  const settledFemto = ceiledFemto > reservedFemto ? reservedFemto : ceiledFemto;
  const settledAmount = formatScaledDecimal(settledFemto, FEMTO_DECIMALS);

  if (reservation.settlement) {
    const releasedFemto = toScaledDecimal(reservation.settlement.releasedExcess, FEMTO_DECIMALS);
    const existingFemto = releasedFemto === null ? null : reservedFemto - releasedFemto;
    const existingAmount = existingFemto === null ? `R-${String(reservation.settlement.releasedExcess)}` : formatScaledDecimal(existingFemto, FEMTO_DECIMALS);
    if (reservation.settlement.costSource === USAGE_PRICED_COST_SOURCE
      && reservation.settlement.pricingVersion === pricing.pricingVersion
      && existingFemto === settledFemto) {
      return { kind: 'already_settled', reservationId, settledAmount: existingAmount };
    }
    return {
      kind: 'settlement_conflict', reservationId,
      existing: { costSource: reservation.settlement.costSource, settledAmount: existingAmount, pricingVersion: reservation.settlement.pricingVersion },
      proposed: { settledAmount, pricingVersion: pricing.pricingVersion },
    };
  }

  const rate = (value: bigint): string => formatScaledDecimal(value, PRICING_RATE_MAX_DECIMALS);
  return {
    kind: 'settle', reservationId, currency: reservation.currency.trim().toUpperCase(), settledAmount,
    provenance: {
      schemaVersion: 1, method: USAGE_PRICED_COST_SOURCE, attemptId: input.attemptId,
      provider: input.provider, model: input.model, catalogRef: input.catalog.catalogRef,
      pricingVersion: pricing.pricingVersion, pricingSourceRef: pricing.sourceRef, pricingEffectiveFrom: pricing.effectiveFrom,
      currency: pricing.currency.trim().toUpperCase(),
      rates: {
        inputPerMillion: rate(inputRate), cachedInputPerMillion: rate(cachedRate), outputPerMillion: rate(outputRate),
        ...(pricing.cacheWriteInputPerMillion !== undefined ? { cacheWriteInputPerMillion: rate(cacheWriteRate) } : {}),
      },
      ...(pricing.serviceTier !== undefined ? { serviceTier: pricing.serviceTier } : {}),
      ...(pricing.longContextInputThresholdTokens !== undefined ? { longContextInputThresholdTokens: pricing.longContextInputThresholdTokens } : {}),
      usage, exactCost: formatScaledDecimal(exactFemto, FEMTO_DECIMALS),
      rounding: 'ceil_to_1e-6_capped_at_reservation',
    },
  };
}
