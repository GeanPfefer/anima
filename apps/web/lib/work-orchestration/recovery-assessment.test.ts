import type { Database } from '@anima/types';
import { projectWorkRecoveryAssessment } from './recovery-assessment';

type Item = Pick<Database['public']['Tables']['work_items']['Row'], 'id' | 'state' | 'proposal_version' | 'intent'>;
type Event = Pick<Database['public']['Tables']['work_events']['Row'], 'id' | 'event_type' | 'proposal_version' | 'payload' | 'seq'>;
const item = (state: Item['state'] = 'failed'): Item => ({ id: 'item-1', state, proposal_version: 2, intent: { execution_spec: { limits: { max_attempts: 2 } } } });
const event = (id: string, type: Event['event_type'], seq: number, attempt: string, code?: string): Event => ({
  id, event_type: type, proposal_version: 2, seq,
  payload: {
    schema_version: 1,
    data: {
      attempt_id: attempt,
      ...(type === 'execution_failed' ? {
        reason: 'execution_failed', retryable: true,
        message: code ? `O backend falhou: [${code}] sem progresso.` : 'Falha genérica.',
        executor_signal: { code: 'execution_failed' },
      } : {}),
    },
  },
});

test('projeta o Item 1 real como decomposição após limite de leitura', () => {
  const result = projectWorkRecoveryAssessment(item(), [
    event('s1', 'execution_started', 1, 'a1'), event('f1', 'execution_failed', 2, 'a1', 'worktree_create_failed'),
    event('s2', 'execution_started', 3, 'a2'), event('f2', 'execution_failed', 4, 'a2', 'ollama_read_round_limit'),
  ]);
  expect(result).toMatchObject({ attemptsUsed: 2, maxAttempts: 2, sourceAttemptId: 'a2', decision: {
    failureKind: 'model_capability_limit', normalizedCode: 'ollama_read_round_limit', action: 'decompose',
  } });
});

test('falha repetida de gate decompõe mesmo com budget restante', () => {
  const result = projectWorkRecoveryAssessment(
    { ...item(), intent: { execution_spec: { limits: { max_attempts: 3 } } } },
    [event('s1', 'execution_started', 1, 'a1'), event('f1', 'execution_failed', 2, 'a1', 'gate_failed'),
      event('s2', 'execution_started', 3, 'a2'), event('f2', 'execution_failed', 4, 'a2', 'gate_failed')],
  );
  expect(result?.decision).toMatchObject({ action: 'decompose', reason: 'task_should_be_decomposed' });
});

test('desconhecido e mensagem sensível falham fechado', () => {
  const failed = event('f1', 'execution_failed', 2, 'a1');
  failed.payload = { schema_version: 1, data: { attempt_id: 'a1', reason: 'execution_failed', retryable: true, message: 'token=segredo' } };
  const result = projectWorkRecoveryAssessment(item(), [event('s1', 'execution_started', 1, 'a1'), failed]);
  expect(result?.decision).toMatchObject({ action: 'human_required', reason: 'failure_not_classified' });
});

test('estado não terminal, versão sem falha e limites inválidos não produzem advisory', () => {
  expect(projectWorkRecoveryAssessment(item('approved'), [])).toBeNull();
  expect(projectWorkRecoveryAssessment(item(), [{ ...event('f', 'execution_failed', 1, 'a1', 'gate_failed'), proposal_version: 1 }])).toBeNull();
  expect(projectWorkRecoveryAssessment({ ...item(), intent: {} }, [event('f', 'execution_failed', 1, 'a1', 'gate_failed')])).toBeNull();
});
