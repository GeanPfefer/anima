export type WorkOrchestrationChatKind =
  | 'work_proposal'
  | 'work_unavailable'
  | 'work_history'
  | 'work_history_empty'
  | 'none';

export function buildWorkOrchestrationReply(
  kind: WorkOrchestrationChatKind,
): string | null {
  if (kind === 'work_proposal') {
    return 'Preparei uma proposta para você revisar no cartão abaixo. Ainda não li nem executei o trabalho.';
  }

  if (kind === 'work_unavailable') {
    return 'Reconheci um pedido de trabalho, mas a Orquestração de Trabalho ainda não está habilitada para a sua conta. Não criei uma proposta nem executei o pedido.';
  }

  // UX-04 — reencontrar trabalho em aberto pela conversa. A resposta é ditada
  // pelo servidor (não pelo modelo): os cartões abaixo são a fonte da verdade.
  if (kind === 'work_history') {
    return 'Estes são seus trabalhos em aberto. Cada cartão abaixo permite focar, retomar, decidir ou revisar — direto daqui.';
  }

  if (kind === 'work_history_empty') {
    return 'Você não tem trabalhos em aberto no momento. Quando algo ficar pendente, pausado ou aguardando decisão, aparece aqui quando você perguntar.';
  }

  return null;
}
