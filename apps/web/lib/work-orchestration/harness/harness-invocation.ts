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

/**
 * Timeout de OCIOSIDADE do stream do LLM (ms) que o HOST impõe à rota pi-ai.
 *
 * Prova de fio (proxy dsh↔Ollama, evidência viva): quando o modelo local emite
 * tool calls e o endpoint openai-completions do Ollama NÃO envia o chunk
 * terminador (`finish_reason`/`[DONE]`), o `idleWatchdog` do pi-ai só aborta no
 * default de 300000ms — o turno fica pendurado sem estado terminal observável. O
 * host reduz esse teto para um valor CONSERVADOR: acima de qualquer geração
 * legítima (inclusive a espera do PRIMEIRO chunk, que na prática inclui o load a
 * frio do modelo — o `idleWatchdog` arma o timer antes de aguardar o 1º chunk),
 * porém bem abaixo dos 300s. Assim um stream travado vira uma FALHA TERMINAL
 * LIMPA e diagnosticável (`LlmError TIMEOUT` ⇒ saída não-zero ⇒ o runtime
 * classifica `error` com diagnóstico), nunca um pendura silencioso. Não afrouxa
 * gate algum nem acelera um protocolo que já funciona: só delimita o stall.
 */
export const HARNESS_DEFAULT_STREAM_IDLE_TIMEOUT_MS = 180_000;

/**
 * Códigos de erro do LLM que o `dsh-llm-retry` deve RETENTAR na rota do coder.
 *
 * O default do dsh inclui `TIMEOUT` — e o retry re-emite a MESMA request. Prova
 * viva: o stall do Ollama (stream sem `finish_reason`) é DETERMINÍSTICO por prompt
 * (temperature 0); retentá-lo só multiplica o atraso por `(maxRetries+1)` e adia a
 * captura do desfecho, sem nunca convergir (o retry interno NÃO perturba o prompt —
 * quem reprocessa com contexto novo é o HOST). Removemos `TIMEOUT` do conjunto: um
 * stream ocioso vira falha terminal LIMPA e imediata (o host observa `error` +
 * diagnóstico), enquanto erros genuinamente transitórios (transporte/servidor/rate
 * limit/resposta vazia) seguem sendo retentados. Confirmado ao vivo: com esta lista
 * o `dsh` sai com código 1 em ~idle e stderr `TIMEOUT: pi-ai stream idle timeout`.
 */
export const HARNESS_DEFAULT_RETRYABLE_LLM_CODES: readonly string[] = [
  'EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TRANSPORT',
];

/**
 * Plugins DISTRATORES desabilitados por default no perfil focado do coder local —
 * cada um com PROVA VIVA de que derrapa o modelo local (qwen3-coder). Configurável;
 * NÃO é regra universal — um modelo forte pode preferir o catálogo cheio.
 *
 * (1) Ferramentas distratoras (correção da lacuna de tool-protocol): o profile
 * headless oferece 24 ferramentas; com as 24 o modelo chamou `web_search`/`update_goal`
 * alucinando tarefas alheias; com o catálogo FOCADO (edit/glob/grep/pwsh/read/
 * read_image/write) chamou `write` e concluiu a tarefa. Não é o transporte (as
 * `tool_calls` já vinham estruturadas do Ollama): é a SELEÇÃO — reduzir o catálogo
 * refoca o modelo. Espelha a config vencedora do POC (só ferramentas de arquivo/shell).
 *
 * (2) `agent-instructions` (injeção de contexto de repo): esse plugin do headless lê
 * AGENTS.md/CLAUDE.md/README.md do workspace (até 64KB) e os injeta como instruções.
 * O worktree do coder é um checkout do repo Anima inteiro, cujo AGENTS.md é um ROTEADOR
 * humano ("Antes de qualquer tarefa, leia…"). PROVA VIVA (cwd idêntico, só a presença
 * dos docs muda): com AGENTS.md/CLAUDE.md o qwen3-coder abandonou a tarefa e respondeu
 * "identifiquei arquivos de documentação; o que você gostaria que eu fizesse?" (0 edições);
 * desabilitando o plugin, criou o arquivo pedido e concluiu. O host já entrega objetivo,
 * escopo e restrições EXPLICITAMENTE via composeHarnessTask — o coder focado não precisa
 * dos docs de onboarding do repo, e um modelo pequeno se perde neles.
 */
export const HARNESS_FOCUSED_DISABLED_PLUGINS: readonly string[] = [
  'tool-web', 'tool-goal', 'tool-ralph',
  'tool-subagent', 'tool-subagent-fork', 'tool-subagent-control',
  'tool-subagent-list-agents', 'tool-subagent-report',
  'tool-workflow', 'tool-todo', 'tool-skill', 'plan-mode', 'tool-jobs',
  'agent-instructions',
];

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
  /**
   * Timeout de ociosidade do stream (ms) escrito na rota pi-ai. Opcional: quando
   * ausente, a rota herda o default do pi-ai (300000ms). O runtime sempre injeta
   * `HARNESS_DEFAULT_STREAM_IDLE_TIMEOUT_MS` para não depender desse default.
   */
  readonly streamIdleTimeoutMs?: number;
  /**
   * Conjunto de códigos retentáveis do `dsh-llm-retry` na rota (mode `normal`).
   * Substitui o default do dsh — o runtime injeta `HARNESS_DEFAULT_RETRYABLE_LLM_CODES`
   * (sem `TIMEOUT`) para o stall determinístico virar falha terminal imediata. Ausente
   * ⇒ o retry usa o default do dsh (que retenta TIMEOUT). Lista vazia ⇒ não retenta nada.
   */
  readonly llmRetryableCodes?: readonly string[];
  /** Orçamento de passos aplicado pelo plugin no hook `agent/pre-step`. */
  readonly stepBudget: number;
  /** Envelope: só `workspace-write`. Qualquer outro valor falha fechada. */
  readonly permissionMode: HarnessPermissionMode;
  /** Desabilita o plugin `tool-str-replace-editor` (default do POC no Windows). */
  readonly disableStrReplaceEditor: boolean;
  /**
   * IDs de plugins de ferramenta distratores a desabilitar (catálogo focado). Ver
   * `HARNESS_FOCUSED_DISABLED_PLUGINS` — a correção com prova viva. Vazio mantém as
   * 24 ferramentas do profile (derrapa modelo local).
   */
  readonly disabledToolPlugins: readonly string[];
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
  ];
  // Teto de ociosidade do stream imposto pelo host (prova de fio: stall do Ollama
  // sem finish_reason). Sibling de `models`/`baseURL` no perfil da rota pi-ai.
  if (input.streamIdleTimeoutMs !== undefined) {
    lines.push(`        streamIdleTimeoutMs: ${input.streamIdleTimeoutMs}`);
  }
  // Política de retry do dsh-llm-retry na rota (schema validado ao vivo): mode
  // `normal` + a lista de códigos retentáveis do host. Removendo `TIMEOUT`, o stall
  // determinístico do Ollama NÃO é retentado internamente e falha terminal na hora.
  if (input.llmRetryableCodes !== undefined) {
    lines.push(
      `        retryPolicy:`,
      `          mode: normal`,
      `          retryableCodes:`,
      ...input.llmRetryableCodes.map(code => `            - ${code}`),
    );
  }
  lines.push(
    `        models:`,
    `          - id: ${yamlSingle(input.model)}`,
    `            name: Harness Coder`,
    `            contextWindow: 262144`,
    `            maxTokens: 32768`,
    `- id: agent-default-model`,
    `  config:`,
    `    provider: ${HARNESS_OLLAMA_ROUTE}`,
    `    model: ${yamlSingle(input.model)}`,
  );
  // Catálogo FOCADO (correção com prova viva): desabilita os plugins de ferramenta
  // distratores para o modelo local não se derrapar. `tool-str-replace-editor` é
  // desabilitado só uma vez (dedup) quando também presente na lista.
  const disabled = new Set<string>(input.disabledToolPlugins);
  if (input.disableStrReplaceEditor) disabled.add('tool-str-replace-editor');
  for (const pluginId of disabled) {
    lines.push(`- id: ${pluginId}`, `  disabled: true`);
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
  if (input.streamIdleTimeoutMs !== undefined
    && (!Number.isInteger(input.streamIdleTimeoutMs) || input.streamIdleTimeoutMs < 1)) {
    throw new Error('streamIdleTimeoutMs precisa ser um inteiro de milissegundos >= 1.');
  }
  if (input.llmRetryableCodes !== undefined
    && (!Array.isArray(input.llmRetryableCodes)
      || input.llmRetryableCodes.some(code => !nonBlank(code) || /[\r\n]/.test(code)))) {
    throw new Error('llmRetryableCodes precisa ser uma lista de códigos não vazios de uma linha.');
  }

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
