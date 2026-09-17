import {
  availableRuntimeActions,
  deriveSubmitGateState,
  isPathReadable,
  isSubmitAvailable,
  renderCoderHarnessPolicyInstructions,
  resolveAgenticRuntimePolicy,
  resolveCommandExecution,
  workspaceAccessPolicyFromIncludedScope,
  type AgenticRuntimePolicyV1,
  type CommandExecutionPolicyV1,
  type RuntimeAction,
  type SubmitGateStateV1,
  type WorkspaceAccessPolicyV1,
} from '@anima/core';
import { OllamaTranscript } from './ollama-transcript';
import { coderBackendId, type CoderBackend, type CoderEditRequest, type CoderEditResult, type CoderWorkspace, type WorkspaceExecResult, type WorkspaceSearchHit } from './coder-backend';
import {
  applyExperimentalAnchorOperations,
  createServedAnchor,
  parseExperimentalAnchorOperations,
  type ServedAnchor,
} from './ollama-anchor-experiment';
import {
  OllamaProtocolError,
  applyEditOperations,
  assertNotTruncated,
  assertPromptWithinBudget,
  buildManifest,
  callOllamaChat,
  parseEditOperations,
  parseExecRequest,
  parseGlobRequest,
  parseProtocolResponse,
  parseReadRequests,
  parseSearchRequest,
  resolveContextBudget,
  serveReadRequests,
  sha256,
  writeChangeSet,
  type ContextBudget,
  type ManifestInputFile,
  type OllamaChatResult,
  type PathMembership,
  type ServedRead,
} from './ollama-protocol';

// ============================================================
// Backend de código LOCAL (Ollama) por trás de CoderBackend (ADR-001).
//
// NÃO usa mais round-trip de conteúdo integral — provado inviável: um prompt com
// 4 docs (~73k tokens) foi truncado para ~4k pelo num_ctx=8192, o system prompt
// se perdeu e o modelo devolveu JSON de schema errado. Reemitir arquivos inteiros
// é lento e frágil mesmo quando o contexto cabe.
//
// Em vez disso, um PROTOCOLO LIMITADO em duas fases (ver ollama-protocol.ts):
//   Fase 1 (leitura): o modelo recebe só o MANIFESTO (caminhos, tamanho, sha256,
//     estrutura) e pede TRECHOS numerados, por um número pequeno de rodadas.
//   Fase 2 (edição): o modelo devolve OPERAÇÕES exatas (replace_exact/create_file)
//     verificadas por sha256, ocorrência única e não-sobreposição; o host aplica
//     só na worktree isolada. Nada de arquivo completo entra ou sai.
//
// Confinamento: as guardas de path do worktree ainda valem por cima; o resultado
// sempre vai para revisão humana (nunca merge/push/apply).
// ============================================================

export interface OllamaCoderOptions {
  readonly model: string;
  readonly url?: string;
  /** Identidade observada; ausente preserva `ollama:<model>`. */
  readonly backendId?: string;
  readonly locality?: 'local' | 'remote';
  readonly nodeId?: string | null;
  /** Seleção governada de modelo (downgrade observável) quando o preferido não coube;
   * anexada à observação do backend para fluir à evidência host-observed do coder. */
  readonly modelSelection?: import('@anima/core').CoderModelSelectionEvidenceV1;
  readonly timeoutMs?: number;
  /** Injeção para teste; por padrão o fetch global. */
  readonly fetchImpl?: typeof fetch;
  /** Teto conservador de num_ctx (nunca ultrapassado). O protocolo mantém os
   * prompts pequenos, então NÃO se cresce a janela sem limite. */
  readonly operationalContextCap?: number;
  readonly outputReserveTokens?: number;
  readonly numPredict?: number;
  /**
   * Rodadas máximas de leitura antes de exigir edição. LEGADO: quando
   * `agenticRuntimePolicy` está presente, ela tem precedência. Preservado para os
   * callers históricos e testes que só ajustam as rodadas.
   */
  readonly maxReadRounds?: number;
  /**
   * Política do laço agêntico (Coding Harness V3): orçamento de leituras servidas
   * por rodada, rodadas máximas e teto de leituras por sessão. Ausente ⇒ um perfil
   * local conservador (comportamento numérico histórico) é resolvido a partir do
   * `maxReadRounds` legado. Um backend forte (ex.: OpenAI) injeta o perfil remoto
   * forte, que amplia o orçamento por rodada e as rodadas — a correção do gargalo
   * que reprovava o modelo forte por pedir muitas leituras de uma vez.
   */
  readonly agenticRuntimePolicy?: AgenticRuntimePolicyV1;
  /** Limite de contexto declarado pelo modelo, quando descoberto. Opcional. */
  readonly declaredContextLength?: number;
  readonly protocolTransport?: CoderProtocolTransport;
  readonly providerLabel?: string;
  /**
   * Seam EXPERIMENTAL do Plano 003 / ADR-004.
   * Ausente por padrao: replace_anchor nao e anunciado nem aceito.
   */
  readonly experimentalAnchorMode?: {
    readonly kind: 'r2-host-mediated-v1';
    readonly cycleId: string;
    /**
     * Ergonomia experimental adicional.
     * Ausente preserva exatamente o comportamento R2 original.
     */
    readonly readGuidance?: 'narrow-target-v1' | 'after-scope-v1';
  };
}

export interface CoderProtocolMessage { readonly role: 'system' | 'user' | 'assistant'; readonly content: string }
export interface CoderProtocolTransportInput {
  readonly messages: readonly CoderProtocolMessage[];
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  /** Teto duro de tokens gerados nesta chamada — a MESMA reserva de saída (`numPredict`)
   * que o transport Ollama envia como `num_predict`. O transport do provider DEVE aplicá-lo
   * (ex.: `max_output_tokens` na Responses API da OpenAI) para que a invariante
   * `input + saída reservada <= janela` valha no request REAL, não só no cálculo. */
  readonly maxOutputTokens: number;
}
export interface CoderProtocolTransportResult { readonly content: string }
export type CoderProtocolTransport = (input: CoderProtocolTransportInput) => Promise<CoderProtocolTransportResult>;

const SYSTEM = [
  'Você edita um repositório por um PROTOCOLO LIMITADO em JSON. Nunca recebe nem devolve arquivos inteiros.',
  'Você recebe um MANIFESTO (caminho, tamanho, sha256, estrutura) e pode pedir TRECHOS antes de editar.',
  'Responda SEMPRE com UM objeto JSON, sem texto fora dele, em uma destas formas:',
  'LOCALIZAR: {"action":"read","reads":[{"path":"<do escopo>","search":"<termo>","contextBefore":3,"contextAfter":3,"maxLines":60}]}',
  'LER INTERVALO: {"action":"read","reads":[{"path":"<do escopo>","lineRange":[inicio,fim],"maxLines":60}]}',
  'search e lineRange são modos EXCLUSIVOS: nunca envie ambos no mesmo objeto. Use search para localizar a linha e, na rodada seguinte, lineRange para obter o bloco necessário à edição.',
  'Planeje as poucas rodadas pelo MANIFESTO: se pretende alterar vários arquivos existentes, reserve leitura para cada um; não releia ranges sobrepostos salvo se faltarem linhas específicas.',
  'EDITAR: {"action":"edit","operations":[{"kind":"replace_exact","path":"<do escopo>","expected_file_sha256":"<sha do arquivo como lido>","before":"<texto EXATO e ÚNICO do arquivo atual>","after":"<novo texto>","expected_occurrences":1}]}',
  'Se o "before" (ou o "anchor" de insert) puder REPETIR no arquivo, adicione "in_lines":[inicio,fim] com o intervalo de linhas (que você LEU) que contém a ocorrência exata a editar; o host exige que exatamente 1 ocorrência comece nesse intervalo. Não escolha "a primeira": expanda o before com contexto único OU use in_lines.',
  'Também é permitido {"kind":"create_file","path":"<do escopo>","content":"<conteúdo>"} somente quando o MANIFESTO marca exists=false. Nunca use create_file em exists=true. Exclusão não é permitida.',
  'Acrescentar ao FIM REAL do arquivo (ex.: novo export/função de topo): {"kind":"append","path":"<escopo>","expected_file_sha256":"<sha lido>","content":"<texto>"}. Não invente "before" para o fim.',
  'Inserir DENTRO de um bloco já existente (ex.: um `test` novo dentro de um `describe` já aberto): {"kind":"insert","path":"<escopo>","expected_file_sha256":"<sha lido>","anchor":"<trecho EXATO e ÚNICO já no arquivo, ex.: o ÚLTIMO test do bloco>","position":"after","content":"<novo texto>"}. A âncora é copiada UMA vez e NÃO é removida; o conteúdo entra logo antes ("before") ou depois ("after") dela.',
  'NÃO use append para adicionar dentro de um bloco: append vai para o FIM DO ARQUIVO e cai FORA do describe/bloco (léxicamente inválido, o gate falha). Para adicionar um caso a uma suíte, ancore no último caso do describe e use insert position="after".',
  'Regras: só caminhos do escopo; "before"/"anchor" devem ser copiados EXATAMENTE de um trecho lido e ocorrer uma única vez; use o sha256 do arquivo como lido; peça leituras antes de editar; não explique.',
].join('\n');

// Instruções da INVESTIGAÇÃO AMPLA (V3), anexadas ao system SÓ quando o workspace
// oferece busca/listagem host-executada. READ pode ser mais amplo que WRITE.
const SEARCH_SYSTEM = [
  'INVESTIGAÇÃO AMPLA: além de ler, você pode BUSCAR e LISTAR em todo o escopo de LEITURA, que pode ser MAIOR que o de escrita. O HOST executa a busca — você NUNCA roda shell.',
  'BUSCAR TEXTO/SÍMBOLO: {"action":"search","query":"<texto ou símbolo>","maxResults":20}. Opcional "pathGlob":"apps/web/**/*.ts" para restringir; "isRegex":true para regex (padrão: literal).',
  'LISTAR ARQUIVOS: {"action":"glob","pattern":"packages/core/**/*.ts","maxResults":40}.',
  'Use search/glob para DESCOBRIR arquivos relacionados (tipos, deps, testes, configs) FORA do escopo de escrita; depois {"action":"read",...} nos que interessam; só então {"action":"edit",...} DENTRO do escopo de escrita.',
  'DESCOBERTA DE CONTRATO: antes de usar ou introduzir um tipo, enum, string discriminante, RPC, função, campo ou shape existente, BUSQUE o símbolo/valor e LEIA sua definição real. Não infira valores pela linguagem natural.',
  'DEPENDÊNCIAS FACTUAIS: quando um critério exige propagar um fato pelo caller, rastreie sua origem real com SEARCH/READ. Placeholder temporário não pode sobreviver ao submit se contradiz um critério explícito.',
  'REGRA DE AUTORIDADE: LER é permitido em todo o escopo de leitura; ESCREVER só nos caminhos do escopo de ESCRITA. Ler um arquivo NÃO concede permissão de editá-lo — uma edição fora do escopo de escrita é recusada.',
].join('\n');

// Instruções de EXEC/TEST/GIT (V3, 3ª fatia), anexadas SÓ quando há command policy +
// workspace.exec. Neste modo o EDIT é ITERATIVO: aplica e continua; encerre com submit.
const EXEC_SYSTEM = [
  'EXECUÇÃO GOVERNADA: você pode rodar comandos de desenvolvimento e git READ-ONLY na worktree. O HOST executa (sem shell para você); você pede uma ação estruturada.',
  'RODAR COMANDO/TESTE: {"action":"exec","program":"npm","args":["test","--","caminho/do/teste"],"timeoutMs":120000}. Também: typecheck ({"program":"npm","args":["run","typecheck"]}), node, tsc, jest, vitest.',
  'GIT (somente leitura): {"action":"exec","program":"git","args":["diff"]} (ou status/log/show). git commit/reset/push/fetch/pull/checkout/clean/add são RECUSADOS — a branch pertence ao host.',
  'A observação traz exitCode/stdout/stderr/timedOut/truncated. exitCode≠0 (ex.: teste falhando) NÃO encerra a sessão: é observação — leia o erro, edite e rode de novo.',
  'MODO ITERATIVO: cada {"action":"edit",...} aplica a mudança e CONTINUA (não encerra). Você pode editar, rodar teste, inspecionar diff, editar de novo. Rede está NEGADA (sem curl/wget/git fetch/npm install).',
  'MÁQUINA DE ESTADOS: a ação {"action":"submit"} NÃO está sempre disponível. O host só a ANUNCIA como ação permitida depois que a revisão ATUAL da sua edição foi validada (teste focal exitCode=0) E revisada por git diff. Cada nova edição REINICIA essa exigência. A cada rodada o host lista as ações permitidas — só use uma delas.',
  'ENCERRAR: quando o host anunciar {"action":"submit"} entre as ações permitidas, responda-o para entregar ao host (que roda os gates autoritativos). Os gates finais do host são independentes — seu teste local é observação, não o veredito final.',
].join('\n');

const commandKey = (program: string, args: readonly string[]): string => `${program.toLowerCase()}\0${args.join('\0')}`;

/** Erros de edição RECUPERÁVEIS no modo iterativo (exec): recolocados ao modelo como
 * observação (nada foi escrito), nunca terminais até esgotar teto/rodadas. */
const RECOVERABLE_EDIT_CODES = new Set([
  'ollama_edit_outside_scope',
  'ollama_invalid_response_schema',
  'ollama_stale_file_hash',
  'ollama_ambiguous_replacement',
  'ollama_no_effective_edits',
]);
const MAX_EDIT_FEEDBACKS = 4;

/**
 * Reserva de rodadas PRODUTIVAS pós-investigação, exclusiva do modo exec (V3). É o
 * caminho estrutural EDIT → TEST → DIFF → SUBMIT: garante rodadas suficientes DEPOIS
 * do orçamento de leitura para validar e revisar a edição (EDIT→TEST→DIFF são ~3
 * rodadas; um reparo simples ~5). Preserva o número já usado pelo perfil histórico; a
 * correção estrutural do V3 é que ações INVÁLIDAS para o estado (submit prematuro,
 * leitura após orçamento) NÃO consomem esta reserva. */
const POST_EDIT_EXEC_ROUND_RESERVE = 8;

const EXPERIMENTAL_ANCHOR_SYSTEM = [
  'EXPERIMENTO R2 OPT-IN: o host pode anunciar anchors efemeros de trechos que ja foram servidos.',
  'Quando uma ancora adequada estiver disponivel, voce PODE editar com {"action":"edit","operations":[{"kind":"replace_anchor","anchor_id":"<id anunciado pelo host>","after":"<novo conteudo>"}]}.',
  'Em replace_anchor, forneca SOMENTE kind, anchor_id e after. Nunca forneca path, SHA, range ou conteudo original como autoridade alternativa.',
  'A regra de copiar before byte-exato continua valendo para replace_exact; replace_anchor referencia apenas uma ancora anunciada nesta mesma execucao.',
].join('\n');

const EXPERIMENTAL_ANCHOR_NARROW_READ_GUIDANCE = [
  'R2 NARROW TARGET OPT-IN: cada anchor cobre EXATAMENTE o intervalo servido pela leitura que o originou.',
  'Se uma leitura ampla serviu apenas para localizar o alvo, antes de editar faca uma nova leitura usando o MENOR lineRange que contenha somente o texto que realmente sera substituido.',
  'Prefira o anchor estreito dessa leitura. O campo after substitui TODO o intervalo desse anchor; nao reescreva linhas vizinhas que nao precisam mudar.',
  'Nao forneca path, SHA ou range no replace_anchor: essa autoridade continua exclusivamente no host.',
].join('\n');

const EXPERIMENTAL_ANCHOR_AFTER_SCOPE_GUIDANCE = [
  'R2 AFTER SCOPE OPT-IN: o campo after substitui TODO o intervalo do anchor escolhido.',
  'Gere no after somente o conteudo final correto desse intervalo; nao reescreva linhas vizinhas fora do anchor.',
].join('\n');

const clip = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max)}…`);

export class OllamaCoderBackend implements CoderBackend {
  readonly id: string;
  readonly observation: NonNullable<CoderBackend['observation']>;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly runtimePolicy: AgenticRuntimePolicyV1;
  private readonly maxReadRounds: number;
  private readonly readServingBudget: number;
  private readonly maxTotalServedReads: number;
  private readonly budget: ContextBudget;
  private readonly providerLabel: string;

  constructor(private readonly options: OllamaCoderOptions) {
    this.id = options.backendId ?? coderBackendId('ollama', options.model);
    this.observation = {
      placement: options.locality ?? 'local',
      nodeId: options.locality === 'remote' ? (options.nodeId ?? null) : null,
      model: options.model,
      ...(options.modelSelection ? { modelSelection: options.modelSelection } : {}),
    };
    this.url = options.url ?? process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    // Coding Harness V3: as fronteiras do laço vêm de uma política resolvida e
    // clampada no core. Precedência: policy explícita > `maxReadRounds` legado >
    // perfil local conservador. `resolveAgenticRuntimePolicy` garante valores sãos
    // (nunca um orçamento inválido) e a invariante `total >= por-rodada`.
    this.runtimePolicy = options.agenticRuntimePolicy
      ?? resolveAgenticRuntimePolicy({
        mode: 'supervised',
        ...(options.maxReadRounds !== undefined
          ? { overrides: { maxReadRounds: options.maxReadRounds } }
          : {}),
      });
    this.maxReadRounds = this.runtimePolicy.maxReadRounds;
    this.readServingBudget = this.runtimePolicy.readServingBudgetPerRound;
    this.maxTotalServedReads = this.runtimePolicy.maxTotalServedReads;
    this.providerLabel = options.providerLabel ?? `Ollama ${options.model}`;
    this.budget = resolveContextBudget({
      declaredContextLength: options.declaredContextLength ?? null,
      operationalCap: options.operationalContextCap ?? 8192,
      outputReserveTokens: options.outputReserveTokens ?? 1536,
      numPredict: options.numPredict ?? 1536,
    });
  }

  /** Orçamento de contexto EFETIVO (num_ctx, input, reserva de saída, num_predict) já
   * resolvido no construtor. Exposto para observabilidade host-side e prova; permanece
   * bounded — nunca cresce além do teto operacional selecionado. */
  get contextBudget(): ContextBudget { return this.budget; }

  async edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult> {
    const transcript = new OllamaTranscript(request.hostValidationFeedback);
    try { return await this.editWithTranscript(request, workspace, signal, transcript); }
    catch (error) { transcript.failed(error); throw error; }
    finally {
      // Evidence failures must never change the editing outcome.
      try { request.onTranscript?.(transcript.value()); } catch { /* advisory */ }
    }
  }

  private async editWithTranscript(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal, transcript: OllamaTranscript): Promise<CoderEditResult> {
    // V3 — READ e WRITE são autoridades DISTINTAS. A política de acesso (quando
    // presente) separa o escopo de LEITURA (potencialmente amplo) do de ESCRITA
    // (estreito, = Work Item). Ausente ⇒ retrocompatível: read == write == includedScope.
    const accessPolicy: WorkspaceAccessPolicyV1 = request.workspaceAccessPolicy
      ?? workspaceAccessPolicyFromIncludedScope(request.includedScope, request.excludedScope);
    // ESCRITA: allowlist exata (fail-closed) — a mesma autoridade que o host reforça
    // pós-edição via git observado.
    const scope = [...accessPolicy.writeScope];
    const writeAllowed = new Set(scope);
    // LEITURA: membership que delega à política (write sempre legível; modo workspace
    // aceita qualquer caminho lexicalmente seguro e não-excluído — o confinamento de
    // FS da worktree é a fronteira dura). Ler NÃO concede escrever.
    const readMembership: PathMembership = { has: (path: string) => isPathReadable(path, accessPolicy) };
    const readScopeIsBroad = accessPolicy.readScope.kind === 'workspace';
    const searchEnabled = typeof workspace.search === 'function' || typeof workspace.list === 'function';
    // EXEC authority (V3, 3ª fatia): distinta de READ/WRITE. Só habilita quando há
    // command policy E capacidade de execução no workspace. Nesse modo o EDIT é
    // ITERATIVO (aplica e continua) e o turno encerra com {"action":"submit"}.
    const commandPolicy: CommandExecutionPolicyV1 | undefined = request.commandPolicy;
    const execMode = typeof workspace.exec === 'function' && commandPolicy !== undefined;
    const validationCommands = execMode ? (request.validationCommands ?? []) : [];
    const validationKeys = new Set(validationCommands.map(command => commandKey(command.program, command.args)));
    const validateBeforeSubmit = validationCommands.length > 0;

    // Lê o conteúdo do escopo de ESCRITA UMA vez (manifesto + aplicação). Leituras
    // fora do escopo de escrita são carregadas SOB DEMANDA (read amplo, lazy). Nada é
    // injetado inteiro no prompt — só o manifesto e trechos pedidos.
    const cache = new Map<string, string | null>();
    for (const path of scope) cache.set(path, await workspace.readFile(path));
    const loadContent = async (path: string): Promise<string | null> => {
      if (!cache.has(path)) cache.set(path, await workspace.readFile(path));
      return cache.get(path) ?? null;
    };
    const contentOf = (path: string): string | null => cache.get(path) ?? null;
    const manifestFiles: ManifestInputFile[] = scope.map(path => ({ path, content: cache.get(path) ?? null }));
    const manifest = buildManifest(manifestFiles);

    const carried = request.carriedContext
      ? `\nRetomada — próximo passo: ${request.carriedContext.nextStep}. Restantes: ${request.carriedContext.remainingSteps.join('; ')}.`
      : '';
    const feedback = request.hostValidationFeedback;
    const repairContext = feedback?.kind === 'gate-failure'
      ? [
          'FASE DE REPARO: os arquivos atuais já contêm sua edição anterior; não reinicie a tarefa nem declare sucesso.',
          `Repair interno ${feedback.retryIndex}/${feedback.retryLimit}.`,
          `Gate observado pelo host: ${feedback.failedGate.label} | ${feedback.failedGate.command} | exitCode=${feedback.failedGate.exitCode}.`,
          `Arquivos alterados observados: ${feedback.changedFiles.join(', ')}. diffSha256=${feedback.diffSha256}.`,
          ...(feedback.diagnostic ? [`Diagnóstico sanitizado do host:\n${feedback.diagnostic}`] : []),
          'Leia o estado ATUAL necessário, corrija a implementação existente dentro do mesmo escopo e inclua/ajuste a prova determinística exigida pelo objetivo. Não invente APIs ou campos: confirme-os no código servido. O host reexecutará os gates.',
          'Se o diagnóstico acusar nomes não encontrados (ex.: "Cannot find name") ou erro estrutural, o código novo provavelmente está no ESCOPO LÉXICO ERRADO — ex.: um test que ficou FORA do describe. Reposicione-o: remova-o de onde está (replace_exact do trecho mal colocado) e insira DENTRO do bloco correto ancorando no último caso (insert position="after"). NÃO apenas redeclare o nome nem repita o mesmo patch.',
          'O repair precisa mudar bytes do estado ATUAL: não repita o patch já presente e não envie replace_exact com before e after equivalentes. Operação idempotente é no-progress e será recusada.',
          'Preserve TypeScript strict: se o tipo de retorno exclui undefined, torne acessos por índice/find explicitamente null-safe e não introduza um caminho que retorne undefined.',
          'Trate o diagnóstico do gate e os critérios do objetivo como autoridade: corrija exatamente a asserção observada, sem substituir o comportamento exigido por fallback, exceção ou interpretação alternativa.',
        ].join('\n')
      : feedback?.kind === 'no-change'
        ? `FASE DE REPARO: o host observou zero mudanças no turno anterior. Repair interno ${feedback.retryIndex}/${feedback.retryLimit}; produza uma edição real dentro do escopo.`
        : null;
    const readScopeLine = readScopeIsBroad
      ? 'Escopo de LEITURA: todo o workspace autorizado (você pode buscar/listar/ler arquivos fora do escopo de escrita — deps, tipos, testes, configs — mas NÃO editá-los).'
      : `Escopo de LEITURA (só estes caminhos): ${scope.join(', ')}`;
    const header = [
      `Tarefa: ${request.objective}`,
      // Política canônica do harness ANTES da inferência (fonte única compartilhada;
      // o mesmo texto chega ao OpenAI, que delega a este protocolo).
      ...(request.harnessPolicy ? [renderCoderHarnessPolicyInstructions(request.harnessPolicy)] : []),
      `Escopo de ESCRITA (só estes caminhos podem ser editados): ${scope.join(', ')}`,
      readScopeLine,
      `Fora do escopo (não toque): ${request.excludedScope.join('; ')}`,
      `Manifesto do escopo de escrita (sem conteúdo integral): ${JSON.stringify(manifest)}`,
      ...(validateBeforeSubmit ? [
        `VALIDAÇÕES EXECUTÁVEIS DO WORK ITEM (comandos concretos autorizados pelo host):\n${validationCommands.map(command => `- ${command.label}: ${command.program} ${command.args.join(' ')}`).join('\n')}`,
        'Após qualquer edição, execute ao menos uma validação focal listada e obtenha exitCode=0 na revisão atual antes de submit. exitCode diferente de zero é feedback recuperável: analise, corrija e execute novamente.',
        'Antes do submit, faça também self-review com git diff (read-only) depois da edição mais recente. O diff não substitui o gate.',
      ] : []),
      ...(repairContext ? [repairContext] : []),
    ].join('\n') + carried;

    const servedBlocks: string[] = [];
    const servedFingerprints = new Set<string>();
    let totalReadRequests = 0;
    // Fronteira de SESSÃO (V3): total de leituras servidas entre todas as rodadas.
    // Substitui o anti-loop por-rodada — o agente pode ler amplamente ao longo de
    // várias rodadas, mas não indefinidamente sem editar.
    let totalServedReads = 0;
    let uniqueServedReads = 0;
    let repeatedServedReads = 0;
    const repeatedReadDescriptors = new Set<string>();
    const experimentalAnchors = new Map<string, ServedAnchor>();
    let experimentalAnchorOrdinal = 0;
    // Teto próprio de reapresentações por âncora ambígua (independente das rodadas de
    // leitura): mantém a recuperação BOUNDED — nunca um laço ilimitado de edição.
    const MAX_AMBIGUITY_FEEDBACKS = 2;
    let ambiguityFeedbacks = 0;
    // Modo iterativo (exec): edições acumulam e o turno encerra por submit (ou por
    // esgotar rodadas com edições já aplicadas). editFeedbacks limita reapresentações
    // de edição recusada — bounded, nunca laço infinito.
    const appliedTouched = new Set<string>();
    let editRevision = 0;
    let passedValidationRevision = -1;
    let failedValidationRevision = -1;
    let diffReviewedRevision = -1;
    // Uma modificação (replace_exact/insert/append) a arquivo existente DEVE aparecer
    // no `git diff` — se aparecer vazio é suspeito. Um `create_file` de arquivo novo
    // fica UNTRACKED e legitimamente não aparece no `git diff` (sem `git add`), então
    // um diff vazio numa sessão SÓ de criação é aceitável. Sticky: uma vez que houve
    // modificação, o diff deve ser não-vazio.
    let expectNonEmptyDiff = false;
    let submitFeedbacks = 0;
    const MAX_SUBMIT_FEEDBACKS = 4;
    let editFeedbacks = 0;
    // Entrega o trabalho acumulado para revisão — usado só quando as provas exigidas
    // estão satisfeitas (ou a tarefa não tem gate executável).
    const concludeApplied = (note: string): CoderEditResult => ({
      summary: `Modelo ${this.providerLabel} concluiu ${appliedTouched.size} edição(ões) iterativa(s) (${note}), para revisão.`,
      touchedResources: [...appliedTouched],
    });
    // Estado da máquina de submit (V3): as provas são amarradas à editRevision atual.
    const gateStateNow = (): SubmitGateStateV1 => deriveSubmitGateState({
      editRevision, passedValidationRevision, failedValidationRevision, diffReviewedRevision,
      requiresValidation: validateBeforeSubmit,
    });
    const runtimeEvent = (
      kind: 'search' | 'glob' | 'exec' | 'test' | 'git_diff' | 'edit_applied' | 'submit_blocked' | 'submit_allowed',
      result: 'served' | 'refused' | 'exit0' | 'exit_nonzero' | 'timeout' | 'blocked' | 'allowed' | 'empty_diff',
      atRound: number,
      detail = '',
    ): void => transcript.runtime({ round: atRound, kind, result, state: gateStateNow(), editRevision, passedValidationRevision, diffReviewedRevision, detail });
    // Esgotamento: NUNCA sucesso implícito sem as provas exigidas. Sem edição alguma,
    // é o limite de rodadas clássico; com edições porém sem provas (havendo gate
    // executável), falha ESPECÍFICA; com provas satisfeitas (ou tarefa sem gate),
    // entrega o acumulado para revisão.
    const concludeOrFail = (note: string): CoderEditResult => {
      if (appliedTouched.size === 0) {
        throw new OllamaProtocolError('ollama_read_round_limit', `protocolo encerrou (${note}) sem edições.`);
      }
      if (isSubmitAvailable(gateStateNow())) return concludeApplied(note);
      throw new OllamaProtocolError('ollama_submit_gate_unsatisfied',
        `esgotamento (${note}) sem as provas exigidas da revisão atual: execute a validação focal até exitCode=0 e um git diff não vazio antes de concluir.`);
    };

    // Rodadas PRODUTIVAS (leitura/busca/exec/edição aplicada). A reserva pós-edit (só
    // em exec) garante estruturalmente o caminho EDIT→TEST→DIFF→SUBMIT depois do
    // orçamento de leitura. Ações INVÁLIDAS/DESVIADAS para o estado (submit prematuro,
    // leitura/busca após o orçamento, comando recusado, edição recuperável) NÃO
    // consomem `round` — cada uma é bounded pelo próprio contador; um cap DURO de
    // iterações fecha qualquer laço.
    const postEditReserve = execMode ? POST_EDIT_EXEC_ROUND_RESERVE : 0;
    const MAX_MISDIRECTED_FEEDBACKS = 4;
    let misdirectedFeedbacks = 0;
    const hardIterationCap = this.maxReadRounds + postEditReserve + MAX_SUBMIT_FEEDBACKS + MAX_EDIT_FEEDBACKS
      + MAX_AMBIGUITY_FEEDBACKS + MAX_MISDIRECTED_FEEDBACKS + 8;
    // RESERVA PÓS-EDIT ANCORADA (V3): enquanto `editRevision===0` o teto é `maxReadRounds`
    // (só exploração). A PRIMEIRA edição material marca `postEditBase = round` e libera a
    // reserva ÍNTEGRA (`postEditReserve`) a partir daí. Assim ações de exploração —
    // incluindo git diff vazio em EXPLORING — NUNCA reduzem a reserva; o caminho
    // EDIT→TEST→DIFF→SUBMIT (e reparo) sempre tem as 8 rodadas prometidas.
    let postEditBase: number | null = null;
    const roundCap = (): number => postEditBase === null ? this.maxReadRounds : postEditBase + postEditReserve;
    // Reorientação de ação legítima porém fora do orçamento/estado (só exec): registra
    // observação, NÃO consome rodada produtiva; após o teto, conclui-ou-falha.
    const misdirect = (note: string): CoderEditResult | null => {
      misdirectedFeedbacks += 1;
      if (misdirectedFeedbacks > MAX_MISDIRECTED_FEEDBACKS) return concludeOrFail(`ações desviadas em excesso: ${note}`);
      servedBlocks.push(`${note} (reorientação ${misdirectedFeedbacks}/${MAX_MISDIRECTED_FEEDBACKS}).`);
      return null;
    };

    let round = 0;
    let iterations = 0;
    while (round <= roundCap() && iterations <= hardIterationCap) {
      iterations += 1;
      // Fase: EXPLORING enquanto sem edição material; PÓS-EDIT depois da 1ª edição.
      const postEdit = postEditBase !== null;
      // Rodadas de investigação restantes (só na exploração; pós-edit consome a reserva).
      const roundsLeft = this.maxReadRounds - round;
      const postEditLeft = postEdit ? roundCap() - round : postEditReserve;
      const state = gateStateNow();
      // SUBMIT só existe em READY_TO_SUBMIT (com edições aplicadas, em modo exec).
      const submitAvailable = execMode && appliedTouched.size > 0 && isSubmitAvailable(state);
      const actions: readonly RuntimeAction[] = availableRuntimeActions({ state, searchEnabled, execEnabled: execMode, readRoundsLeft: roundsLeft });
      // A lista de ações apresentada por rodada contém SOMENTE as permitidas no estado
      // atual — em particular, `submit` só aparece em READY_TO_SUBMIT.
      const actionsLine = execMode
        ? `Ações permitidas nesta rodada (estado ${state}): ${actions.join(', ')}. Responda com UMA delas; qualquer outra ação será recusada.`
        : null;
      const stateGuidance = !execMode || !validateBeforeSubmit ? null
        : state === 'exploring'
          ? 'SUBMIT indisponível: nenhuma edição ainda. Investigue e edite dentro do escopo de escrita.'
          : state === 'dirty_unvalidated'
            ? `SUBMIT indisponível: a edição da revisão ${editRevision} ainda não foi validada. Execute uma validação focal listada até exitCode=0.`
            : state === 'dirty_validated'
              ? `SUBMIT indisponível: validação verde na revisão ${editRevision}; agora execute git diff (read-only) para self-review da MESMA revisão.`
              : `SUBMIT DISPONÍVEL: revisão ${editRevision} validada e diff revisado. Responda {"action":"submit"} (qualquer nova edição reinicia a exigência).`;
      const investigateHint = `${searchEnabled ? '/{"action":"search",...}/{"action":"glob",...}' : ''}${execMode ? '/{"action":"exec",...}' : ''}`;
      const finishHint = execMode ? '{"action":"edit",...} e valide antes de submeter' : '{"action":"edit",...}';
      const budgetLine = postEdit
        // Reserva pós-edit ANCORADA: a exploração acabou; estas rodadas são para
        // validar/reparar/revisar/submeter e não foram tocadas pela exploração.
        ? `Orçamento pós-edit: ${Math.max(postEditLeft, 0)} rodada(s) reservada(s) para validar (exitCode=0), reparar, git diff e {"action":"submit"}.`
        : roundsLeft <= 0
          ? execMode
            ? 'Orçamento: 0 rodadas de investigação restantes. Edite dentro do escopo agora; a reserva pós-edit (íntegra) só é liberada após a 1ª edição.'
            : 'Orçamento: 0 rodadas de investigação restantes. Você DEVE responder agora com {"action":"edit",...}. Novo pedido de leitura/busca/execução será recusado.'
          : roundsLeft === 1
            ? `Orçamento: 1 rodada de investigação restante — a última. Peça {"action":"read",...}${investigateHint} agora ou já finalize com ${finishHint}.`
            : `Orçamento: ${roundsLeft} rodadas de investigação restantes. Peça {"action":"read",...}${investigateHint} ou finalize com ${finishHint}.`;
      const progressLine = totalReadRequests === 0
        ? null
        : `Progresso host: requests=${totalReadRequests}; novos=${uniqueServedReads}; repetidos=${repeatedServedReads}.${repeatedServedReads > 0
          ? ` Repetições idênticas não foram duplicadas: ${[...repeatedReadDescriptors].join(', ')}. Não repita; edite ou leia região diferente.`
          : ''}`;
      const prompt = [
        header,
        servedBlocks.length ? `Contexto já fornecido:\n${servedBlocks.join('\n')}` : 'Nenhum trecho fornecido ainda.',
        ...(progressLine ? [progressLine] : []),
        ...(stateGuidance ? [stateGuidance] : []),
        ...(actionsLine ? [actionsLine] : []),
        budgetLine,
      ].join('\n\n');

      const response = await this.callProtocol(prompt, signal, searchEnabled, execMode, submitAvailable);

      if (response.action === 'edit') {
        const rawOperations = response.operations as unknown[];
        const requestedExperimentalAnchor = rawOperations.some(raw =>
          Boolean(raw)
          && typeof raw === 'object'
          && !Array.isArray(raw)
          && (raw as Record<string, unknown>).kind === 'replace_anchor'
        );

        if (requestedExperimentalAnchor && this.options.experimentalAnchorMode) {
          const operations = parseExperimentalAnchorOperations(rawOperations);
          const changes = applyExperimentalAnchorOperations({
            operations,
            anchors: experimentalAnchors,
            cycleId: this.options.experimentalAnchorMode.cycleId,
            allowedPaths: writeAllowed,
            contentOf,
          });
          const touched = await writeChangeSet(
            changes,
            { writeFile: (path, content) => workspace.writeFile(path, content) },
            signal,
          );
          return {
            summary: `Modelo ${this.providerLabel} aplicou ${touched.length} edição(ões) pelo experimento R2 de âncora host-mediada, para revisão.`,
            touchedResources: touched,
          };
        }

        // Caminho vigente de produção. Se replace_anchor aparecer sem opt-in,
        // parseEditOperations o recusa fail-closed. EDIÇÃO usa a autoridade de ESCRITA
        // (estreita), NUNCA a de leitura ampla — ler não concede editar.
        try {
          const operations = parseEditOperations(rawOperations, writeAllowed);
          const steps = operations.map(op => transcript.edit(op, contentOf(op.path), round));
          let changes;
          try { changes = applyEditOperations(operations, contentOf); }
          catch (error) {
            transcript.application(steps, 'batch_failed');
            // Não-exec: âncora ambígua é RECUPERÁVEL dentro do teto próprio (comportamento
            // histórico). Em modo exec, TODOS os erros recuperáveis passam pelo catch externo.
            if (!execMode && error instanceof OllamaProtocolError && error.code === 'ollama_ambiguous_replacement'
                && roundsLeft > 0 && ambiguityFeedbacks < MAX_AMBIGUITY_FEEDBACKS) {
              ambiguityFeedbacks += 1;
              servedBlocks.push(`Edição recusada (âncora ambígua), NADA foi aplicado: ${error.message} Reapresentação ${ambiguityFeedbacks}/${MAX_AMBIGUITY_FEEDBACKS}. Reenvie uma edição com "before"/"anchor" mais específico ou com "in_lines":[inicio,fim] do intervalo lido que contém a ocorrência desejada.`);
              round += 1;
              continue;
            }
            throw error;
          }
          // Validação integral contra o snapshot já ocorreu (applyEditOperations).
          // Aqui só escrevemos o lote (escreve-ou-lança, nunca sucesso parcial). A
          // restauração ao estado-base em caso de falha é da worktree (autoridade única).
          let touched;
          try { touched = await writeChangeSet(
            changes,
            { writeFile: (path, content) => workspace.writeFile(path, content) },
            signal,
          ); } catch (error) { transcript.application(steps, 'write_failed'); throw error; }
          transcript.application(steps, 'applied');
          if (execMode) {
            // MODO ITERATIVO: a edição é aplicada mas NÃO encerra o turno. Atualiza o
            // cache (leituras/testes seguintes veem o novo conteúdo), registra os caminhos
            // e devolve observação. editRevision++ INVALIDA automaticamente provas antigas
            // (elas deixam de casar `=== editRevision`) ⇒ volta a DIRTY_UNVALIDATED.
            for (const ch of changes) cache.set(ch.path, ch.newContent);
            for (const t of touched) appliedTouched.add(t);
            editRevision += 1;
            // 1ª edição material ANCORA a reserva pós-edit a partir daqui (íntegra).
            if (postEditBase === null) postEditBase = round;
            if (operations.some(op => op.kind !== 'create_file')) expectNonEmptyDiff = true;
            servedBlocks.push(`Edição aplicada (${touched.length}): ${touched.join(', ')}. A revisão ${editRevision} precisa de validação focal (exitCode=0) e git diff antes de submit — que só será oferecido então.`);
            runtimeEvent('edit_applied', 'served', round);
            round += 1;
            continue;
          }
          return {
            summary: `Modelo ${this.providerLabel} aplicou ${touched.length} edição(ões) estruturada(s) por protocolo limitado, para revisão.`,
            touchedResources: touched,
          };
        } catch (error) {
          // Modo iterativo (exec): erros de edição RECUPERÁVEIS viram observação bounded —
          // uma edição ruim não mata a sessão agêntica. Escopo/stale/ambígua/no-op/schema
          // são recolocados ao modelo (NADA foi escrito) e NÃO consomem a reserva produtiva.
          // Esgotado o próprio teto de reapresentações: não bypassa o gate.
          if (execMode && error instanceof OllamaProtocolError && RECOVERABLE_EDIT_CODES.has(error.code)
              && editFeedbacks < MAX_EDIT_FEEDBACKS) {
            editFeedbacks += 1;
            servedBlocks.push(`Edição recusada (${error.code}), nada foi aplicado: ${clip(error.message, 300)} Reapresentação ${editFeedbacks}/${MAX_EDIT_FEEDBACKS}. Corrija DENTRO do escopo de escrita.`);
            continue;
          }
          // Esgotado o teto: NÃO conclui sucesso implícito sem as provas exigidas.
          if (execMode && appliedTouched.size > 0) return concludeOrFail(`ação posterior recusada: ${error instanceof OllamaProtocolError ? error.code : 'erro'}`);
          throw error;
        }
      }

      // action === 'submit' — só é aceito no estado READY_TO_SUBMIT. Um submit
      // prematuro é BLOQUEADO pela máquina de estados, NÃO consome a reserva produtiva
      // e é bounded pelo próprio contador. Os gates autoritativos do host rodam DEPOIS.
      if (response.action === 'submit') {
        if (appliedTouched.size === 0) {
          throw new OllamaProtocolError('ollama_no_effective_edits', 'submit sem nenhuma edição aplicada.');
        }
        if (!submitAvailable) {
          runtimeEvent('submit_blocked', 'blocked', round);
          if (submitFeedbacks >= MAX_SUBMIT_FEEDBACKS) {
            throw new OllamaProtocolError('ollama_invalid_response_schema', 'submit recusado: validação focal verde e git diff são obrigatórios após a edição mais recente.');
          }
          submitFeedbacks += 1;
          const missing = [
            ...(passedValidationRevision !== editRevision || failedValidationRevision === editRevision ? ['execute uma validação focal listada até exitCode=0'] : []),
            ...(diffReviewedRevision !== editRevision ? ['execute git diff para self-review'] : []),
          ];
          servedBlocks.push(`Submit recusado (${submitFeedbacks}/${MAX_SUBMIT_FEEDBACKS}): ${missing.join('; ')}. A sessão continua; não declare sucesso ainda.`);
          continue;
        }
        runtimeEvent('submit_allowed', 'allowed', round);
        return {
          summary: `Modelo ${this.providerLabel} concluiu ${appliedTouched.size} edição(ões) iterativa(s) (com exec/validação local), para revisão.`,
          touchedResources: [...appliedTouched],
        };
      }

      // action === 'exec' — SHELL/TEST/GIT GOVERNADOS (V3, 3ª fatia). O host valida a
      // ação pela command policy, executa confinado à worktree e devolve a observação.
      // exitCode≠0 é OBSERVAÇÃO recuperável (não encerra). Só a execução REAL consome
      // uma rodada produtiva; um comando recusado é reorientação bounded (não gasta a reserva).
      if (response.action === 'exec') {
        if (!execMode || !commandPolicy || typeof workspace.exec !== 'function') {
          const r = misdirect('execução indisponível neste workspace (sem command policy) — use read/edit'); if (r) return r; continue;
        }
        // PRÉ-EDIT: exec/git diff usam o orçamento de EXPLORAÇÃO (nunca a reserva pós-edit).
        // Esgotada a exploração sem edição, reorienta — um git diff vazio em EXPLORING não
        // deve consumir a reserva que pertence ao caminho de validação/reparo pós-edit.
        if (!postEdit && roundsLeft <= 0) {
          const r = misdirect('orçamento de investigação esgotado — edite dentro do escopo antes de exec/git diff'); if (r) return r; continue;
        }
        const req = parseExecRequest(response.raw);
        const decision = resolveCommandExecution({ program: req.program, args: req.args, ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}) }, commandPolicy);
        // Classificação (não-sensível) da ação para a observabilidade diagnóstica.
        const obsKind = (program: string, args: readonly string[]): 'exec' | 'test' | 'git_diff' =>
          program === 'git' && args[0] === 'diff' ? 'git_diff' : validationKeys.has(commandKey(program, args)) ? 'test' : 'exec';
        if (!decision.ok) {
          runtimeEvent('exec', 'refused', round);
          // Observabilidade V3: comando recusado + motivo sanitizado (editRevision/state fotografados).
          transcript.command({ round, editRevision, state: gateStateNow(), kind: obsKind(req.program, req.args),
            command: `${req.program} ${req.args.join(' ')}`, stdout: '', stderr: '', exitCode: null, timedOut: false,
            refused: true, refusedReason: decision.reason });
          servedBlocks.push(`Comando recusado pela política: ${decision.reason}`);
          const r = misdirect('comando recusado pela política'); if (r) return r; continue;
        }
        const result = await workspace.exec({ program: decision.program, args: decision.args, timeoutMs: decision.timeoutMs }, signal);
        servedBlocks.push(renderExec(decision.program, decision.args, result, commandPolicy.maxOutputChars));
        const key = commandKey(decision.program, decision.args);
        const outcome: 'exit0' | 'exit_nonzero' | 'timeout' = result.timedOut ? 'timeout' : result.exitCode === 0 ? 'exit0' : 'exit_nonzero';
        // detail NÃO-sensível: programa + subcomando allowlistado (nunca args de caminho).
        const detail = ['npm', 'pnpm', 'git'].includes(decision.program) ? `${decision.program} ${decision.args[0] ?? ''}`.trim() : decision.program;
        const isFocalTest = validationKeys.has(key);
        // Observabilidade V3 (bounded + redigida): comando, exit, stdout/stderr/diff da revisão.
        transcript.command({ round, editRevision, state: gateStateNow(), kind: obsKind(decision.program, decision.args),
          command: `${decision.program} ${decision.args.join(' ')}`, stdout: result.stdout, stderr: result.stderr,
          exitCode: result.exitCode, timedOut: result.timedOut });
        // Distinção TEST focal × demais EXECs: só um comando de validação LISTADO cria prova.
        if (isFocalTest && appliedTouched.size > 0) {
          if (result.exitCode === 0 && !result.timedOut) {
            passedValidationRevision = editRevision;
            failedValidationRevision = -1;
          } else {
            // TEST vermelho NÃO cria prova.
            failedValidationRevision = editRevision;
            passedValidationRevision = -1;
            servedBlocks.push('A validação focal conhecida falhou: submit permanece bloqueado. Analise a saída, edite e rode novamente.');
          }
        }
        let diffEmpty = false;
        if (decision.program === 'git' && decision.args[0] === 'diff') {
          // DIFF só conta para a editRevision ATUAL (appliedTouched.size > 0 exigido —
          // um diff anterior à edição não vale). Um diff VAZIO só é recusado quando
          // houve MODIFICAÇÃO de arquivo existente (que deveria aparecer); numa sessão
          // só de create_file (arquivo novo untracked) o diff vazio é aceitável.
          if (appliedTouched.size > 0 && result.exitCode === 0 && !result.timedOut) {
            if (result.stdout.trim().length > 0 || !expectNonEmptyDiff) {
              diffReviewedRevision = editRevision;
            } else {
              diffEmpty = true;
              servedBlocks.push('git diff VAZIO não conta como self-review com modificações aplicadas: confirme que a edição está na worktree e rode um diff que mostre a mudança.');
            }
          }
          runtimeEvent('git_diff', diffEmpty ? 'empty_diff' : outcome, round, detail);
        } else {
          runtimeEvent(isFocalTest ? 'test' : 'exec', outcome, round, detail);
        }
        round += 1;
        continue;
      }

      // action === 'search' | 'glob' — INVESTIGAÇÃO AMPLA host-executada (V3).
      // O host roda a busca/listagem confinada ao workspace; o modelo NÃO executa
      // shell. Consome uma rodada de investigação (bounded por maxReadRounds); os
      // resultados são filtrados ao escopo de LEITURA (nunca vazam excluído/fora).
      if (response.action === 'search' || response.action === 'glob') {
        if (roundsLeft <= 0) {
          // Orçamento de investigação esgotado: em exec, reorienta (não conclui
          // implicitamente — fecha o bypass "SEARCH/GLOB esgotado → concludeApplied");
          // sem exec, é terminal (o modelo nunca editou).
          if (execMode) { const r = misdirect('investigação de leitura esgotada — edite, valide e finalize'); if (r) return r; continue; }
          throw new OllamaProtocolError('ollama_read_round_limit', 'o modelo pediu investigação sem rodadas restantes; era esperada uma edição.');
        }
        if (!searchEnabled) {
          servedBlocks.push('Busca/listagem indisponível neste workspace; use {"action":"read",...} com caminhos do escopo.');
          if (execMode) { const r = misdirect('busca/listagem indisponível'); if (r) return r; }
          continue;
        }
        if (response.action === 'search') {
          const req = parseSearchRequest(response.raw);
          const result = workspace.search
            ? await workspace.search({ query: req.query, ...(req.pathGlob ? { pathGlob: req.pathGlob } : {}), maxResults: req.maxResults, isRegex: req.isRegex }, signal)
            : { matches: [] as const, truncated: false };
          const readable = result.matches.filter(m => isPathReadable(m.path, accessPolicy));
          servedBlocks.push(renderSearch(req.query, readable, result.truncated || readable.length < result.matches.length));
          runtimeEvent('search', 'served', round);
        } else {
          const req = parseGlobRequest(response.raw);
          const result = workspace.list
            ? await workspace.list({ pattern: req.pattern, maxResults: req.maxResults }, signal)
            : { paths: [] as const, truncated: false };
          const readable = result.paths.filter(p => isPathReadable(p, accessPolicy));
          servedBlocks.push(renderGlob(req.pattern, readable, result.truncated || readable.length < result.paths.length));
          runtimeEvent('glob', 'served', round);
        }
        round += 1;
        continue;
      }

      // action === 'read'
      if (roundsLeft <= 0) {
        // Fecha o bypass "READ esgotado → concludeApplied": em exec, reorienta
        // (não conclui sem provas); sem exec, é terminal.
        if (execMode) { const r = misdirect('orçamento de leitura esgotado — edite, valide e finalize'); if (r) return r; continue; }
        throw new OllamaProtocolError('ollama_read_round_limit', `o modelo esgotou as ${this.maxReadRounds} rodadas de leitura sem propor edições.`);
      }
      // Fronteira de sessão: exaurido o teto de leituras servidas, o laço exige
      // edição (boundary, não teto de schema por rodada). Fecha o bypass equivalente.
      if (totalServedReads >= this.maxTotalServedReads) {
        if (execMode) { const r = misdirect('teto de leituras da sessão atingido — edite, valide e finalize'); if (r) return r; continue; }
        throw new OllamaProtocolError('ollama_read_round_limit', `o modelo esgotou o teto de ${this.maxTotalServedReads} leituras servidas na sessão sem propor edições.`);
      }
      // Orçamento por rodada é POLÍTICA: o excedente é DEFERIDO (re-solicitável),
      // nunca recusado. `servingBudget` respeita ainda o que resta do teto de sessão.
      const roundServingBudget = Math.min(this.readServingBudget, this.maxTotalServedReads - totalServedReads);
      const { requests, rejected, deferred } = parseReadRequests(response.reads as unknown[], readMembership, roundServingBudget);
      // READ amplo (V3): carrega sob demanda os caminhos pedidos fora do escopo de
      // escrita pré-carregado. O confinamento de FS (safeJoin) da worktree é a
      // fronteira dura; readFile devolve null p/ inexistente/sensível (então serve
      // como "arquivo inexistente no escopo", nunca vaza).
      for (const r of requests) await loadContent(r.path);
      const { served, rejected: missing } = serveReadRequests(requests, contentOf);
      totalReadRequests += requests.length;
      totalServedReads += served.length;

      const uniqueServed: ServedRead[] = [];
      for (const item of served) {
        const fingerprint = sha256(`${item.path}\n${item.sha256}\n${item.slice}`);
        if (servedFingerprints.has(fingerprint)) {
          repeatedServedReads += 1;
          repeatedReadDescriptors.add(`${item.path} (${item.provenance.effectiveMode})`);
          continue;
        }
        servedFingerprints.add(fingerprint);
        uniqueServed.push(item);
        transcript.read(item, round);
        uniqueServedReads += 1;
      }

      const anchorsForThisRound: ServedAnchor[] = [];
      if (this.options.experimentalAnchorMode) {
        for (const item of uniqueServed) {
          const content = contentOf(item.path);
          if (content === null) continue;

          for (const [startLine, endLine] of experimentalRangesFromServedSlice(item.slice)) {
            const anchor = createServedAnchor({
              cycleId: this.options.experimentalAnchorMode.cycleId,
              ordinal: experimentalAnchorOrdinal++,
              path: item.path,
              fileContent: content,
              startLine,
              endLine,
              allowedPaths: writeAllowed,
            });
            experimentalAnchors.set(anchor.anchorId, anchor);
            anchorsForThisRound.push(anchor);
          }
        }
      }

      servedBlocks.push(renderServed(
        uniqueServed,
        [...rejected, ...missing],
        anchorsForThisRound,
        deferred,
      ));
      round += 1;
      continue;
    }
    // Esgotadas as rodadas PRODUTIVAS. Em exec, entrega o acumulado SOMENTE se as
    // provas exigidas estão satisfeitas (ou a tarefa não tem gate executável); caso
    // contrário, falha ESPECÍFICA — nunca sucesso implícito. Sem exec, terminal.
    if (execMode) return concludeOrFail(postEditBase !== null ? 'reserva pós-edit esgotada' : 'rodadas de investigação esgotadas');
    throw new OllamaProtocolError('ollama_read_round_limit', 'protocolo encerrou sem edições.');
  }

  /** Uma volta do protocolo: chama o modelo, checa truncamento e parseia o
   * envelope. Um ÚNICO reparo é permitido quando o schema vem errado — apenas
   * reforçando o formato, sem reapresentar conteúdo algum. */
  private async callProtocol(prompt: string, signal: AbortSignal, searchEnabled = false, execEnabled = false, submitAvailable = false) {
    const system = [
      SYSTEM,
      ...(searchEnabled ? [SEARCH_SYSTEM] : []),
      ...(execEnabled ? [EXEC_SYSTEM] : []),
      ...(this.options.experimentalAnchorMode
        ? [
            EXPERIMENTAL_ANCHOR_SYSTEM,
            ...(this.options.experimentalAnchorMode.readGuidance === 'narrow-target-v1'
              ? [EXPERIMENTAL_ANCHOR_NARROW_READ_GUIDANCE]
              : this.options.experimentalAnchorMode.readGuidance === 'after-scope-v1'
                ? [EXPERIMENTAL_ANCHOR_AFTER_SCOPE_GUIDANCE]
                : []),
          ]
        : []),
    ].join('\n');
    const messages = [{ role: 'system' as const, content: system }, { role: 'user' as const, content: prompt }];
    assertPromptWithinBudget(system + prompt, this.budget);
    const invoke = async (callMessages: readonly CoderProtocolMessage[]): Promise<CoderProtocolTransportResult | OllamaChatResult> => this.options.protocolTransport
      // A MESMA reserva de geração usada pelo Ollama (`num_predict`) vai ao transport do
      // provider como teto duro de saída — o Ollama já a aplica em callOllamaChat.
      ? this.options.protocolTransport({ messages: callMessages, signal, timeoutMs: this.timeoutMs, maxOutputTokens: this.budget.numPredict })
      : callOllamaChat({ url: this.url, model: this.options.model, messages: callMessages, budget: this.budget, timeoutMs: this.timeoutMs, fetchImpl: this.fetchImpl, signal });
    const first = await invoke(messages);
    if ('meta' in first) assertNotTruncated(system + prompt, first.meta);
    try {
      return parseProtocolResponse(first.content);
    } catch (error) {
      if (!(error instanceof OllamaProtocolError) || error.code !== 'ollama_invalid_response_schema') throw error;
      // Reparo só-de-schema: NÃO reapresenta conteúdo, só exige o formato.
      const assistantEcho = clip(first.content, 500);
      // Só anuncia ações disponíveis no estado atual: `submit` apenas quando o gate o permite.
      const repairInstruction = `Sua resposta não seguiu o schema. Responda SOMENTE com um objeto JSON de uma ação disponível (${[
        'read', 'edit',
        ...(searchEnabled ? ['search', 'glob'] : []),
        ...(execEnabled ? ['exec'] : []),
        ...(submitAvailable ? ['submit'] : []),
      ].join('/')}) sem texto fora dele.`;
      const repairMessages = [
        ...messages,
        { role: 'assistant' as const, content: assistantEcho },
        { role: 'user' as const, content: repairInstruction },
      ];
      // O reparo envia MAIS tokens que a volta original — o eco do assistente e a
      // instrução extra. Orçamento e truncamento têm de ser medidos sobre o payload
      // REAL do reparo, não sobre o prompt original (que já passou acima): senão um
      // reparo grande é enviado sem guarda e o Ollama o trunca em silêncio, exatamente
      // o que a Fase 1 evita. Não cresce o orçamento; só mede o que de fato é enviado.
      const repairText = system + prompt + assistantEcho + repairInstruction;
      assertPromptWithinBudget(repairText, this.budget);
      const repaired = await invoke(repairMessages);
      if ('meta' in repaired) assertNotTruncated(repairText, repaired.meta);
      return parseProtocolResponse(repaired.content);
    }
  }
}

const experimentalRangesFromServedSlice = (
  slice: string,
): readonly (readonly [number, number])[] => {
  if (slice.includes('trecho truncado por limite de caracteres')) return [];

  const lineNumbers = slice
    .split('\n')
    .map(line => /^\s*(\d+)\| /.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map(match => Number(match[1]))
    .filter(Number.isSafeInteger);

  if (lineNumbers.length === 0) return [];

  const ranges: Array<readonly [number, number]> = [];
  let start = lineNumbers[0]!;
  let previous = start;

  for (const current of lineNumbers.slice(1)) {
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push([start, previous]);
    start = current;
    previous = current;
  }
  ranges.push([start, previous]);
  return ranges;
};

const renderSearch = (
  query: string,
  matches: readonly WorkspaceSearchHit[],
  truncated: boolean,
): string => {
  if (!matches.length) return `Busca "${query}": nenhuma ocorrência legível no escopo de leitura.`;
  const lines = matches.map(m => `  ${m.path}:${m.line}: ${clip(m.preview, 200)}`);
  return `Busca "${query}" (${matches.length} ocorrência(s)${truncated ? ', resultado truncado — refine a query ou pathGlob' : ''}):\n${lines.join('\n')}\nUse {"action":"read",...} nesses caminhos para ver o contexto. Só o escopo de ESCRITA pode ser editado.`;
};

const renderGlob = (
  pattern: string,
  paths: readonly string[],
  truncated: boolean,
): string => {
  if (!paths.length) return `Glob "${pattern}": nenhum arquivo legível no escopo de leitura.`;
  return `Glob "${pattern}" (${paths.length} arquivo(s)${truncated ? ', lista truncada — refine o padrão' : ''}):\n${paths.map(p => `  ${p}`).join('\n')}`;
};

/** Observação de EXEC servida ao modelo: exit/timeout/duração + stdout/stderr truncados
 * ao cap de VOLUME da policy (compactação explícita, nunca derruba a sessão). exit≠0
 * é observação recuperável — o modelo lê o erro, edita e roda de novo. */
const renderExec = (
  program: string,
  args: readonly string[],
  result: WorkspaceExecResult,
  maxOutputChars: number,
): string => {
  const cut = (s: string): { text: string; truncated: boolean } => {
    const v = typeof s === 'string' ? s : '';
    return v.length > maxOutputChars
      ? { text: `${v.slice(0, maxOutputChars)}\n… (saída truncada por limite de ${maxOutputChars} chars)`, truncated: true }
      : { text: v, truncated: false };
  };
  const out = cut(result.stdout);
  const err = cut(result.stderr);
  const truncated = out.truncated || err.truncated;
  const header = `EXEC ${program} ${args.join(' ')} → exitCode=${result.exitCode}${result.timedOut ? ' (TIMEOUT)' : ''}; ${result.durationMs}ms${truncated ? '; saída truncada' : ''}.`;
  return [
    header,
    out.text.trim() ? `stdout:\n${out.text}` : 'stdout: (vazio)',
    err.text.trim() ? `stderr:\n${err.text}` : 'stderr: (vazio)',
    result.exitCode === 0 ? 'Observação: comando OK.' : 'Observação: exitCode≠0 é recuperável — leia o erro, edite e rode de novo, ou {"action":"submit"} se apropriado.',
  ].join('\n');
};

const renderServed = (
  served: readonly ServedRead[],
  rejected: readonly string[],
  experimentalAnchors: readonly ServedAnchor[] = [],
  deferred: readonly string[] = [],
): string => {
  const blocks = served.map(item => `Arquivo ${item.path} (sha256 ${item.sha256}):\n${item.slice}`);

  // Leituras DEFERIDAS pelo orçamento da rodada NÃO são recusadas: o modelo pode
  // re-solicitá-las numa próxima rodada. É a diferença central do V3 — investigar
  // amplamente não custa a tentativa; só desloca leituras para a rodada seguinte.
  if (deferred.length) {
    blocks.push(`Leituras DEFERIDAS pelo orçamento desta rodada (NÃO recusadas — re-solicite numa próxima rodada de leitura): ${deferred.join('; ')}.`);
  }

  if (experimentalAnchors.length) {
    blocks.push(
      `Âncoras experimentais R2 disponíveis nesta execução: ${JSON.stringify(
        experimentalAnchors.map(anchor => ({
          anchor_id: anchor.anchorId,
          path: anchor.path,
          lines: [anchor.startLine, anchor.endLine],
        })),
      )}`,
    );
  }

  if (rejected.length) blocks.push(`Rejeitados: ${rejected.join('; ')}`);
  return blocks.join('\n');
};
