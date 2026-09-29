/** @jest-environment node */
import { LocalOllamaProjectWorkPlanner } from './project-work-planner-local';

const VALID_ARGS = JSON.stringify({
  summary: 'Ajuste', objective: 'Objetivo',
  included_scope: ['apps/web/lib/ai/project-work-planner.ts'],
  excluded_scope: ['Não alterar banco'], expected_effects: ['gate verde'], risks: ['variância'],
  validation_label: 'coder-backend', validation_command: 'npm test -- coder-backend.test.ts',
  validation_covers: ['gate verde'], additional_validations: [],
});

type Msg = { role: string; content?: string; tool_calls?: unknown[] };
const resp = (message: Msg) => ({ ok: true, json: async () => ({ message, done: true }) });
const toolCall = (name: string, args: string, _id = 'c1') => ({
  function: { name, arguments: JSON.parse(args) as Record<string, unknown> },
});

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
    expect(calls[0]!.url).toBe('http://localhost:11434/api/chat');
    // NENHUM header de Authorization (nenhum segredo enviado ao modelo local)
    for (const call of calls) {
      const headers = (call.init.headers ?? {}) as Record<string, string>;
      expect(Object.keys(headers).map(k => k.toLowerCase())).not.toContain('authorization');
    }
  });

  test('envia contexto default 16384 e preserva opções nativas existentes', async () => {
    const { impl, calls } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"AGENTS.md"}')] },
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', VALID_ARGS)] },
    ]);
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool, env: {} });
    await planner.proposeArguments('x'.repeat(5_000));
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      model: string; stream: boolean; options: { temperature: number; num_ctx: number };
      messages: Msg[]; tools: Array<{ function: { name: string } }>;
    };
    expect(body.model).toBe('qwen3-coder:latest');
    expect(body.stream).toBe(false);
    expect(body.options).toEqual({ temperature: 0, num_ctx: 16_384 });
    expect(body.messages[0]).toMatchObject({ role: 'system' });
    expect(body.messages[1]).toMatchObject({ role: 'user' });
    expect(body.messages[1]!.content).toContain('x'.repeat(5_000));
    expect(body.tools.map(tool => tool.function.name)).toContain('project_read_file');
  });

  test('aceita override válido de contexto por configuração', async () => {
    const { impl, calls } = scriptedFetch([{ role: 'assistant', content: 'texto' }]);
    const planner = new LocalOllamaProjectWorkPlanner({
      fetchImpl: impl, executeTool: evidenceTool, maxTurns: 1,
      env: { ANIMA_PROJECT_PLANNER_CONTEXT_LENGTH: '32768' },
    });
    await planner.proposeArguments('faça');
    const body = JSON.parse(String(calls[0]!.init.body)) as { options: { num_ctx: number } };
    expect(body.options.num_ctx).toBe(32_768);
  });

  test.each(['', '0', '-1', '1.5', ' 16384', '16k', '9007199254740992'])(
    'configuração de contexto inválida falha antes da rede: %j', raw => {
      const fetchImpl = jest.fn() as unknown as typeof fetch;
      expect(() => new LocalOllamaProjectWorkPlanner({
        fetchImpl, env: { ANIMA_PROJECT_PLANNER_CONTEXT_LENGTH: raw },
      })).toThrow('ANIMA_PROJECT_PLANNER_CONTEXT_LENGTH');
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  test('histórico subsequente usa o formato nativo de assistant/tool', async () => {
    const { impl, calls } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"AGENTS.md"}')] },
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', VALID_ARGS)] },
    ]);
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool });
    await planner.proposeArguments('faça');
    const second = JSON.parse(String(calls[1]!.init.body)) as { messages: Array<Record<string, unknown>> };
    const assistant = second.messages.find(message => message.role === 'assistant');
    const tool = second.messages.find(message => message.role === 'tool');
    expect(assistant?.tool_calls).toEqual([{
      function: { name: 'project_read_file', arguments: { path: 'AGENTS.md' } },
    }]);
    expect(tool).toMatchObject({ role: 'tool', tool_name: 'project_read_file' });
    expect(tool).not.toHaveProperty('tool_call_id');
  });

  test.each([
    ['JSON malformado', async () => { throw new SyntaxError('bad json'); }],
    ['sem message', async () => ({ done: true })],
    ['sem done terminal', async () => ({ message: { role: 'assistant', content: 'oi' } })],
    ['message vazio', async () => ({ message: { role: 'assistant' }, done: true })],
    ['tool_calls não-array', async () => ({ message: { role: 'assistant', tool_calls: {} }, done: true })],
    ['arguments string', async () => ({ message: { role: 'assistant', tool_calls: [{ type: 'function', function: { name: 'project_read_file', arguments: '{}' } }] }, done: true })],
    ['tool desconhecida', async () => ({ message: { role: 'assistant', tool_calls: [{ type: 'function', function: { name: 'rm_rf', arguments: {} } }] }, done: true })],
  ])('fail-closed para resposta nativa inválida: %s', async (_label, json) => {
    const impl = (async () => ({ ok: true, json })) as unknown as typeof fetch;
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool });
    await expect(planner.proposeArguments('faça')).resolves.toEqual({
      ok: false, message: 'O modelo local não retornou uma resposta utilizável.',
    });
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
    const forcedBody = JSON.parse(String(calls[2]!.init.body)) as { tools: Array<{ function: { name: string } }>; tool_choice?: unknown };
    expect(forcedBody.tools.map(t => t.function.name)).toEqual(['submit_project_work_proposal']);
    expect(forcedBody.tool_choice).toBeUndefined();
  });

  test('não executa tool de investigação emitida fora do catálogo da rodada forçada', async () => {
    const executeTool = jest.fn(evidenceTool);
    const { impl } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"AGENTS.md","start_line":1,"end_line":5}', 'e1')] },
      // A partir daqui só submit foi oferecida. O provider viola o catálogo.
      { role: 'assistant', tool_calls: [toolCall('project_list_files', '{"path":"docs"}', 'bad1')] },
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', VALID_ARGS, 's1')] },
    ]);
    const planner = new LocalOllamaProjectWorkPlanner({
      fetchImpl: impl,
      executeTool,
      forceAfterEvidence: 1,
      maxTurns: 3,
    });

    await expect(planner.proposeArguments('faça')).resolves.toEqual({ ok: true, rawArguments: VALID_ARGS });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith('project_read_file', expect.any(String));
  });

  test('normaliza o quirk escalar→lista do modelo local (sem inventar conteúdo)', async () => {
    const scalarArgs = JSON.stringify({
      summary: 's', objective: 'o',
      included_scope: 'apps/web/x.ts', // string única
      excluded_scope: 'não tocar banco', // string única
      expected_effects: 'efeito único', risks: 'risco único',
      validation_label: 'v', validation_command: 'npm test -- x.test.ts',
      validation_covers: ['efeito único'], additional_validations: [],
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
    const impl = (async () => ({ ok: false, json: async () => ({ error: 'ollama fora' }) })) as unknown as typeof fetch;
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool });
    const result = await planner.proposeArguments('faça');
    expect(result).toEqual({ ok: false, message: 'ollama fora' });
  });

  test('timeout do modelo local é distinguido sem vazar detalhes da requisição', async () => {
    const impl = (async () => {
      const error = new Error('segredo-nao-deve-aparecer');
      error.name = 'TimeoutError';
      throw error;
    }) as unknown as typeof fetch;
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool });
    const result = await planner.proposeArguments('faça');
    expect(result).toEqual({
      ok: false,
      message: 'O planejador local excedeu o tempo limite de 90 segundos em uma rodada do modelo.',
    });
    expect(JSON.stringify(result)).not.toContain('segredo-nao-deve-aparecer');
  });

  test('falha de transporte local permanece sanitizada', async () => {
    const impl = (async () => {
      throw new Error('http://usuario:senha@host-interno');
    }) as unknown as typeof fetch;
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool });
    const result = await planner.proposeArguments('faça');
    expect(result).toEqual({
      ok: false,
      message: 'Não foi possível comunicar com o modelo local durante o planejamento.',
    });
    expect(JSON.stringify(result)).not.toContain('senha');
  });

  test('tool com falha nao conta como evidencia para liberar submit', async () => {
    const failingEvidence = async () => JSON.stringify({ ok: false, error: 'nao encontrado' });

    const { impl } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"AGENTS.md","start_line":1,"end_line":5}')] },
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', VALID_ARGS, 's2')] },
    ]);

    const planner = new LocalOllamaProjectWorkPlanner({
      fetchImpl: impl,
      executeTool: failingEvidence,
      maxTurns: 2,
    });

    const result = await planner.proposeArguments('faça');
    expect(result.ok).toBe(false);
  });

  test('rejeita included_scope inventado em diretorio inexistente', async () => {
    const invented = JSON.stringify({
      summary: 'Nova feature',
      objective: 'Criar feature inventada',
      included_scope: ['src/components/NewFeature.js'],
      excluded_scope: ['src/components/SensitiveData.js'],
      expected_effects: ['feature'],
      risks: ['erro'],
      validation_label: 'tests',
      validation_command: 'npm run test',
      validation_covers: ['feature'], additional_validations: [],
    });

    const { impl } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"AGENTS.md","start_line":1,"end_line":5}')] },
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', invented, 's2')] },
    ]);

    const planner = new LocalOllamaProjectWorkPlanner({
      fetchImpl: impl,
      executeTool: evidenceTool,
      maxTurns: 2,
    });

    const result = await planner.proposeArguments('faça');
    expect(result.ok).toBe(false);
  });

  test('distingue proposal_invalid de included_scope_not_anchored no tool result', async () => {
    const invalidProposal = JSON.stringify({
      ...JSON.parse(VALID_ARGS) as Record<string, unknown>,
      validation_command: 'python test.py',
    });
    const { impl, calls } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"apps/web/cli/args.ts"}')] },
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', invalidProposal)] },
      { role: 'assistant', content: 'vou corrigir' },
    ]);
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool, maxTurns: 3 });
    await planner.proposeArguments('faça');
    const thirdRequest = JSON.parse(String(calls[2]!.init.body)) as { messages: Array<{ role: string; content?: string }> };
    const rejection = JSON.parse(thirdRequest.messages.filter(message => message.role === 'tool').at(-1)!.content!) as {
      error: { code: string; details: { field: string; rule: string } };
    };
    expect(rejection.error).toMatchObject({
      code: 'proposal_invalid',
      details: { field: 'validation_command', rule: 'command_not_allowed' },
    });
  });

  test('fixture semelhante ao submit 14b identifica covers incompatível, não ancoragem', async () => {
    const observedLike = JSON.stringify({
      summary: 'Corrigir argumentos extras da CLI',
      objective: 'Recusar ids extras e reasons ignorados',
      included_scope: ['apps/web/cli/args.ts', 'apps/web/cli/args.test.ts'],
      excluded_scope: ['apps/web/cli/app.ts'],
      expected_effects: ['argumentos extras são recusados', 'formas válidas permanecem'],
      risks: ['regressão no parser'],
      validation_label: 'CLI args',
      validation_command: 'npm test --workspace=apps/web -- cli/args.test.ts',
      validation_covers: ['testes passam'],
      validation_claim_kind: 'substantive',
      validation_target_paths: ['apps/web/cli/args.ts', 'apps/web/cli/args.test.ts'],
      max_attempts: 1,
      additional_validations: [],
    });
    const { impl, calls } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"apps/web/cli/args.ts"}')] },
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', observedLike)] },
      { role: 'assistant', content: 'vou corrigir' },
    ]);
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool, maxTurns: 3 });
    await planner.proposeArguments('faça');
    const request = JSON.parse(String(calls[2]!.init.body)) as { messages: Array<{ role: string; content?: string }> };
    const rejection = JSON.parse(request.messages.filter(message => message.role === 'tool').at(-1)!.content!) as {
      error: { code: string; details: { field: string; rule: string }; message: string };
    };
    expect(rejection.error).toMatchObject({
      code: 'proposal_invalid',
      details: { field: 'validation_covers', rule: 'unknown_criterion' },
    });
    expect(rejection.error.message).not.toContain('included_scope_not_anchored');
  });

  test('proposal válida com path inexistente retorna somente included_scope_not_anchored e lista o path', async () => {
    const path = 'apps/web/inexistente/em-dois-niveis/arquivo.ts';
    const proposal = JSON.stringify({ ...JSON.parse(VALID_ARGS) as Record<string, unknown>, included_scope: [path] });
    const { impl, calls } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"AGENTS.md"}')] },
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', proposal)] },
      { role: 'assistant', content: 'vou corrigir' },
    ]);
    const planner = new LocalOllamaProjectWorkPlanner({ fetchImpl: impl, executeTool: evidenceTool, maxTurns: 3 });
    await planner.proposeArguments('faça');
    const request = JSON.parse(String(calls[2]!.init.body)) as { messages: Array<{ role: string; content?: string }> };
    const rejection = JSON.parse(request.messages.filter(message => message.role === 'tool').at(-1)!.content!) as {
      error: { code: string; details: { paths: string[] } };
    };
    expect(rejection.error).toMatchObject({ code: 'included_scope_not_anchored', details: { paths: [path] } });
  });

  test('aceita arquivo novo quando o diretorio-pai real existe', async () => {
    const newFile = JSON.stringify({
      summary: 'Diagnostico',
      objective: 'Adicionar diagnostico',
      included_scope: ['apps/web/lib/ai/new-planner-diagnostic.ts'],
      excluded_scope: ['apps/web/lib/ai/project-work-planner-openai.ts'],
      expected_effects: ['diagnostico'],
      risks: ['baixo'],
      validation_label: 'tests',
      validation_command: 'npm run test',
      validation_covers: ['diagnostico'], additional_validations: [],
    });

    const { impl } = scriptedFetch([
      { role: 'assistant', tool_calls: [toolCall('project_read_file', '{"path":"AGENTS.md","start_line":1,"end_line":5}')] },
      { role: 'assistant', tool_calls: [toolCall('submit_project_work_proposal', newFile, 's2')] },
    ]);

    const planner = new LocalOllamaProjectWorkPlanner({
      fetchImpl: impl,
      executeTool: evidenceTool,
      maxTurns: 2,
    });

    const result = await planner.proposeArguments('faça');
    expect(result.ok).toBe(true);
  });});
