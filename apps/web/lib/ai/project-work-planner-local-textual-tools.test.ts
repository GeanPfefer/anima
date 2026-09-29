/** @jest-environment node */
import { LocalOllamaProjectWorkPlanner, parseTextualToolCalls, resolveLocalPlannerRoundTimeoutMs } from './project-work-planner-local';

// Formato nativo observado AO VIVO (qwen3-coder:30b via Ollama, 2026-09-25): a chamada vem
// no `content` e `tool_calls` fica vazio.
const nativeText = (name: string, params: Record<string, string>) =>
  `Vou investigar.\n\n<function=${name}>\n${Object.entries(params).map(([k, v]) => `<parameter=${k}>\n${v}\n</parameter>`).join('\n')}\n</function>\n</tool_call>`;

const VALID = {
  summary: 'Ajuste', objective: 'Objetivo',
  included_scope: '["apps/web/lib/ai/project-work-planner.ts"]',
  excluded_scope: '["Não alterar banco"]', expected_effects: '["gate verde"]', risks: '["variância"]',
  validation_label: 'coder-backend', validation_command: 'npm test -- coder-backend.test.ts',
  validation_covers: '["gate verde"]', additional_validations: '[]',
};
const known = new Set(['project_search', 'project_read_file', 'project_git_status', 'submit_project_work_proposal']);

describe('parseTextualToolCalls', () => {
  test('converte a chamada textual do qwen3-coder em tool call estruturada', () => {
    const calls = parseTextualToolCalls(nativeText('project_read_file', { path: 'apps/web/scripts/x.ts', start_line: '1', end_line: '40' }), known);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.function!.name).toBe('project_read_file');
    expect(JSON.parse(String(calls[0]!.function!.arguments))).toEqual({ path: 'apps/web/scripts/x.ts', start_line: 1, end_line: 40 });
  });
  test('ignora ferramentas desconhecidas e texto sem chamadas', () => {
    expect(parseTextualToolCalls(nativeText('rm_rf', { path: '/' }), known)).toEqual([]);
    expect(parseTextualToolCalls('só conversa', known)).toEqual([]);
    expect(parseTextualToolCalls(null, known)).toEqual([]);
  });
  test('listas JSON viram listas; texto não-JSON permanece texto', () => {
    const calls = parseTextualToolCalls(nativeText('submit_project_work_proposal', VALID), known);
    const args = JSON.parse(String(calls[0]!.function!.arguments));
    expect(args.included_scope).toEqual(['apps/web/lib/ai/project-work-planner.ts']);
    expect(args.validation_command).toBe('npm test -- coder-backend.test.ts');
  });
  test('aceita Hermes/JSON puro observado no qwen2.5-coder:14b', () => {
    const calls = parseTextualToolCalls('{"name":"project_search","arguments":{"path":"apps/web/cli","query":"work approve"}}', known);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.function!.name).toBe('project_search');
    expect(JSON.parse(String(calls[0]!.function!.arguments))).toEqual({ path: 'apps/web/cli', query: 'work approve' });
  });
  test('aceita Hermes/JSON em fence json, argumentos aninhados e outra ferramenta conhecida', () => {
    const calls = parseTextualToolCalls('```json\n{"name":"project_git_status","arguments":{"options":{"short":true}}}\n```', known);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.function!.name).toBe('project_git_status');
    expect(JSON.parse(String(calls[0]!.function!.arguments))).toEqual({ options: { short: true } });
  });
  test.each([
    ['ferramenta desconhecida', '{"name":"rm_rf","arguments":{}}'],
    ['JSON malformado', '{"name":"project_search","arguments":{'],
    ['arguments string', '{"name":"project_search","arguments":"x"}'],
    ['arguments array', '{"name":"project_search","arguments":[]}'],
    ['arguments null', '{"name":"project_search","arguments":null}'],
    ['name ausente', '{"arguments":{}}'],
    ['arguments ausente', '{"name":"project_search"}'],
    ['array arbitrário', '[{"name":"project_search","arguments":{}}]'],
    ['JSON incidental em prosa', 'Vou usar {"name":"project_search","arguments":{}} agora.'],
    ['fence não fechada', '```json\n{"name":"project_search","arguments":{}}'],
    ['conteúdo extra após fence', '```json\n{"name":"project_search","arguments":{}}\n```\npronto'],
    ['múltiplos objetos', '{"name":"project_search","arguments":{}}\n{"name":"project_git_status","arguments":{}}'],
    ['payload extra', '{"name":"project_search","arguments":{},"extra":true}'],
  ])('rejeita Hermes ambíguo ou inválido: %s', (_label, content) => {
    expect(parseTextualToolCalls(content, known)).toEqual([]);
  });
});

describe('LocalOllamaProjectWorkPlanner com chamadas textuais', () => {
  test('investiga e submete pelo formato textual até a proposta terminal', async () => {
    const replies = [
      nativeText('project_read_file', { path: 'AGENTS.md', start_line: '1', end_line: '5' }),
      nativeText('submit_project_work_proposal', VALID),
    ];
    let i = 0;
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: replies[Math.min(i++, 1)] } }] }) })) as unknown as typeof fetch;
    const tools: string[] = [];
    const planner = new LocalOllamaProjectWorkPlanner({
      fetchImpl, executeTool: async name => { tools.push(name); return JSON.stringify({ ok: true, result: { text: 'evidência' } }); },
    });
    const result = await planner.proposeArguments('faça');
    expect(tools).toEqual(['project_read_file']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.rawArguments).included_scope).toEqual(['apps/web/lib/ai/project-work-planner.ts']);
  });
  test('executa a chamada Hermes observada e mantém validação posterior fail-closed', async () => {
    const replies = [
      '{"name":"project_search","arguments":{"path":"apps/web/cli","query":"work approve"}}',
      JSON.stringify({ name: 'submit_project_work_proposal', arguments: { summary: 'incompleta' } }),
      'sem chamada',
      'sem chamada',
      'sem chamada',
    ];
    let i = 0;
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: replies[Math.min(i++, replies.length - 1)] } }] }) })) as unknown as typeof fetch;
    const tools: Array<{ name: string; args: unknown }> = [];
    const planner = new LocalOllamaProjectWorkPlanner({
      fetchImpl,
      executeTool: async (name, rawArguments) => {
        tools.push({ name, args: JSON.parse(rawArguments) });
        return JSON.stringify({ ok: true, result: { matches: [] } });
      },
    });
    const result = await planner.proposeArguments('faça');
    expect(tools).toEqual([{ name: 'project_search', args: { path: 'apps/web/cli', query: 'work approve' } }]);
    expect(result.ok).toBe(false);
  });
});

describe('resolveLocalPlannerRoundTimeoutMs', () => {
  test('default histórico, faixa limitada e fail-safe', () => {
    expect(resolveLocalPlannerRoundTimeoutMs({})).toBe(90_000);
    expect(resolveLocalPlannerRoundTimeoutMs({ ANIMA_PROJECT_PLANNER_ROUND_TIMEOUT_MS: '240000' })).toBe(240_000);
    expect(resolveLocalPlannerRoundTimeoutMs({ ANIMA_PROJECT_PLANNER_ROUND_TIMEOUT_MS: '5' })).toBe(90_000);
    expect(resolveLocalPlannerRoundTimeoutMs({ ANIMA_PROJECT_PLANNER_ROUND_TIMEOUT_MS: '9999999' })).toBe(90_000);
    expect(resolveLocalPlannerRoundTimeoutMs({ ANIMA_PROJECT_PLANNER_ROUND_TIMEOUT_MS: 'x' })).toBe(90_000);
  });
});
