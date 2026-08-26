import { decideRecovery, recoveryFailureCode, type WorkRecoveryAssessment } from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

type ItemRow = Pick<Database['public']['Tables']['work_items']['Row'], 'id' | 'state' | 'proposal_version' | 'intent'>;
type EventRow = Pick<Database['public']['Tables']['work_events']['Row'], 'id' | 'event_type' | 'proposal_version' | 'payload' | 'seq'>;

const record = (value: Json | undefined): Record<string, Json | undefined> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, Json | undefined> : null;
const text = (value: Json | undefined): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const integer = (value: Json | undefined): number | null => typeof value === 'number' && Number.isInteger(value) ? value : null;
const data = (payload: Json): Record<string, Json | undefined> | null => record(record(payload)?.['data']);
const attemptId = (event: EventRow): string | null => text(data(event.payload)?.['attempt_id']);
const failureEvidence = (event: EventRow) => {
  const root = data(event.payload);
  const signal = record(root?.['executor_signal']);
  const message = text(root?.['message']);
  // A mensagem persistida já é sanitizada pelo host. Ainda assim, a projeção limita
  // tamanho e rejeita padrões óbvios de segredo antes de entregá-la ao core.
  const safeMessage = message && message.length <= 600 && !/(?:token|password|secret|api[_-]?key)\s*[:=]/i.test(message)
    ? message : null;
  return {
    code: text(signal?.['code']) ?? text(root?.['reason']),
    safeMessage,
    retryable: root?.['retryable'] === true,
  };
};

/** Projeção pura dos fatos persistidos. Não cria successor nem altera o item. */
export function projectWorkRecoveryAssessment(item: ItemRow, events: readonly EventRow[]): WorkRecoveryAssessment | null {
  if (item.state !== 'failed') return null;
  const spec = record(record(item.intent)?.['execution_spec']);
  const limits = record(spec?.['limits']);
  const maxAttempts = integer(limits?.['max_attempts']);
  if (maxAttempts === null || maxAttempts < 1) return null;

  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const failures = ordered.filter(event => event.event_type === 'execution_failed'
    && event.proposal_version === item.proposal_version && attemptId(event));
  const latest = failures.at(-1);
  if (!latest) return null;
  const latestAttemptId = attemptId(latest);
  if (!latestAttemptId) return null;
  const attemptsUsed = new Set(ordered.filter(event => event.event_type === 'execution_started'
    && event.proposal_version === item.proposal_version).map(attemptId).filter((id): id is string => id !== null)).size;
  const latestEvidence = failureEvidence(latest);
  const latestCode = recoveryFailureCode(latestEvidence);
  const repeatedSameFailure = latestCode !== null && failures.slice(0, -1)
    .some(event => recoveryFailureCode(failureEvidence(event)) === latestCode);

  return {
    workItemId: item.id,
    proposalVersion: item.proposal_version,
    failureEventId: latest.id,
    sourceAttemptId: latestAttemptId,
    attemptsUsed,
    maxAttempts,
    decision: decideRecovery({ ...latestEvidence, attemptsUsed, maxAttempts, repeatedSameFailure }),
  };
}

/** Leitura RLS user-scoped; erros/ausências devolvem null (fail-closed). */
export async function readWorkRecoveryAssessment(
  client: SupabaseClient<Database>, workItemId: string,
): Promise<WorkRecoveryAssessment | null> {
  const itemResult = await client.from('work_items')
    .select('id,state,proposal_version,intent').eq('id', workItemId).maybeSingle();
  if (itemResult.error || !itemResult.data) return null;
  const eventsResult = await client.from('work_events')
    .select('id,event_type,proposal_version,payload,seq').eq('work_item_id', workItemId)
    .in('event_type', ['execution_started', 'execution_failed']).order('seq');
  if (eventsResult.error || !eventsResult.data) return null;
  return projectWorkRecoveryAssessment(itemResult.data, eventsResult.data);
}
