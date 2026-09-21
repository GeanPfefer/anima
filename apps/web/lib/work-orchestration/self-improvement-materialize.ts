import {
  detectSelfDeficiencies,
  materializeSelfImprovementProposal,
  type SelfDeficiencyThresholds,
  type SelfImprovementMaterializationResult,
  type SelfImprovementMaterializerDeps,
  type WorkEvent,
} from '@anima/core';
import type { MaterializationAttempt } from '../resident-host/resident-host';

// ============================================================
// Orquestração de SELF-IMPROVEMENT quando a fila operacional esvazia (idle).
//
// Fecha o elo que faltava do Self-Development Continuous Loop V0: o detector de
// deficiência própria e o formulador de proposta JÁ existiam no core (puros,
// provados por doubles), mas o runtime autônomo (resident host) só materializava do
// backlog CANÔNICO escrito por humano. Aqui o host, ao ficar idle, também converte a
// deficiência própria mais forte em UM work_item `proposed` — sob a MESMA identidade
// do usuário, o MESMO kill-switch e a MESMA via `create_work_proposal`.
//
// Fronteira preservada: o desfecho MÁXIMO é `proposed`. A proposta de melhoria é
// SEMPRE `structural` ⇒ requer aprovação humana (nunca auto-aprovação). Este módulo
// NÃO aprova, NÃO autoriza, NÃO reserva compute, NÃO inicia attempt. Portos
// injetáveis para prova por doubles, sem rede nem banco.
// ============================================================

const errText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Mapeia o desfecho do materializer puro do core para o contrato `MaterializationAttempt`
 * do resident host — puro e determinístico. Sucesso ⇒ `human_required` com detalhe
 * explícito de que uma auto-modificação estrutural sempre passa pela fronteira humana.
 */
export function mapSelfImprovementResult(result: SelfImprovementMaterializationResult): MaterializationAttempt {
  if (result.ok) {
    return {
      materialized: true,
      detail: `self_deficiency:${result.deficiencyId}`,
      workItemId: result.workItemId,
      authorization: 'human_required',
      authorizationDetail: 'structural_self_improvement_requires_human_approval',
    };
  }
  return { materialized: false, detail: `self_improvement:${result.reason}` };
}

export interface SelfImprovementIdleDeps {
  /** Carrega o histórico canônico de eventos (reusa o loader protegido do incidente
   * 51929). Fail-closed: `ok:false` ⇒ não se deriva deficiência sobre estado não
   * confiável. */
  readonly loadEvents: () => Promise<
    { readonly ok: true; readonly events: readonly WorkEvent[] } | { readonly ok: false; readonly reason: string }
  >;
  readonly materializerDeps: SelfImprovementMaterializerDeps;
  readonly thresholds?: Partial<SelfDeficiencyThresholds>;
}

/**
 * Detecta deficiências próprias do histórico e materializa NO MÁXIMO UMA proposta de
 * melhoria em `proposed`. Fail-closed em cada passo; nunca lança (erros viram
 * `{materialized:false}`); idempotente pela cobertura de proveniência (replay não
 * duplica a proposta da mesma deficiência).
 */
export async function materializeSelfImprovementWhenIdle(
  deps: SelfImprovementIdleDeps,
): Promise<MaterializationAttempt> {
  let history: Awaited<ReturnType<SelfImprovementIdleDeps['loadEvents']>>;
  try {
    history = await deps.loadEvents();
  } catch (error) {
    return { materialized: false, detail: `self_improvement:history_threw:${errText(error)}` };
  }
  if (!history.ok) return { materialized: false, detail: `self_improvement:history_${history.reason}` };

  const candidates = detectSelfDeficiencies({
    events: history.events,
    ...(deps.thresholds ? { thresholds: deps.thresholds } : {}),
  });
  // Curto-circuito no caso idle comum (sem deficiência): evita a leitura de cobertura.
  if (candidates.length === 0) return { materialized: false, detail: 'self_improvement:no_deficiency' };

  let result: SelfImprovementMaterializationResult;
  try {
    result = await materializeSelfImprovementProposal({ candidates }, deps.materializerDeps);
  } catch (error) {
    return { materialized: false, detail: `self_improvement:materialize_threw:${errText(error)}` };
  }
  return mapSelfImprovementResult(result);
}

/**
 * Executa materializers em ORDEM até que UM materialize (ou até esgotar). Puro quanto à
 * ordenação; devolve o primeiro sucesso, senão o ÚLTIMO desfecho (para telemetria da
 * razão). Permite compor o backlog canônico (preferido) com o self-improvement
 * (fallback) sem que a engine residente saiba de qual fonte veio.
 */
export async function runMaterializersInOrder(
  materializers: readonly (() => Promise<MaterializationAttempt>)[],
): Promise<MaterializationAttempt> {
  let last: MaterializationAttempt = { materialized: false, detail: 'no_materializer_configured' };
  for (const run of materializers) {
    last = await run();
    if (last.materialized) return last;
  }
  return last;
}
