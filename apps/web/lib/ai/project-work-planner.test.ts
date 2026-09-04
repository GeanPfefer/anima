jest.mock('./project-tools', () => ({
  PROJECT_TOOL_CALL_LIMIT: 10,
  OPENAI_PROJECT_TOOLS: [{ type: 'function', name: 'project_read_file', description: 'read', strict: true, parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } }],
  executeProjectTool: jest.fn(async () => JSON.stringify({ ok: true, result: { text: 'evidência' } })),
}));

import type { CreateWorkProposalCommand } from '@anima/core';
import type { OpenAIAdmissionControl } from './openai-paid-transport';
import { OpenAIProjectWorkPlanner, planExecutableProjectWork } from './project-work-planner';
import { executeProjectTool } from './project-tools';

// Admissão financeira em memória que CONCEDE: exercita o caminho OpenAI do planner
// sem depender de fail-open nem gastar. A recusa e o fallback local são cobertos
// pela suite selectable.
const grant: OpenAIAdmissionControl = { admit: async intent => ({ consumer: intent.consumer, authorizationRef: 'test', reservationId: null }) };

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
    // A fixture desta suite testa o default do coder, nao a configuracao do processo Jest.
    delete process.env.ANIMA_WORKTREE_CODER_BACKEND;
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
            validation_covers: ['Teste unitário verde'], additional_validations: [],
          }),
        }] }),
      });
  });

  afterAll(() => { process.env = originalEnv; });

  test('fixa alvo, permissões e limites no servidor após investigação local', async () => {
    const result = await planExecutableProjectWork('adicione o teste', base, new OpenAIProjectWorkPlanner({ admission: grant }));
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

  test('falha de tool nao libera evidencia no planner OpenAI', async () => {
    (executeProjectTool as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ ok: false, error: 'arquivo nao encontrado' }),
    );

    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'function_call',
            call_id: 'read-fail',
            name: 'project_read_file',
            arguments: '{}',
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'function_call',
            call_id: 'submit-too-early',
            name: 'submit_project_work_proposal',
            arguments: JSON.stringify({
              summary: 's',
              objective: 'o',
              included_scope: ['apps/web/lib/ai/project-work-planner.test.ts'],
              excluded_scope: ['packages/core'],
              expected_effects: ['e'],
              risks: ['r'],
              validation_label: 'v',
              validation_command: 'npm test -- project-work-planner.test.ts',
              validation_covers: ['e'], additional_validations: [],
            }),
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: [] }),
      });

    const planner = new OpenAIProjectWorkPlanner({
      admission: grant,
      apiKey: 'test-key',
      model: 'gpt-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      executeTool: executeProjectTool as jest.Mock,
    });

    const result = await planner.proposeArguments('faca');

    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test('included_scope inventado e recusado antes de virar proposta terminal', async () => {
    const valid = {
      summary: 'Ajuste real',
      objective: 'Usar arquivo real',
      included_scope: ['apps/web/lib/ai/project-work-planner.test.ts'],
      excluded_scope: ['packages/core'],
      expected_effects: ['teste'],
      risks: ['baixo'],
      validation_label: 'teste',
      validation_command: 'npm test -- project-work-planner.test.ts',
      validation_covers: ['teste'], additional_validations: [],
    };

    const invented = {
      ...valid,
      included_scope: ['src/components/NewFeature.js'],
    };

    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'function_call',
            call_id: 'read-1',
            name: 'project_read_file',
            arguments: '{}',
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'function_call',
            call_id: 'submit-bad',
            name: 'submit_project_work_proposal',
            arguments: JSON.stringify(invented),
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'function_call',
            call_id: 'submit-good',
            name: 'submit_project_work_proposal',
            arguments: JSON.stringify(valid),
          }],
        }),
      });

    const planner = new OpenAIProjectWorkPlanner({
      admission: grant,
      apiKey: 'test-key',
      model: 'gpt-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      executeTool: executeProjectTool as jest.Mock,
    });

    const result = await planner.proposeArguments('faca');

    expect(result).toEqual({
      ok: true,
      rawArguments: JSON.stringify(valid),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test('included_scope ancorado em arquivo real continua aceito', async () => {
    const args = {
      summary: 'Ajuste real',
      objective: 'Usar arquivo real',
      included_scope: ['apps/web/lib/ai/project-work-planner.test.ts'],
      excluded_scope: ['packages/core'],
      expected_effects: ['teste'],
      risks: ['baixo'],
      validation_label: 'teste',
      validation_command: 'npm test -- project-work-planner.test.ts',
      validation_covers: ['teste'], additional_validations: [],
    };

    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'function_call',
            call_id: 'read-ok',
            name: 'project_read_file',
            arguments: '{}',
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'function_call',
            call_id: 'submit-ok',
            name: 'submit_project_work_proposal',
            arguments: JSON.stringify(args),
          }],
        }),
      });

    const planner = new OpenAIProjectWorkPlanner({
      admission: grant,
      apiKey: 'test-key',
      model: 'gpt-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      executeTool: executeProjectTool as jest.Mock,
    });

    const result = await planner.proposeArguments('faca');

    expect(result).toEqual({
      ok: true,
      rawArguments: JSON.stringify(args),
    });
  });});
