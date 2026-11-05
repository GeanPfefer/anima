// ============================================================
// ACC-01-FIX-02 — classificação PURA das mensagens sobre o FOCO de trabalho.
//
// Separa cinco intenções que antes colapsavam em `isWorkContinuation`:
//   focus_query  — "qual trabalho está em foco?"        (leitura; nunca escreve)
//   focus_set    — "use <id> como foco do trabalho"     (escrita explícita)
//   focus_clear  — "limpar o foco do trabalho"          (escrita explícita)
//   none         — qualquer outra coisa
// Consulta geral de trabalhos continua em `isWorkHistoryQuery`; continuação
// explícita em `isWorkContinuation`. "foco" sozinho é vocabulário cotidiano
// ("perdi o foco nos estudos"): toda intenção exige também um referente de
// trabalho (trabalho/tarefa/item/work) — e as mutantes exigem forma imperativa.
// ============================================================

export type WorkFocusIntent =
  | { readonly kind: 'none' }
  | { readonly kind: 'focus_query' }
  | { readonly kind: 'focus_set'; readonly reference: string | null }
  | { readonly kind: 'focus_clear' };

const WORK_NOUN = /\b(?:trabalhos?|tarefas?|items?|itens?|work)\b/i;
const FOCUS = /\bfoco\b/i;
const EVERYDAY = /\b(?:hoje|ontem|dormi|corri|treinei|estudei|me senti|perdi|distra[ií]|concentra)/i;
const INTERROGATIVE_START = /^\s*(?:e\s+)?(?:qual|quais|que|cad[eê]|h[aá]|tem|existe|algum|algu[eé]m|como|onde|quando|por\s*que|o\s+que|mostr\w+|ver|veja|diga|informe)\b/i;
const SET_VERB = /\b(?:use|usar|utilize|utilizar|defin\w+|coloque|colocar|ponha|p[oô]r|fixe|fixar|mude|mudar|troque|trocar|altere|alterar|selecion\w+|escolh\w+|foque|focar)\b/i;
const CLEAR_VERB = /\b(?:limpe|limpar|remova|remover|tire|tirar|desfa[cç]a|desfazer|retire|retirar|apague|apagar|zere|zerar|desmarque|desmarcar|desvincule|desvincular)\b/i;
const REFERENCE = /\b([0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)\b/i;

export function classifyWorkFocusIntent(message: string): WorkFocusIntent {
  const text = message.trim();
  if (!text || !FOCUS.test(text) || EVERYDAY.test(text)) return { kind: 'none' };
  const mentionsWork = WORK_NOUN.test(text) || REFERENCE.test(text);
  if (!mentionsWork) return { kind: 'none' };
  const question = /\?\s*$/.test(text) || INTERROGATIVE_START.test(text);
  // Imperativo: o verbo vem antes de "foco" e a frase não é pergunta ("pode limpar...?" é pedido
  // educado e, por segurança, NÃO muta: vira consulta e orienta o usuário a pedir de forma direta).
  if (!question && CLEAR_VERB.test(text)) return { kind: 'focus_clear' };
  if (!question && SET_VERB.test(text)) {
    const ref = REFERENCE.exec(text)?.[1] ?? null;
    return { kind: 'focus_set', reference: ref };
  }
  return { kind: 'focus_query' };
}
