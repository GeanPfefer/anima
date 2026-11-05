import { classifyWorkFocusIntent } from './work-focus-intent';
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
// `corrig(?:ir|a)` casava "corriga" (não é palavra) e perdia as formas reais
// "corrija"/"corrige" — um pedido de correção de código virava conversa sem
// proposta (fallback silencioso). A grafia g→j do imperativo de -gir exige
// `corrij(?:a|o)` além de `corrig(?:ir|e|indo)`.
const operationalVerb = /\b(?:planej(?:ar|e)|constru(?:ir|a)|implement(?:ar|e)|alter(?:ar|e)|corrig(?:ir|e|indo)|corrij(?:a|o)|investig(?:ar|ue)|cri(?:ar|e)|refator(?:ar|e)|an[aá]lis(?:ar|e)|prepar(?:ar|e)|organiz(?:ar|e)|revis(?:ar|e)|document(?:ar|e)|redij(?:a|o)|escrev(?:er|a)|elabor(?:ar|e)|sintetiz(?:ar|e)|compil(?:ar|e)|resum(?:ir|a)|mape(?:ar|ie)|avali(?:ar|e)|atualiz(?:ar|e)|esbo[cç](?:ar|e)|levant(?:ar|e)|preserv(?:ar|e))\b/i;
// Objetos de trabalho: artefatos de software E de projeto/documento.
const explicitObject = /\b(?:anima|aplicativo|app|site|sistema|c[oó]digo|tela|fluxo|funcionalidade|recurso|bug|arquitetura|banco|api|chat|projeto|plano|planos|documento|documentos|arquivo|arquivos|relat[oó]rio|resumo|texto|reposit[oó]rio|roadmap|backlog|prd|especifica[cç][aã]o|migration|migra[cç][aã]o|teste|testes|marco|marcos|proposta)\b/i;
// Sinal forte de intenção de trabalho: frases que pedem uma proposta/estruturação
// segura. Determinístico e específico — captura o pedido genuíno mesmo quando o
// par verbo+objeto não bate, sem transformar conversa comum em trabalho.
const workIntentPhrase = /\b(?:(?:cri\w*|mont\w*|prepar\w*|elabor\w*|redij\w*|ger\w*|abr\w*)\s+(?:um[a]?\s+)?(?:nov[ao]\s+)?(?:proposta|mandato)|prepar\w*\s+(?:um[a]?\s+)?proposta|apresent\w*\s+(?:a\s+)?proposta|estrutur\w*\s+(?:esse|este|o)\s+trabalho|organiz\w*\s+(?:esse|este|o)\s+trabalho|proposta\s+antes\s+de\s+come[cç]ar|trabalho\s+de\s+forma\s+segura)\b/i;
// ACC-01-FIX-04 — sinais de que a mensagem PEDE INFORMAÇÃO/DISCUSSÃO em vez de pedir trabalho:
//  (1) qualquer interrogação; (2) abertura interrogativa ou de consulta ("quais", "como", "compare",
//  "explique", "me diga"...); (3) desejo de analisar/entender/saber/discutir ("quero analisar...").
// Um falso positivo aqui só mantém a conversa (o usuário pode dizer "crie uma proposta..."); um falso
// negativo cria um work item persistente e gasta o planner — por isso o viés é conversar.
const QUESTION_SENTENCE_OPENER = /(?:^|[.!;:\n]\s*)(?:e\s+|mas\s+)?(?:qual|quais|quem|quanto|quantos|quantas|como|por\s*qu[eê]|porque|quando|onde|o\s+que|que\s+(?:trabalhos?|itens?|tarefas?|decis[oõ]es)|existe|existem|h[aá]|devemos|deveríamos|vale\s+a\s+pena|faz\s+sentido)\b/i;
const CONSULTATION_OPENER = /(?:^|[.!;:\n]\s*)(?:por\s+favor,?\s+)?(?:consulte|explique|compare|diferencie|mostre|liste|diga|descreva|conte|opine|discuta|esclare[cç]a|me\s+(?:diga|mostre|explique|conte|ajude\s+a\s+(?:entender|decidir|priorizar)))\b/i;
const ANALYSIS_DESIRE = /(?:^|[.!;:\n]\s*)(?:eu\s+)?(?:quero|queria|preciso|gostaria\s+de|vamos|precisamos)\s+(?:de\s+)?(?:analisar|entender|saber|ver|avaliar|discutir|conversar|consultar|comparar|priorizar|decidir|conhecer)\b/i;
const isInformationalRequest = (text: string): boolean =>
  /\?/.test(text) || QUESTION_SENTENCE_OPENER.test(text) || CONSULTATION_OPENER.test(text) || ANALYSIS_DESIRE.test(text);
// Mandato estruturado (campos rotulados): é um pedido de trabalho completo mesmo sem imperativo inicial.
const MANDATE_FIELD = /\b(?:objetivo|escopo(?:\s+funcional)?|provas?\s+m[ií]nimas?|invariantes|crit[eé]rios\s+de\s+aceite)\s*:/gi;
const isStructuredMandate = (text: string): boolean => (text.match(MANDATE_FIELD) ?? []).length >= 2;
const lifeRecord =/\b(?:hoje|ontem|dormi|corri|treinei|estudei|trabalhei|senti|estou me sentindo)\b/i;
// A capacidade distingue **mudar código** de **investigar sem mudar** — e o VERBO
// decide, não o substantivo. Um pedido para implementar/refatorar/corrigir/
// desenvolver código é `programming` mesmo quando descreve o diagnóstico ou a
// análise do que será mexido (ex.: "implemente um endpoint que analisa o banco");
// por isso o verbo de alteração de código tem **precedência** sobre os termos de
// pesquisa. Criar/adicionar/construir um objeto de código também é `programming`.
// Sem verbo de alteração, investigação/análise/pesquisa/documentação/revisão/
// diagnóstico permanecem `research`. Um objeto de código sem verbo de alteração
// cai em `programming` só como fallback fraco (a etapa seguinte delimita). Radicais
// de pesquisa sem fronteira final: "analise"/"resumo"/"documente" têm sufixo, então
// `\b` no fim impediria o match. A capacidade é metadado best-effort.
// Correção MÍNIMA e conservadora: só hoista o verbo de alteração de código acima
// da pesquisa. O resto do heurístico permanece idêntico ao anterior — nenhum
// vocabulário novo entra no fallback, para não transformar pedido técnico
// qualquer em programming (ex.: "descreva a rota", "crie um plano de migração"
// continuam fora de programming). `codeNoun` é exatamente o conjunto antigo.
const codeChangeVerb = /\b(?:implement(?:ar|e|ando)|refator(?:ar|e|ando)|corrig(?:ir|e|indo)|corrij(?:a|o)|desenvolv(?:er|a|endo)|codific(?:ar|e))\b/i;
const researchSignal = /\b(?:investig|an[aá]lis|pesquis|resum|document|revis|diagn[oó]stic|bug|problem)/i;
const codeNoun = /\b(?:arquitetura|banco|api|c[oó]digo)\b/i;
const capabilityFor = (message: string): WorkCapability =>
  codeChangeVerb.test(message) ? 'programming'
    : researchSignal.test(message) ? 'research'
      : codeNoun.test(message) ? 'programming'
        : 'planning';
const impactFor = (message: string): WorkImpactLevel => /\b(?:apagar|excluir|migra|produ[cç][aã]o|seguran[cç]a|arquitetura|banco)\b/i.test(message) ? 'structural' : /\b(?:alter|implement|constru|cri)\b/i.test(message) ? 'significant' : 'low';

export function interpretWorkRequest(message: string, sourceMessageId: string): WorkIntentInterpretation {
  const text = normalize(message);
  // Vazio ou pergunta explícita nunca é trabalho — veto legítimo e independente
  // do conteúdo. O marcador cotidiano (`lifeRecord`) NÃO entra aqui: veta apenas
  // registro de vida PURO, o que só se decide depois de calcular o sinal de
  // trabalho (ver abaixo). Antes o `lifeRecord` vetava nesta linha, então a
  // palavra "hoje" incidental dentro de um mandato operacional
  // (ex.: "...o comportamento que existe hoje") derrubava a intenção real.
  if (!text || /\?\s*$/.test(text)) return { kind: 'conversation' };
  if (/^(?:eu\s+)?(?:quero|gostaria|tenho vontade)\s+(?:de\s+)?(?:algo|melhorar|mudar|criar|fazer)\.?$/i.test(text)) return { kind: 'clarification_required', question: { id: 'objective', question: 'O que você quer construir ou alterar exatamente?', options: [{ value: 'plan', label: 'Planejar primeiro', recommended: true }, { value: 'change', label: 'Alterar algo existente' }, { value: 'investigate', label: 'Investigar um problema' }] } };
  // Candidato a trabalho por par verbo+objeto OU por frase forte de intenção.
  const isWork = (operationalVerb.test(text) && explicitObject.test(text)) || workIntentPhrase.test(text);
  // ACC-01-FIX-04: criar uma proposta PERSISTENTE exige um pedido de trabalho, não uma consulta.
  // Verbo operacional + objeto ("analisar ... ANIMA ... backlog") aparece em perguntas, análises e
  // discussões; sozinho NÃO autoriza escrita. Sem pedido explícito (frase forte de proposta/mandato
  // ou mandato estruturado), uma mensagem informacional permanece conversa.
  if (isWork && !workIntentPhrase.test(text) && !isStructuredMandate(text) && isInformationalRequest(text)) return { kind: 'conversation' };
  // Precedência corrigida: o marcador cotidiano só devolve conversa quando é um
  // registro de vida PURO — isto é, quando NÃO há sinal de trabalho explícito.
  // Assim "Hoje corri por 30 minutos" continua conversa, mas "...que existe hoje"
  // dentro de um mandato operacional deixa de ser vetado pela palavra "hoje".
  if (lifeRecord.test(text) && !isWork) return { kind: 'conversation' };
  if (!isWork) return { kind: 'conversation' };
  const requestKind: ConstructionIntentV1['request_kind'] = /\b(?:investig|an[aá]lis|diagn[oó]stic)/i.test(text)
    ? 'investigate'
    : codeChangeVerb.test(text) || /\balter(?:ar|e|ando)\b/i.test(text)
      ? 'change'
      : 'plan';
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
// ACC-01-FIX-02: continuação EXPLÍCITA exige um verbo de continuação/ajuste. Substantivos e
// demonstrativos soltos ("trabalho", "tarefa", "proposta", "resultado", "isso", "nesse") NÃO
// bastam: uma pergunta como "qual trabalho está em foco?" já abriu o seletor mutante de foco.
// Perguntas (interrogativo inicial) e mensagens sobre o foco ou o histórico nunca são continuação.
const CONTINUATION_VERB=/\b(?:continue|continuar|continuemos|retome|retomar|prossiga|prosseguir|siga\s+com|ajuste|ajustar|corrija|corrigir)\b/i;
const QUESTION_OPENING=/^\s*(?:e\s+)?(?:qual|quais|quem|que|cad[eê]|h[aá]|tem|existe|como|onde|quando|por\s*que|o\s+que|mostr\w+|ver|veja|liste|listar|diga|informe)\b/i;
export const isWorkContinuation=(message:string):boolean=>CONTINUATION_VERB.test(message)&&!QUESTION_OPENING.test(message)&&classifyWorkFocusIntent(message).kind==='none'&&!/\b(?:hoje|ontem|dormi|corri|treinei|estudei|me senti)\b/i.test(message);

// UX-04 — estados NÃO terminais (trabalho ainda em aberto, reencontrável e
// retomável pela conversa). Fonte única; os terminais são completed/failed/
// rejected/cancelled. A ordem aqui não implica prioridade.
export const RESUMABLE_WORK_STATES = ['proposed','approved','in_progress','blocked','review','changes_requested'] as const;

// UX-04 — intenção CONVERSACIONAL de reencontrar/listar o próprio trabalho aberto
// ("quais trabalhos tenho em aberto?", "meus trabalhos", "o que ficou pendente?",
// "onde paramos?", "retomar um trabalho"). É determinística e fail-closed: só
// padrões específicos de consulta ao trabalho existente disparam a lista; registro
// de vida cotidiana ("trabalhei hoje") é excluído. Distinta de isWorkContinuation
// (que retoma um referente específico já em foco): a rota consulta o histórico
// ANTES da continuação, então um pedido genérico de listar prevalece sobre focar.
export const isWorkHistoryQuery=(message:string):boolean=>/\b(?:meus\s+trabalhos|trabalhos?\s+(?:em\s+aberto|abertos?|pendentes?|pausados?|ativos?|parados?|aguardando)|(?:quais|que|liste|listar|mostr\w+|ver)\s+(?:os\s+)?(?:meus\s+)?trabalhos|o\s+que\s+(?:ficou|est[aá]|t[aá])\s+(?:pendente|em\s+aberto|parado|pausado|aguardando)|onde\s+(?:paramos|parei|est[aá]vamos)|tenho\s+(?:algo|algum\s+trabalho|trabalhos)\s+(?:em\s+aberto|pendente|pausad|parad|aguardando|em\s+andamento)|(?:retomar|continuar)\s+(?:um|meu|meus|o|algum)\s+trabalho|decis(?:ão|ões|oes)\s+pendentes?|trabalhos?\s+aguardando\s+decis)/i.test(message)&&!/\b(?:hoje|ontem|dormi|corri|treinei|estudei|me senti)\b/i.test(message);
