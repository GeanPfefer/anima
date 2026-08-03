import { presentWorkItem, type WorkEvent, type WorkItem, type WorkPresentation } from '@anima/core';

// UX-04 paridade mobile — helpers PUROS (sem Supabase), testáveis isoladamente.
// A intenção `work_history` e os estados retomáveis vivem em @anima/core e NÃO
// são duplicados aqui; este módulo só monta as projeções e decide a retomada.

export interface MobileHistoryEntry {
  readonly item: WorkItem;
  readonly events: readonly WorkEvent[];
}

/** Monta a lista de cartões reencontrados reusando a projeção compartilhada. */
export const buildHistoryPresentations = (entries: readonly MobileHistoryEntry[]): WorkPresentation[] =>
  entries.map(entry => presentWorkItem(entry.item, entry.events));

/**
 * A retomada executora só é pedida ao host quando a decisão respondida tem efeito
 * `resume` E o estado persistido resultante é `approved`. Encerramento
 * (`cancel`), qualquer outro efeito ou estado divergente NÃO aciona o host.
 */
export const shouldRequestHostResume = (
  effect: 'resume' | 'cancel' | undefined,
  resultingState: string,
): boolean => effect === 'resume' && resultingState === 'approved';
