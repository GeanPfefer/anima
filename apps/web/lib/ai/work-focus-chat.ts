import type { WorkFocusIntent } from '@anima/core';
import { sanitizeBriefText, shortRef } from './conversation-brief';
import { OPEN_WORK_STATES, readFocus, readOpenWork, type UserClient } from './project-read-model';
import { clearWorkFocus, isClearWorkFocusEnabled } from '@/lib/work-orchestration/work-focus';

// ============================================================
// ACC-01-FIX-02 — respostas DETERMINÍSTICAS às intenções de foco no chat.
//
//   focus_query  → só leitura (work_focus + item sob RLS). Nunca escreve, nunca abre seletor.
//   focus_set    → só no Chat Dev, só com referência explícita e inequívoca a um trabalho aberto
//                  do usuário; chama `set_work_focus` e NADA mais (não anexa mensagem, não muda estado).
//   focus_clear  → só no Chat Dev; depende da RPC `clear_work_focus`, protegida por flag até a
//                  migration ser aplicada. Sem a flag: informa e não escreve.
// ============================================================

export interface WorkFocusChatOutcome {
  readonly text: string;
  readonly mutation: 'none' | 'focus-set' | 'focus-clear';
  /** Novo foco após a mutação ('' = sem foco); undefined = foco inalterado. */
  readonly focusChangedTo?: string;
}

const LIST_HINT = 'Para ver os trabalhos abertos, pergunte "quais trabalhos estão abertos?". Para escolher um, diga "use <id> como foco do trabalho".';
const READ_FAILED = 'Não consegui consultar o foco agora (falha na consulta). Nada foi alterado.';

async function describeFocus(client: UserClient, userId: string, itemId: string): Promise<string> {
  const row = await client.from('work_items').select('id, state, proposal, original_request').eq('user_id', userId).eq('id', itemId).maybeSingle();
  if (row.error) return `[obra:${shortRef(itemId)}] (detalhes indisponíveis agora)`;
  if (!row.data) return `[obra:${shortRef(itemId)}] (item não visível para esta conta)`;
  const summary = (row.data.proposal as { data?: { summary?: unknown } } | null)?.data?.summary;
  const text = sanitizeBriefText(typeof summary === 'string' && summary.trim() ? summary : row.data.original_request, 160);
  return `[obra:${shortRef(itemId)}] "${text}" — estado: ${row.data.state}`;
}

export async function handleWorkFocusIntent(input: {
  readonly client: UserClient;
  readonly userId: string;
  readonly intent: Exclude<WorkFocusIntent, { readonly kind: 'none' }>;
  readonly developmentMode: boolean;
  readonly env?: Record<string, string | undefined>;
}): Promise<WorkFocusChatOutcome> {
  const { client, userId, intent } = input;

  if (intent.kind === 'focus_query') {
    const focus = await readFocus(client, userId);
    if (focus === 'failed') return { text: READ_FAILED, mutation: 'none' };
    if (!focus) return { text: `Nenhum trabalho está em foco no momento. Esta consulta não alterou nada. ${LIST_HINT}`, mutation: 'none' };
    return { text: `Trabalho em foco: ${await describeFocus(client, userId, focus)}. Esta consulta não alterou nada.`, mutation: 'none' };
  }

  if (!input.developmentMode) {
    return {
      text: 'Alterar o foco é uma ação explícita: use o botão "Usar como foco" no cartão do trabalho. Nada foi alterado.',
      mutation: 'none',
    };
  }

  if (intent.kind === 'focus_set') {
    if (!intent.reference) return { text: `Informe qual trabalho deve ficar em foco, pelo id (ex.: "use fad07a1f como foco do trabalho"). Nada foi alterado. ${LIST_HINT}`, mutation: 'none' };
    const work = await readOpenWork(client, userId, OPEN_WORK_STATES, 100);
    if (work.kind === 'failed') return { text: 'Não consegui consultar os trabalhos agora (falha na consulta). O foco não foi alterado.', mutation: 'none' };
    const ref = intent.reference.toLowerCase();
    const matches = work.rows.filter(item => item.id.startsWith(ref));
    if (matches.length === 0) return { text: `Não encontrei trabalho aberto visível nesta conta com a referência ${ref.slice(0, 36)}. O foco não foi alterado.`, mutation: 'none' };
    if (matches.length > 1) return { text: `A referência ${ref.slice(0, 36)} é ambígua (${matches.slice(0, 5).map(m => shortRef(m.id)).join(', ')}). Informe mais caracteres. O foco não foi alterado.`, mutation: 'none' };
    const target = matches[0]!;
    const result = await client.rpc('set_work_focus', { work_item_id: target.id });
    if (result.error) return { text: 'Não foi possível definir o foco agora. Nada foi alterado.', mutation: 'none' };
    return {
      text: `Foco definido em [obra:${shortRef(target.id)}] "${sanitizeBriefText(target.summary, 120)}" (estado: ${target.state}). Apenas o foco mudou: nenhuma mensagem foi anexada ao trabalho e nenhum estado, aprovação ou execução foi alterado.`,
      mutation: 'focus-set',
      focusChangedTo: target.id,
    };
  }

  // focus_clear
  if (!isClearWorkFocusEnabled(input.env)) {
    return { text: 'A limpeza de foco ainda não está disponível neste ambiente (a operação canônica aguarda ser implantada). Nada foi alterado.', mutation: 'none' };
  }
  const cleared = await clearWorkFocus(client, input.env);
  if (!cleared.ok) return { text: 'Não foi possível limpar o foco agora. Nada foi alterado.', mutation: 'none' };
  return {
    text: cleared.cleared
      ? 'Foco limpo. Nenhum trabalho, contexto ou evento foi alterado.'
      : 'Não havia trabalho em foco. Nada foi alterado.',
    mutation: cleared.cleared ? 'focus-clear' : 'none',
    ...(cleared.cleared ? { focusChangedTo: '' } : {}),
  };
}
