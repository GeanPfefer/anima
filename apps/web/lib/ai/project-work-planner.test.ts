jest.mock('./project-tools', () => ({
  PROJECT_TOOL_CALL_LIMIT: 10,
  OPENAI_PROJECT_TOOLS: [{ type: 'function', name: 'project_read_file', description: 'read', strict: true, parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } }],
  executeProjectTool: jest.fn(async () => JSON.stringify({ ok: true, result: { text: 'evidência' } })),
}));

import type { CreateWorkProposalCommand } from '@anima/core';
import { planExecutableProjectWork } from './project-work-planner';

const base: CreateWorkProposalCommand = {
  sourceMessageId: 'message-1',
  impactLevel: 'significant',
  capability: 'planning',
  intent: { original_message: 'implemente' },
  proposal: {
    schemaVersion: 1,
    data: {
      summary: 'genérica', objective: 'genérico', includedScope: ['planejar'],
      excludedScope: ['executar'], expectedEffects: ['plano'], risks: ['imprecisão'],
    },
  },
};

describe('planejador executável do projeto', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'gpt-test' };
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: [{ type: 'function_call', call_id: 'read-1', name: 'project_read_file', arguments: '{}' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: [{
          type: 'function_call', call_id: 'submit-1', name: 'submit_project_work_proposal',
          arguments: JSON.stringify({
            summary: 'Adicionar teste do planejador',
            objective: 'Cobrir o planejador com teste unitário',
            included_scope: ['apps/web/lib/ai/project-work-planner.test.ts'],
            excluded_scope: ['Não alterar banco', 'Não fazer deploy'],
            expected_effects: ['Teste unitário verde'],
            risks: ['Mock divergir da API real'],
            validation_label: 'Teste do planejador aprovado',
            validation_command: 'npm test -- project-work-planner.test.ts',
          }),
        }] }),
      });
  });

  afterAll(() => { process.env = originalEnv; });

  test('fixa alvo, permissões e limites no servidor após investigação local', async () => {
    const result = await planExecutableProjectWork('adicione o teste', base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.capability).toBe('programming');
    expect(result.command.proposal.data.includedScope).toEqual(['apps/web/lib/ai/project-work-planner.test.ts']);
    expect(result.command.intent).toMatchObject({
      execution_spec: {
        target: { kind: 'project', reference: 'anima' },
        executor: 'worktree',
        coder_backend: 'ollama',
        permissions: ['workspace_read', 'workspace_write_isolated'],
        limits: { max_attempts: 3, max_duration_minutes: 30 },
      },
    });
    // O SHA-base autorizado foi capturado e persistido no contrato.
    const spec = (result.command.intent as { execution_spec: { base_sha?: unknown; model?: unknown } }).execution_spec;
    expect(String(spec.base_sha)).toMatch(/^[a-f0-9]{40}$/);
    expect(typeof spec.model).toBe('string');
  });
});
