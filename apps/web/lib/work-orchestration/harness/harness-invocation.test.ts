/** @jest-environment node */
import {
  HARNESS_OLLAMA_API_KEY_ENV,
  buildHarnessPatchYaml,
  planHarnessInvocation,
  pluginFileUrl,
  type HarnessInvocationInput,
} from './harness-invocation';

const base = (over: Partial<HarnessInvocationInput> = {}): HarnessInvocationInput => ({
  worktreeRoot: 'C:/tmp/anima-wt/tree',
  dshHome: 'C:/tmp/anima-wt/dsh-home',
  patchPath: 'C:/tmp/anima-wt/patch.yml',
  pluginPath: 'G:/anima/apps/web/lib/work-orchestration/harness/anima-harness-plugin.mjs',
  objective: 'Corrigir o projector',
  model: 'qwen3-coder:latest',
  ollamaBaseUrl: 'http://127.0.0.1:11434/v1',
  temperature: 0,
  stepBudget: 12,
  permissionMode: 'workspace-write',
  disableStrReplaceEditor: true,
  ...over,
});

describe('pluginFileUrl', () => {
  test('Windows: G:\\a\\b → file:///G:/a/b', () => {
    expect(pluginFileUrl('G:\\anima\\x.mjs')).toBe('file:///G:/anima/x.mjs');
  });
  test('posix: /a/b → file:///a/b', () => {
    expect(pluginFileUrl('/opt/anima/x.mjs')).toBe('file:///opt/anima/x.mjs');
  });
});

describe('buildHarnessPatchYaml — formato verificado ao vivo', () => {
  test('rota pi-ai→Ollama, override de modelo, disable de str_replace, bare-insert do plugin', () => {
    const yaml = buildHarnessPatchYaml(base());
    // Rota pi-ai openai-completions para o Ollama local.
    expect(yaml).toContain('- id: llm-pi-ai');
    expect(yaml).toContain('ollama:');
    expect(yaml).toContain('api: openai-completions');
    expect(yaml).toContain(`apiKeyEnv: ${HARNESS_OLLAMA_API_KEY_ENV}`);
    expect(yaml).toContain("baseURL: 'http://127.0.0.1:11434/v1'");
    // Override do modelo default (era o cloud deepseek-official).
    expect(yaml).toContain('- id: agent-default-model');
    expect(yaml).toContain('provider: ollama');
    expect(yaml).toContain("model: 'qwen3-coder:latest'");
    // str_replace_editor desabilitado.
    expect(yaml).toContain('- id: tool-str-replace-editor');
    expect(yaml).toContain('disabled: true');
    // bare-insert (sem id-âncora) carregando o plugin versionado por file:// URL.
    expect(yaml).toContain('- insert:');
    expect(yaml).toContain('- id: anima-harness-budget');
    expect(yaml).toContain("name: 'file:///G:/anima/apps/web/lib/work-orchestration/harness/anima-harness-plugin.mjs'");
    expect(yaml).toContain('stepBudget: 12');
    expect(yaml).toContain('temperature: 0');
  });

  test('str_replace_editor NÃO é desabilitado quando disableStrReplaceEditor=false', () => {
    const yaml = buildHarnessPatchYaml(base({ disableStrReplaceEditor: false }));
    expect(yaml).not.toContain('tool-str-replace-editor');
    // o insert e a rota continuam presentes
    expect(yaml).toContain('- insert:');
    expect(yaml).toContain('- id: agent-default-model');
  });

  test('marcador opcional entra na config do plugin quando presente', () => {
    const yaml = buildHarnessPatchYaml(base({ pluginMarkerPath: 'C:/tmp/marker.txt' }));
    expect(yaml).toContain("marker: 'C:/tmp/marker.txt'");
  });

  test('orçamento e temperature configuráveis refletem na config do plugin', () => {
    const yaml = buildHarnessPatchYaml(base({ stepBudget: 6, temperature: 0.2 }));
    expect(yaml).toContain('stepBudget: 6');
    expect(yaml).toContain('temperature: 0.2');
  });
});

describe('planHarnessInvocation — args e env', () => {
  test('args: --profile headless --patch <path> <objetivo> (objetivo é arg, sem shell)', () => {
    const plan = planHarnessInvocation(base());
    expect(plan.args).toEqual(['--profile', 'headless', '--patch', 'C:/tmp/anima-wt/patch.yml', 'Corrigir o projector']);
  });

  test('env: DSH_HOME isolado, telemetria DISABLED, workspace-write, chave dummy do Ollama; sem chave de nuvem', () => {
    const plan = planHarnessInvocation(base());
    expect(plan.env.DSH_HOME).toBe('C:/tmp/anima-wt/dsh-home');
    expect(plan.env.DSH_TELEMETRY_MODE).toBe('DISABLED');
    expect(plan.env.DSH_PERMISSION_MODE).toBe('workspace-write');
    expect(plan.env[HARNESS_OLLAMA_API_KEY_ENV]).toBe('ollama-local-nokey');
    expect(plan.env).not.toHaveProperty('DEEPSEEK_API_KEY');
    expect(plan.env).not.toHaveProperty('OPENAI_API_KEY');
  });
});

describe('planHarnessInvocation — envelope fail-closed', () => {
  test('recusa modo de permissão fora do envelope', () => {
    expect(() => planHarnessInvocation(base({ permissionMode: 'danger-full-access' as never })))
      .toThrow(/workspace-write/);
    expect(() => planHarnessInvocation(base({ permissionMode: 'read-only' as never })))
      .toThrow(/workspace-write/);
  });

  test('recusa caminhos não absolutos', () => {
    expect(() => planHarnessInvocation(base({ worktreeRoot: 'relativo/tree' }))).toThrow(/worktreeRoot/);
    expect(() => planHarnessInvocation(base({ dshHome: './home' }))).toThrow(/dshHome/);
    expect(() => planHarnessInvocation(base({ pluginPath: 'x.mjs' }))).toThrow(/pluginPath/);
  });

  test('recusa objetivo/modelo em branco, baseURL não-http, orçamento inválido', () => {
    expect(() => planHarnessInvocation(base({ objective: '   ' }))).toThrow(/objetivo/);
    expect(() => planHarnessInvocation(base({ model: '' }))).toThrow(/modelo/);
    expect(() => planHarnessInvocation(base({ ollamaBaseUrl: 'ftp://x' }))).toThrow(/baseURL/);
    expect(() => planHarnessInvocation(base({ stepBudget: 0 }))).toThrow(/orçamento/);
  });
});
