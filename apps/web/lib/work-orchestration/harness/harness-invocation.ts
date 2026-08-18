// ============================================================
// Planejador PURO da invocação do subprocesso do DeepSeek Harness (ligação viva,
// recorte experimental — ver docs/arquitetura/deepseek-harness-coder-backend.md).
//
// Constrói, de forma determinística e testável, EXATAMENTE a linha de comando, o
// overlay `--patch` (cordis) e o ambiente que foram VERIFICADOS ao vivo contra o
// `dsh` 0.1.0-rc.7 instalado (Ollama local + qwen3-coder). Não faz I/O: o driver
// (`deepseek-harness-runtime`) escreve o patch, cria o `$DSH_HOME` isolado e
// spawna o filho. Separar o plano (puro, testado) do spawn (I/O) espelha o padrão
// do Anima (core puro + I/O injetado).
//
// Envelope de segurança (ratificado, recorte experimental): sandbox
// `workspace-write`; cwd = worktree isolado; rede off para o coder (telemetria
// OTEL DESABILITADA por env — o único URL externo do profile —, sem chaves de API
// de nuvem, `approval: ask` do default nega escalonamento); sem `danger-full-access`.
// Qualquer configuração fora do envelope FALHA FECHADA aqui (lança), nunca degrada
// para um modo mais permissivo em silêncio.
// ============================================================

/** Rota fixa do provider pi-ai apontada para o Ollama local (protocolo
 * openai-completions). A chave é dummy: o endpoint OpenAI-compat do Ollama exige
 * o campo mas ignora o valor. NÃO é credencial de nuvem. */
export const HARNESS_OLLAMA_ROUTE = 'ollama';
export const HARNESS_OLLAMA_API_KEY_ENV = 'OLLAMA_API_KEY';
export const HARNESS_OLLAMA_API_KEY_DUMMY = 'ollama-local-nokey';

/** Único modo de permissão permitido pelo envelope. `danger-full-access` e
 * `read-only` são recusados: o coder precisa escrever no worktree e nada além. */
export type HarnessPermissionMode = 'workspace-write';

export interface HarnessInvocationInput {
  /** Raiz absoluta do worktree isolado — o cwd (confinamento do sandbox). */
  readonly worktreeRoot: string;
  /** `$DSH_HOME` isolado desta execução (as sessões JSONL vivem sob ele). */
  readonly dshHome: string;
  /** Caminho absoluto onde o driver ESCREVERÁ o YAML do `--patch`. */
  readonly patchPath: string;
  /** Caminho absoluto do plugin cordis versionado (`anima-harness-plugin.mjs`). */
  readonly pluginPath: string;
  /** Texto da tarefa (vai como ARG do CLI, sem shell — sem injeção). */
  readonly objective: string;
  /** Modelo Ollama, ex.: 'qwen3-coder:latest'. */
  readonly model: string;
  /** Endpoint OpenAI-compat do Ollama, ex.: 'http://127.0.0.1:11434/v1'. */
  readonly ollamaBaseUrl: string;
  /** temperature host-controlada (POC: 0 estabiliza tool calls). */
  readonly temperature: number;
  /** Orçamento de passos aplicado pelo plugin no hook `agent/pre-step`. */
  readonly stepBudget: number;
  /** Envelope: só `workspace-write`. Qualquer outro valor falha fechada. */
  readonly permissionMode: HarnessPermissionMode;
  /** Desabilita o plugin `tool-str-replace-editor` (default do POC no Windows). */
  readonly disableStrReplaceEditor: boolean;
  /** Marcador de saúde opcional: caminho onde o plugin comprova que carregou. */
  readonly pluginMarkerPath?: string;
}

export interface HarnessInvocationPlan {
  /** Args para o binário `dsh` (o driver spawna `node <dshBin> ...args`). */
  readonly args: readonly string[];
  /** Conteúdo YAML do overlay `--patch` (o driver escreve em `patchPath`). */
  readonly patchYaml: string;
  /** Variáveis de ambiente do filho (mescladas sobre um ambiente mínimo). */
  readonly env: Readonly<Record<string, string>>;
}

const isAbsWin = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/');
const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Converte um caminho absoluto num `file://` URL que o loader de plugins do
 * cordis resolve (verificado ao vivo). No Windows: `G:\a\b` → `file:///G:/a/b`. */
export function pluginFileUrl(absPath: string): string {
  const forward = absPath.replace(/\\/g, '/');
  return forward.startsWith('/') ? `file://${forward}` : `file:///${forward}`;
}

/** Cita um escalar YAML entre aspas simples, escapando aspas simples (dobrando). */
const yamlSingle = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/**
 * Gera o overlay `--patch` EXATO verificado ao vivo: rota pi-ai→Ollama, override
 * do modelo default, desabilitação opcional do `str_replace_editor` e o
 * bare-`insert` que carrega o plugin versionado (temperature + step budget).
 */
export function buildHarnessPatchYaml(input: HarnessInvocationInput): string {
  const budget = input.stepBudget;
  const lines: string[] = [
    `- id: llm-pi-ai`,
    `  config:`,
    `    providers:`,
    `      ${HARNESS_OLLAMA_ROUTE}:`,
    `        displayName: Ollama Local`,
    `        apiKeyEnv: ${HARNESS_OLLAMA_API_KEY_ENV}`,
    `        api: openai-completions`,
    `        baseURL: ${yamlSingle(input.ollamaBaseUrl)}`,
    `        models:`,
    `          - id: ${yamlSingle(input.model)}`,
    `            name: Harness Coder`,
    `            contextWindow: 262144`,
    `            maxTokens: 32768`,
    `- id: agent-default-model`,
    `  config:`,
    `    provider: ${HARNESS_OLLAMA_ROUTE}`,
    `    model: ${yamlSingle(input.model)}`,
  ];
  if (input.disableStrReplaceEditor) {
    lines.push(`- id: tool-str-replace-editor`, `  disabled: true`);
  }
  lines.push(
    `- insert:`,
    `    - id: anima-harness-budget`,
    `      name: ${yamlSingle(pluginFileUrl(input.pluginPath))}`,
    `      config:`,
    `        stepBudget: ${budget}`,
    `        temperature: ${input.temperature}`,
  );
  if (nonBlank(input.pluginMarkerPath)) {
    lines.push(`        marker: ${yamlSingle(input.pluginMarkerPath)}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Planeja a invocação completa. Fail-closed: recusa modo de permissão fora do
 * envelope, caminhos não absolutos ou campos em branco — nunca produz um plano
 * que rode o Harness sem confinamento.
 */
export function planHarnessInvocation(input: HarnessInvocationInput): HarnessInvocationPlan {
  if (input.permissionMode !== 'workspace-write') {
    throw new Error(`Envelope: modo de permissão "${String(input.permissionMode)}" recusado; só workspace-write é permitido.`);
  }
  for (const [label, value] of [
    ['worktreeRoot', input.worktreeRoot], ['dshHome', input.dshHome],
    ['patchPath', input.patchPath], ['pluginPath', input.pluginPath],
  ] as const) {
    if (!nonBlank(value) || !isAbsWin(value)) throw new Error(`Envelope: ${label} precisa ser um caminho absoluto (recebido: ${String(value)}).`);
  }
  if (!nonBlank(input.objective)) throw new Error('A invocação do Harness exige um objetivo não vazio.');
  if (!nonBlank(input.model)) throw new Error('A invocação do Harness exige um modelo.');
  if (!/^https?:\/\//.test(input.ollamaBaseUrl)) throw new Error('A baseURL do Ollama precisa ser http(s).');
  if (!Number.isInteger(input.stepBudget) || input.stepBudget < 1) throw new Error('O orçamento de passos precisa ser um inteiro >= 1.');
  if (typeof input.temperature !== 'number' || !Number.isFinite(input.temperature)) throw new Error('temperature precisa ser um número finito.');

  const args: string[] = ['--profile', 'headless', '--patch', input.patchPath, input.objective];

  // Ambiente do filho: DSH_HOME isolado; telemetria OTEL DESABILITADA (o único
  // URL externo do profile — trava rede); modo de permissão do envelope; chave
  // dummy do Ollama (o endpoint exige o campo, ignora o valor). Nenhuma chave de
  // nuvem (DEEPSEEK_API_KEY/etc.) é injetada — escalonamento fica sem credencial.
  const env: Record<string, string> = {
    DSH_HOME: input.dshHome,
    DSH_TELEMETRY_MODE: 'DISABLED',
    DSH_PERMISSION_MODE: input.permissionMode,
    [HARNESS_OLLAMA_API_KEY_ENV]: HARNESS_OLLAMA_API_KEY_DUMMY,
  };

  return { args, patchYaml: buildHarnessPatchYaml(input), env };
}
