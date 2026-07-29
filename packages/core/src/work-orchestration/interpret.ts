import type { Json } from '@anima/types';
import type { CreateWorkProposalCommand } from './commands';
import type { WorkCapability, WorkImpactLevel } from './types';

export interface ConstructionIntentV1 { readonly [key: string]: Json; readonly schema_version: 1; readonly mode: 'construction'; readonly request_kind: 'plan' | 'change' | 'investigate'; readonly confidence: 'high' }
export interface StructuredDecisionQuestion { readonly id: 'objective'; readonly question: string; readonly options: readonly { value: string; label: string; recommended?: boolean }[] }
export type WorkIntentInterpretation = { readonly kind: 'conversation' } | { readonly kind: 'clarification_required'; readonly question: StructuredDecisionQuestion } | { readonly kind: 'work_candidate'; readonly confidence: 'high'; readonly command: CreateWorkProposalCommand };

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');
// Verbos operacionais (imperativo/infinitivo). Ampliado para cobrir pedidos de
// análise, síntese e organização de trabalho — não só construção de código. Os
// radicais mantêm terminação explícita para não capturar palavras próximas
// (ex.: `cri(?:ar|e)` evita "criança").
const operationalVerb = /\b(?:planej(?:ar|e)|constru(?:ir|a)|implement(?:ar|e)|alter(?:ar|e)|corrig(?:ir|a)|investig(?:ar|ue)|cri(?:ar|e)|refator(?:ar|e)|an[aá]lis(?:ar|e)|prepar(?:ar|e)|organiz(?:ar|e)|revis(?:ar|e)|document(?:ar|e)|redij(?:a|o)|escrev(?:er|a)|elabor(?:ar|e)|sintetiz(?:ar|e)|compil(?:ar|e)|resum(?:ir|a)|mape(?:ar|ie)|avali(?:ar|e)|atualiz(?:ar|e)|esbo[cç](?:ar|e)|levant(?:ar|e))\b/i;
// Objetos de trabalho: artefatos de software E de projeto/documento.
const explicitObject = /\b(?:anima|aplicativo|app|site|sistema|c[oó]digo|tela|fluxo|funcionalidade|recurso|bug|arquitetura|banco|api|chat|projeto|plano|planos|documento|documentos|arquivo|arquivos|relat[oó]rio|resumo|texto|reposit[oó]rio|roadmap|backlog|prd|especifica[cç][aã]o|migration|migra[cç][aã]o|teste|testes|marco|marcos|proposta)\b/i;
// Sinal forte de intenção de trabalho: frases que pedem uma proposta/estruturação
// segura. Determinístico e específico — captura o pedido genuíno mesmo quando o
// par verbo+objeto não bate, sem transformar conversa comum em trabalho.
const workIntentPhrase = /\b(?:prepar\w*\s+(?:um[a]?\s+)?proposta|apresent\w*\s+(?:a\s+)?proposta|estrutur\w*\s+(?:esse|este|o)\s+trabalho|organiz\w*\s+(?:esse|este|o)\s+trabalho|proposta\s+antes\s+de\s+come[cç]ar|trabalho\s+de\s+forma\s+segura)\b/i;
const lifeRecord = /\b(?:hoje|ontem|dormi|corri|treinei|estudei|trabalhei|senti|estou me sentindo)\b/i;
// Radicais sem fronteira final: "analise", "resumo" e "documente" têm sufixo,
// então `\b` no fim impediria o match. A capacidade é metadado best-effort.
const capabilityFor = (message: string): WorkCapability => /\b(?:investig|an[aá]lis|pesquis|resum|document|revis|diagn[oó]stic|bug|problem)/i.test(message) ? 'research' : /\b(?:arquitetura|banco|api|c[oó]digo|implement|refator|corrig)/i.test(message) ? 'programming' : 'planning';
const impactFor = (message: string): WorkImpactLevel => /\b(?:apagar|excluir|migra|produ[cç][aã]o|seguran[cç]a|arquitetura|banco)\b/i.test(message) ? 'structural' : /\b(?:alter|implement|constru|cri)\b/i.test(message) ? 'significant' : 'low';

export function interpretWorkRequest(message: string, sourceMessageId: string): WorkIntentInterpretation {
  const text = normalize(message);
  if (!text || /\?\s*$/.test(text) || lifeRecord.test(text)) return { kind: 'conversation' };
  if (/^(?:eu\s+)?(?:quero|gostaria|tenho vontade)\s+(?:de\s+)?(?:algo|melhorar|mudar|criar|fazer)\.?$/i.test(text)) return { kind: 'clarification_required', question: { id: 'objective', question: 'O que você quer construir ou alterar exatamente?', options: [{ value: 'plan', label: 'Planejar primeiro', recommended: true }, { value: 'change', label: 'Alterar algo existente' }, { value: 'investigate', label: 'Investigar um problema' }] } };
  // Candidato a trabalho por par verbo+objeto OU por frase forte de intenção.
  const isWork = (operationalVerb.test(text) && explicitObject.test(text)) || workIntentPhrase.test(text);
  if (!isWork) return { kind: 'conversation' };
  const requestKind: ConstructionIntentV1['request_kind'] = /\b(?:investig|an[aá]lis|diagn[oó]stic)/i.test(text) ? 'investigate' : /\b(?:alter|corrig|refator|implement)\b/i.test(text) ? 'change' : 'plan';
  const intent: ConstructionIntentV1 = { schema_version: 1, mode: 'construction', request_kind: requestKind, confidence: 'high' };
  // Proposta planning-first e HONESTA: o escopo não afirma alvo, arquivo ou nó
  // algum (nada é inventado), e o excludedScope registra explicitamente que nada
  // é lido, executado ou alterado antes de uma etapa autorizada. A designação de
  // alvo/execução autônoma é uma etapa posterior, dirigida pelo usuário.
  return { kind: 'work_candidate', confidence: 'high', command: { sourceMessageId, impactLevel: impactFor(text), capability: capabilityFor(text), intent, proposal: { schemaVersion: 1, data: { summary: text.length > 120 ? `${text.slice(0, 117)}…` : text, objective: text, includedScope: ['Entender o pedido e delimitar o trabalho proposto'], excludedScope: ['Ler arquivos, executar ou alterar qualquer coisa antes de aprovação'], expectedEffects: ['Produzir um plano de trabalho rastreável e versionado para revisão'], risks: ['O escopo pode precisar de correção antes da execução'] } } } };
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
