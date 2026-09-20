import {
  interpretWorkRequest,
  isConversationalItemReferenceQuestion,
  isProjectAdvisorQuestion,
  isProjectItemDrilldownQuestion,
  isWorkContinuation,
  isWorkHistoryQuery,
  parsePresentedItemReferences,
  resolveConversationalItemReference,
  type PresentedItemReference,
  type WorkIntentInterpretation,
} from '@anima/core';
import { resolveAutonomousWorkChatIntent, type AutonomousWorkChatIntent } from './autonomous-work-selection';

const CLASSIFICATION_SOURCE_ID = 'development-chat-intent-classification';

export type DevelopmentChatIntent =
  | { readonly kind: 'new_work_request'; readonly work: Extract<WorkIntentInterpretation, { readonly kind: 'work_candidate' }> }
  | { readonly kind: 'existing_item_reference'; readonly presentedReferences: readonly PresentedItemReference[] }
  | { readonly kind: 'existing_item_command'; readonly work: Exclude<WorkIntentInterpretation, { readonly kind: 'work_candidate' }> }
  | { readonly kind: 'autonomous_queue_command'; readonly command: AutonomousWorkChatIntent }
  | { readonly kind: 'project_query' }
  | { readonly kind: 'conversation'; readonly work: Exclude<WorkIntentInterpretation, { readonly kind: 'work_candidate' }> };

/**
 * Classifica uma mensagem do Chat Dev antes de qualquer handler especializado.
 * A função é pura: não consulta itens, não persiste mensagem e não concede
 * autoridade. O comando de proposta produzido aqui recebe o sourceMessageId real
 * somente depois que a route preserva a mensagem.
 */
export function classifyDevelopmentChatIntent(input: {
  readonly message: string;
  readonly presentedItemReferences?: unknown;
}): DevelopmentChatIntent {
  const presentedReferences = parsePresentedItemReferences(input.presentedItemReferences);
  const contextual = resolveConversationalItemReference(input.message, presentedReferences);
  const hasExistingReference = contextual.kind !== 'not_contextual'
    || isProjectItemDrilldownQuestion(input.message)
    || isConversationalItemReferenceQuestion(input.message, presentedReferences);
  const work = interpretWorkRequest(input.message, CLASSIFICATION_SOURCE_ID);
  const autonomous = resolveAutonomousWorkChatIntent(input.message);

  // Mandato positivo explicitamente ligado a item preserva a precedência do
  // comando existente. A admissão canônica ainda revalida a fila/autoridade.
  if (autonomous && hasExistingReference) return { kind: 'autonomous_queue_command', command: autonomous };
  // Uma referência realmente vinculada a item vence o gate genérico de novo
  // trabalho. Isso preserva UUIDs, prefixos e anáforas apresentadas.
  if (hasExistingReference) return { kind: 'existing_item_reference', presentedReferences };
  // Um pedido operacional novo não pode ser reinterpretado como seleção da
  // fila apenas porque também menciona "trabalho" ou "execute".
  if (work.kind === 'work_candidate') return { kind: 'new_work_request', work };
  if (autonomous) return { kind: 'autonomous_queue_command', command: autonomous };
  if (isProjectAdvisorQuestion(input.message)) return { kind: 'project_query' };
  if (isWorkHistoryQuery(input.message) || isWorkContinuation(input.message)) {
    return { kind: 'existing_item_command', work: work as Exclude<WorkIntentInterpretation, { readonly kind: 'work_candidate' }> };
  }
  return { kind: 'conversation', work };
}

export function bindDevelopmentWorkSource(
  intent: Extract<DevelopmentChatIntent, { readonly kind: 'new_work_request' }>,
  sourceMessageId: string,
): Extract<WorkIntentInterpretation, { readonly kind: 'work_candidate' }> {
  return {
    ...intent.work,
    command: { ...intent.work.command, sourceMessageId },
  };
}
