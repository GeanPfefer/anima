jest.mock('./project-tools', () => ({
  PROJECT_TOOL_CALL_LIMIT: 10,
  OPENAI_PROJECT_TOOLS: [{ type: 'function', name: 'project_read_file', description: 'read', strict: true, parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } }],
  executeProjectTool: jest.fn(async () => JSON.stringify({ ok: true, result: { text: 'evidência' } })),
}));

import type { CreateWorkProposalCommand } from '@anima/core';
import type { OpenAIAdmissionControl } from './openai-paid-transport';
import { OpenAIProjectWorkPlanner, diagnosePlannerTurn } from './project-work-planner-openai';
import { planExecutableProjectWork } from './project-work-planner';
import { executeProjectTool } from './project-tools';

// Regressão da barreira real de 2026-09-25 (chat, pedido `GET /api/dev-readiness`): o GPT
// devolveu uma volta SEM function_call e o planner encerrou com "O GPT não produziu uma
// proposta estruturada", sem nenhum diagnóstico. O protocolo agora exige ferramentas
// (`tool_choice: 'required'`), dá UMA continuação corretiva a uma volta sem tool call e,
// se ainda falhar, devolve a forma da resposta — nunca aceita texto como proposta.

const grant: OpenAIAdmissionControl = { admit: async intent => ({ consumer: intent.consumer, authorizationRef: 'test', reservationId: null }) };
const reply = (body: unknown) => ({ ok: true, json: async () => body });
const textOnly = {
  status: 'completed',
  output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', content: [{ type: 'output_text', text: 'Vou investigar as configurações existentes antes de propor.' }] },
  ],
  usage: { input_tokens: 5000, output_tokens: 900, output_tokens_details: { reasoning_tokens: 850 } },
};
const readCall = { output: [{ type: 'function_call', call_id: 'read-1', name: 'project_read_file', arguments: '{}' }] };
const submitArgs = {
  summary: 'Rota de readiness de desenvolvimento',
  objective: 'Expor GET /api/dev-readiness com diagnóstico estruturado',
  included_scope: ['apps/web/lib/ai/project-work-planner.test.ts'],
  excluded_scope: ['Não alterar banco', 'Não alterar outros apps'],
  expected_effects: ['Rota responde diagnóstico estruturado'],
  risks: ['Divergir dos contratos de configuração'],
  validation_label: 'Teste da rota',
  validation_command: 'npm test -- project-work-planner.test.ts',
  validation_covers: ['Rota responde diagnóstico estruturado'], additional_validations: [],
};
const submitCall = { output: [{ type: 'function_call', call_id: 'submit-1', name: 'submit_project_work_proposal', arguments: JSON.stringify(submitArgs) }] };
const base: CreateWorkProposalCommand = {
  sourceMessageId: 'message-1', impactLevel: 'significant', capability: 'planning', intent: {},
  proposal: { schemaVersion: 1, data: { summary: 'g', objective: 'g', includedScope: ['p'], excludedScope: ['e'], expectedEffects: ['x'], risks: ['r'] } },
};
const planner = (fetchImpl: jest.Mock) => new OpenAIProjectWorkPlanner({
  admission: grant, apiKey: 'test-key', model: 'gpt-test',
  fetchImpl: fetchImpl as unknown as typeof fetch, executeTool: executeProjectTool as jest.Mock,
});
const sentBody = (fetchImpl: jest.Mock, call: number) => JSON.parse((fetchImpl.mock.calls[call] as [string, { body: string }])[1].body) as {
  tool_choice: unknown; input: Array<{ role?: string; content?: unknown; type?: string }>;
};

describe('planner OpenAI — volta sem tool call (barreira real do chat)', () => {
  let info: jest.SpyInstance;
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.ANIMA_WORKTREE_CODER_BACKEND;
    info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => info.mockRestore());

  test('o protocolo exige ferramentas: tool_choice required enquanto investiga', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(reply(readCall)).mockResolvedValueOnce(reply(submitCall));
    await planner(fetchImpl).proposeArguments('rota');
    expect(sentBody(fetchImpl, 0).tool_choice).toBe('required');
  });

  test('reprodução: volta só com texto recebe continuação corretiva e o fluxo chega a uma proposta válida', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(reply(textOnly))
      .mockResolvedValueOnce(reply(readCall))
      .mockResolvedValueOnce(reply(submitCall));
    const result = await planExecutableProjectWork('Quero implementar GET /api/dev-readiness', base, planner(fetchImpl));
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const continued = sentBody(fetchImpl, 1).input;
    expect(continued.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('submit_project_work_proposal') });
    expect(sentBody(fetchImpl, 1).tool_choice).toBe('required');
  });

  test('texto nunca vira proposta: duas voltas sem tool call falham com o diagnóstico da forma da resposta', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(reply(textOnly)).mockResolvedValueOnce(reply(textOnly));
    const result = await planner(fetchImpl).proposeArguments('rota');
    expect(result).toEqual({ ok: false, message: 'O GPT não produziu uma proposta estruturada (status=completed saída=[reasoning,message]).' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('resposta incompleta expõe o motivo do provider', async () => {
    const incomplete = { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning', summary: [] }] };
    const fetchImpl = jest.fn().mockResolvedValueOnce(reply(incomplete)).mockResolvedValueOnce(reply(incomplete));
    const result = await planner(fetchImpl).proposeArguments('rota');
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('status=incomplete motivo=max_output_tokens saída=[reasoning]') });
  });

  test('cada volta registra só a forma (tipos, status, tokens), nunca o texto', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(reply(textOnly)).mockResolvedValueOnce(reply(textOnly));
    await planner(fetchImpl).proposeArguments('rota');
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain('"outputTypes":["reasoning","message"]');
    expect(logged).toContain('"reasoningTokens":850');
    expect(logged).not.toContain('Vou investigar');
    expect(logged).not.toContain('test-key');
  });

  test('submit que falha na validação estrutural do host recebe o motivo real (não "escopo não ancorado")', async () => {
    const badSubmit = { output: [{ type: 'function_call', call_id: 'submit-bad', name: 'submit_project_work_proposal', arguments: JSON.stringify({ ...submitArgs, validation_command: 'rm -rf /' }) }] };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(reply(readCall))
      .mockResolvedValueOnce(reply(badSubmit))
      .mockResolvedValueOnce(reply(submitCall));
    const result = await planner(fetchImpl).proposeArguments('rota');
    expect(result.ok).toBe(true);
    const feedback = sentBody(fetchImpl, 2).input.find(item => item.type === 'function_call_output') as { output: string } | undefined;
    const outputs = sentBody(fetchImpl, 2).input.filter(item => item.type === 'function_call_output') as unknown as Array<{ output: string }>;
    expect(feedback).toBeDefined();
    expect(outputs.at(-1)!.output).toContain('validação estrutural do host');
  });

  test('diagnosePlannerTurn tolera resposta sem campos opcionais', () => {
    expect(diagnosePlannerTurn(1, {})).toEqual({
      turn: 1, status: null, incompleteReason: null, outputTypes: [], functionCalls: [], textChars: 0,
      inputTokens: null, outputTokens: null, reasoningTokens: null,
    });
  });
});
