import type { Json } from '@anima/types';
import type { CreateWorkProposalCommand } from './commands';
import type { WorkCapability, WorkImpactLevel } from './types';

export interface ConstructionIntentV1 { readonly [key: string]: Json; readonly schema_version: 1; readonly mode: 'construction'; readonly request_kind: 'plan' | 'change' | 'investigate'; readonly confidence: 'high' }
export interface StructuredDecisionQuestion { readonly id: 'objective'; readonly question: string; readonly options: readonly { value: string; label: string; recommended?: boolean }[] }
export type WorkIntentInterpretation = { readonly kind: 'conversation' } | { readonly kind: 'clarification_required'; readonly question: StructuredDecisionQuestion } | { readonly kind: 'work_candidate'; readonly confidence: 'high'; readonly command: CreateWorkProposalCommand };

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');
const operationalVerb = /\b(?:planej(?:ar|e)|constru(?:ir|a)|implement(?:ar|e)|alter(?:ar|e)|corrig(?:ir|a)|investig(?:ar|ue)|cri(?:ar|e)|refator(?:ar|e))\b/i;
const explicitObject = /\b(?:anima|aplicativo|app|site|sistema|c[oó]digo|tela|fluxo|funcionalidade|recurso|bug|arquitetura|banco|api|chat)\b/i;
const lifeRecord = /\b(?:hoje|ontem|dormi|corri|treinei|estudei|trabalhei|senti|estou me sentindo)\b/i;
const capabilityFor = (message: string): WorkCapability => /\b(?:investig|bug|problema|diagn[oó]stic)\b/i.test(message) ? 'research' : /\b(?:arquitetura|banco|api|c[oó]digo|implement|refator|corrig)\b/i.test(message) ? 'programming' : 'planning';
const impactFor = (message: string): WorkImpactLevel => /\b(?:apagar|excluir|migra|produ[cç][aã]o|seguran[cç]a|arquitetura|banco)\b/i.test(message) ? 'structural' : /\b(?:alter|implement|constru|cri)\b/i.test(message) ? 'significant' : 'low';

export function interpretWorkRequest(message: string, sourceMessageId: string): WorkIntentInterpretation {
  const text = normalize(message);
  if (!text || /\?\s*$/.test(text) || lifeRecord.test(text)) return { kind: 'conversation' };
  if (/^(?:eu\s+)?(?:quero|gostaria|tenho vontade)\s+(?:de\s+)?(?:algo|melhorar|mudar|criar|fazer)\.?$/i.test(text)) return { kind: 'clarification_required', question: { id: 'objective', question: 'O que você quer construir ou alterar exatamente?', options: [{ value: 'plan', label: 'Planejar primeiro', recommended: true }, { value: 'change', label: 'Alterar algo existente' }, { value: 'investigate', label: 'Investigar um problema' }] } };
  if (!operationalVerb.test(text) || !explicitObject.test(text)) return { kind: 'conversation' };
  const requestKind: ConstructionIntentV1['request_kind'] = /\binvestig/i.test(text) ? 'investigate' : /\b(?:alter|corrig|refator|implement)\b/i.test(text) ? 'change' : 'plan';
  const intent: ConstructionIntentV1 = { schema_version: 1, mode: 'construction', request_kind: requestKind, confidence: 'high' };
  return { kind: 'work_candidate', confidence: 'high', command: { sourceMessageId, impactLevel: impactFor(text), capability: capabilityFor(text), intent, proposal: { schemaVersion: 1, data: { summary: text.length > 120 ? `${text.slice(0, 117)}…` : text, objective: text, includedScope: ['Entender o pedido e preparar a mudança delimitada'], excludedScope: ['Executar qualquer alteração antes de nova etapa autorizada'], expectedEffects: ['Produzir um plano de trabalho rastreável e versionado'], risks: ['O escopo pode precisar de correção antes da execução'] } } } };
}

export type WorkFocusResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'focused'; readonly itemId: string }
  | { readonly kind: 'confirmation_required'; readonly itemIds: readonly string[] };

export const resolveWorkFocus = (candidateIds: readonly string[], currentItemId?: string): WorkFocusResolution => {
  const unique = [...new Set(candidateIds)];
  if (currentItemId && unique.includes(currentItemId)) return { kind: 'focused', itemId: currentItemId };
  if (unique.length === 0) return { kind: 'none' };
  if (unique.length === 1) return { kind: 'focused', itemId: unique[0]! };
  return { kind: 'confirmation_required', itemIds: unique };
};
export const isWorkContinuation=(message:string):boolean=>/\b(?:continue|continuar|retome|retomar|ness[ae]|neste|nesse|tarefa|trabalho|proposta|resultado|ajuste|corrija|correção|isso|esse ponto)\b/i.test(message)&&!/\b(?:hoje|ontem|dormi|corri|treinei|estudei|me senti)\b/i.test(message);
