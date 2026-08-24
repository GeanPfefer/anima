import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { processProjectConversationGovernance } from './project-conversation-governance';

const client = (pending: { id: string; version: number; statement: string }[] = []) => {
  const rpc = jest.fn();
  const insert = jest.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'message-1' }, error: null }) }) }));
  const from = jest.fn((table: string) => table === 'project_decision_proposal_state' ? {
    select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: pending, error: null }) }) }) }),
  } : { insert, select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) });
  return { value: { from, rpc } as unknown as SupabaseClient<Database>, rpc, insert, from };
};

describe('boundary web da governança conversacional', () => {
  test.each(['E se usássemos Kubernetes?', 'Como está o projeto?', 'Hoje eu corri.'])('conversa %s continua no fluxo existente sem escrita governada', async message => {
    const c = client();
    expect(await processProjectConversationGovernance({ client: c.value, userId: 'u', message })).toBeNull();
    expect(c.rpc).not.toHaveBeenCalled(); expect(c.insert).not.toHaveBeenCalled();
  });
  test('preferência explícita cria somente proposta awaiting e resposta natural', async () => {
    const c = client();
    c.rpc.mockResolvedValue({ data: { action: 'recorded', proposal_id: 'p1', version: 1 }, error: null });
    const result = await processProjectConversationGovernance({ client: c.value, userId: 'u', message: 'Eu prefiro local primeiro e cloud só quando realmente precisar.' });
    expect(c.rpc).toHaveBeenCalledWith('create_project_decision_proposal', expect.objectContaining({ provenance: expect.objectContaining({ source: 'human_expression' }) }));
    expect(result).toMatchObject({ kind: 'proposal', sourceMessageId: 'message-1' });
    expect(result?.text).toContain('É isso?');
  });
  test('confirmação inequívoca chama somente RPC de ratificação humana', async () => {
    const c = client([{ id: 'p1', version: 2, statement: 'Manter local primeiro.' }]);
    c.rpc.mockResolvedValue({ data: { action: 'recorded' }, error: null });
    const result = await processProjectConversationGovernance({ client: c.value, userId: 'u', message: 'Sim.' });
    expect(c.rpc).toHaveBeenCalledWith('resolve_project_decision_proposal', expect.objectContaining({ proposal_id: 'p1', expected_version: 2, outcome: 'ratified', provenance: expect.objectContaining({ actor: 'user' }) }));
    expect(result?.text).toContain('Nenhuma ação operacional');
  });
  test('duas pendentes pedem esclarecimento sem RPC de decisão', async () => {
    const c = client([{ id: 'p1', version: 1, statement: 'A' }, { id: 'p2', version: 1, statement: 'B' }]);
    const result = await processProjectConversationGovernance({ client: c.value, userId: 'u', message: 'Sim.' });
    expect(result?.kind).toBe('clarification'); expect(c.rpc).not.toHaveBeenCalled();
  });
  test('rejeição e revisão nunca usam outcome ratified', async () => {
    for (const [message, outcome] of [['Não.', 'rejected'], ['Quase, troca essa parte.', 'changes_requested']] as const) {
      const c = client([{ id: 'p1', version: 1, statement: 'Direção.' }]);
      c.rpc.mockResolvedValue({ data: { action: 'recorded' }, error: null });
      await processProjectConversationGovernance({ client: c.value, userId: 'u', message });
      expect(c.rpc).toHaveBeenCalledWith('resolve_project_decision_proposal', expect.objectContaining({ outcome }));
    }
  });
});
