/** @jest-environment node */
import { LocalOllamaProjectWorkPlanner } from './project-work-planner-local';

const VALID_ARGS = JSON.stringify({
  summary: 'Ajuste', objective: 'Objetivo',
  included_scope: ['apps/web/lib/ai/project-work-planner.ts'],
  excluded_scope: ['Não alterar banco'], expected_effects: ['gate verde'], risks: ['variância'],
  validation_label: 'coder-backend', validation_command: 'npm test -- coder-backend.test.ts',
});

type Msg = { role: string; content?: string; tool_calls?: unknown[] };
const resp = (message: Msg) => ({ ok: true, json: async () => ({ choices: [{ message }] }) });
const toolCall = (name: string, args: string, id = 'c1') => ({ id, type: 'function', function: { name, arguments: args } });

function scriptedFetch(messages: Msg[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const message = messages[Math.min(i, messages.length - 1)];
    i += 1;
    return resp(message!);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const evidenceTool = async () => JSON.stringify({ ok: true, result: { text: 'evidência do repo' } });

describe('LocalOllamaProjectWorkPlanner', () => {
  test('id estável e endpoint local (sem Authorization)', async () => {
    const { impl, calls } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"AGENTS.md","start_line":1,"end_line":5}')] },
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', VALID_ARGS, 'c2')] },
    ]);
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool, baseUrl: 'http://localhost:11434' });
    expect(planner.id).toBe('local_ollama_project_tools_v1');

    const result = await planner.proposeArguments('faça o ajuste');
    expect(result).toEqual({ ok: true, rawArguments: VALID_ARGS });
    // endpoint OpenAI-compat local
    expect(calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    // NENHUM header de Authorization (nenhum segredo enviado ao modelo local)
    for (const call of calls) {
      const headers = (call.init.headers ?? {}) as Record<string, string>;
      expect(Object.keys(headers).map(k => k.toLowerCase())).not.toContain('authorization');
    }
  });

  test('exige investigação (evidência) antes de aceitar o submit', async () => {
    const { impl } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', VALID_ARGS)] }, // submit cedo → recusado
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"AGENTS.md","start_line":1,"end_line":5}', 'c2')] },
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', VALID_ARGS, 'c3')] }, // agora com evidência
    ]);
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool });
    const result = await planner.proposeArguments('faça');
    expect(result).toEqual({ ok: true, rawArguments: VALID_ARGS });
  });

  test('nenhum segredo do processo vaza para o modelo local', async () => {
    const prevOpenAi = process.env.OPENAI_API_KEY;
    const prevDeepSeek = process.env.DEEPSEEK_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-canary-openai-LEAK';
    process.env.DEEPSEEK_API_KEY = 'ds-canary-LEAK';
    try {
      const { impl, calls } = scriptedFetch([
        { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"AGENTS.md","start_line":1,"end_line":5}')] },
        { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', VALID_ARGS, 'c2')] },
      ]);
      const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool });
      const result = await planner.proposeArguments('faça');
      expect(result.ok).toBe(true);
      for (const call of calls) {
        const serialized = JSON.stringify(call.init.headers) + String(call.init.body);
        expect(serialized).not.toContain('canary');
        expect(serialized).not.toContain('LEAK');
      }
    } finally {
      if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevOpenAi;
      if (prevDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prevDeepSeek;
    }
  });

  test('após o limiar de evidência, força o submit restringindo as tools a só submit', async () => {
    const { impl, calls } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('project_list_files', '{"path":null,"contains":null}', 'e1')] },
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"AGENTS.md","start_line":1,"end_line":5}', 'e2')] },
      // 3ª rodada é forçada (forceAfterEvidence=2): tools = só submit → modelo submete.
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', VALID_ARGS, 's1')] },
    ]);
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool, forceAfterEvidence: 2 });
    const result = await planner.proposeArguments('faça');
    expect(result).toEqual({ ok: true, rawArguments: VALID_ARGS });
    // A requisição forçada (3ª) oferece SOMENTE a tool de submit.
    const forcedBody = JSON.parse(String(calls[2]!.init.body)) as { tools: Array<{ function: { name: string } }>; tool_choice: unknown };
    expect(forcedBody.tools.map(t => t.function.name)).toEqual(['submit_project_work_proposal']);
    expect(forcedBody.tool_choice).toEqual({ type: 'function', function: { name: 'submit_project_work_proposal' } });
  });

  test('normaliza o quirk escalar→lista do modelo local (sem inventar conteúdo)', async () => {
    const scalarArgs = JSON.stringify({
      summary: 's', objective: 'o',
      included_scope: 'apps/web/x.ts', // string única
      excluded_scope: 'não tocar banco', // string única
      expected_effects: 'efeito único', risks: 'risco único',
      validation_label: 'v', validation_command: 'npm test -- x.test.ts',
    });
    const { impl } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"AGENTS.md","start_line":1,"end_line":3}')] },
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', scalarArgs, 'c2')] },
    ]);
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool });
    const result = await planner.proposeArguments('faça');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.rawArguments) as Record<string, unknown>;
    expect(parsed.included_scope).toEqual(['apps/web/x.ts']);
    expect(parsed.excluded_scope).toEqual(['não tocar banco']);
    expect(parsed.expected_effects).toEqual(['efeito único']);
    expect(parsed.risks).toEqual(['risco único']);
  });

  test('fail-closed: só conversa (sem tool call) não vira proposta', async () => {
    const { impl } = scriptedFetch([
      { role: 'assistant', content: 'Claro, posso ajudar. O que você gostaria?' },
    ]);
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool, maxTurns: 6 });
    const result = await planner.proposeArguments('faça');
    expect(result.ok).toBe(false);
  });

  test('fail-closed: HTTP não-ok vira falha', async () => {
    const impl = (async () => ({ ok: false, json: async () => ({ error: { message: 'ollama fora' } }) })) as unknown as typeof fetch;
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool });
    const result = await planner.proposeArguments('faça');
    expect(result).toEqual({ ok: false, message: 'ollama fora' });
  });
});
