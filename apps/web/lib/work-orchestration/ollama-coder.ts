import { OllamaTranscript } from './ollama-transcript';
import { coderBackendId, type CoderBackend, type CoderEditRequest, type CoderEditResult, type CoderWorkspace } from './coder-backend';
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
  parseProtocolResponse,
  parseReadRequests,
  resolveContextBudget,
  serveReadRequests,
  sha256,
  writeChangeSet,
  type ContextBudget,
  type ManifestInputFile,
  type OllamaChatResult,
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
  /** Rodadas máximas de leitura antes de exigir edição. Pequeno de propósito. */
  readonly maxReadRounds?: number;
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
export interface CoderProtocolTransportInput { readonly messages: readonly CoderProtocolMessage[]; readonly signal: AbortSignal; readonly timeoutMs: number }
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
  private readonly maxReadRounds: number;
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
    this.maxReadRounds = Math.max(1, Math.min(options.maxReadRounds ?? 3, 6));
    this.providerLabel = options.providerLabel ?? `Ollama ${options.model}`;
    this.budget = resolveContextBudget({
      declaredContextLength: options.declaredContextLength ?? null,
      operationalCap: options.operationalContextCap ?? 8192,
      outputReserveTokens: options.outputReserveTokens ?? 1536,
      numPredict: options.numPredict ?? 1536,
    });
  }

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
    const scope = request.includedScope.map(path => path.replace(/\\/g, '/'));
    const allowed = new Set(scope);

    // Lê o conteúdo atual do escopo UMA vez (para manifesto, trechos e aplicação).
    // Nada é injetado inteiro no prompt — só o manifesto e trechos sob demanda.
    const cache = new Map<string, string | null>();
    for (const path of scope) cache.set(path, await workspace.readFile(path));
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
    const header = [
      `Tarefa: ${request.objective}`,
      `Escopo permitido (só estes caminhos): ${scope.join(', ')}`,
      `Fora do escopo (não toque): ${request.excludedScope.join('; ')}`,
      `Manifesto (sem conteúdo integral): ${JSON.stringify(manifest)}`,
      ...(repairContext ? [repairContext] : []),
    ].join('\n') + carried;

    const servedBlocks: string[] = [];
    const servedFingerprints = new Set<string>();
    let totalReadRequests = 0;
    let uniqueServedReads = 0;
    let repeatedServedReads = 0;
    const repeatedReadDescriptors = new Set<string>();
    const experimentalAnchors = new Map<string, ServedAnchor>();
    let experimentalAnchorOrdinal = 0;
    // Teto próprio de reapresentações por âncora ambígua (independente das rodadas de
    // leitura): mantém a recuperação BOUNDED — nunca um laço ilimitado de edição.
    const MAX_AMBIGUITY_FEEDBACKS = 2;
    let ambiguityFeedbacks = 0;

    for (let round = 0; round <= this.maxReadRounds; round++) {
      const roundsLeft = this.maxReadRounds - round;
      // Na última volta (sem rodadas de leitura restantes) o prompt EXIGE edição e
      // não oferece leitura: um {"action":"read"} aqui só seria recusado
      // (ollama_read_round_limit), então oferecê-lo desperdiça a última chance de
      // o modelo editar. É clareza de prompt, não mudança do contrato do protocolo.
      const budgetLine = roundsLeft <= 0
        ? 'Orçamento: 0 rodadas de leitura restantes. Você DEVE responder agora com {"action":"edit",...}. Um novo pedido de leitura será recusado e encerrará a tentativa sem edição.'
        : roundsLeft === 1
          ? 'Orçamento: 1 rodada de leitura restante — a última. Peça {"action":"read",...} agora ou já aplique {"action":"edit",...}; depois só edição será aceita.'
          : `Orçamento: ${roundsLeft} rodadas de leitura restantes. Peça {"action":"read",...} ou aplique {"action":"edit",...}.`;
      const progressLine = totalReadRequests === 0
        ? null
        : `Progresso host: requests=${totalReadRequests}; novos=${uniqueServedReads}; repetidos=${repeatedServedReads}.${repeatedServedReads > 0
          ? ` Repetições idênticas não foram duplicadas: ${[...repeatedReadDescriptors].join(', ')}. Não repita; edite ou leia região diferente.`
          : ''}`;
      const prompt = [
        header,
        servedBlocks.length ? `Contexto já fornecido:\n${servedBlocks.join('\n')}` : 'Nenhum trecho fornecido ainda.',
        ...(progressLine ? [progressLine] : []),
        budgetLine,
      ].join('\n\n');

      const response = await this.callProtocol(prompt, signal);

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
            allowedPaths: allowed,
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

        // Caminho vigente de produção: semanticamente inalterado.
        // Se replace_anchor aparecer sem opt-in, parseEditOperations o recusa
        // fail-closed como operação desconhecida.
        const operations = parseEditOperations(rawOperations, allowed);
        const steps = operations.map(op => transcript.edit(op, contentOf(op.path), round));
        let changes;
        try { changes = applyEditOperations(operations, contentOf); }
        catch (error) {
          transcript.application(steps, 'batch_failed');
          // Âncora ambígua é RECUPERÁVEL: nenhuma mutação, gate ou perda de integridade
          // ocorreu. Enquanto houver rodada e dentro do teto próprio, o host devolve ao
          // modelo as ocorrências e pede um `before`/`anchor` mais específico ou `in_lines`
          // — sem "escolher a primeira" nem afrouxar. Esgotado o teto/as rodadas: terminal.
          // Stale/scope/no-op continuam fail-closed terminais (não são reapresentados).
          if (error instanceof OllamaProtocolError && error.code === 'ollama_ambiguous_replacement'
              && roundsLeft > 0 && ambiguityFeedbacks < MAX_AMBIGUITY_FEEDBACKS) {
            ambiguityFeedbacks += 1;
            servedBlocks.push(`Edição recusada (âncora ambígua), NADA foi aplicado: ${error.message} Reapresentação ${ambiguityFeedbacks}/${MAX_AMBIGUITY_FEEDBACKS}. Reenvie uma edição com "before"/"anchor" mais específico ou com "in_lines":[inicio,fim] do intervalo lido que contém a ocorrência desejada.`);
            continue;
          }
          throw error;
        }
        // Validação integral contra o snapshot já ocorreu (applyEditOperations).
        // Aqui só escrevemos o lote (escreve-ou-lança, nunca sucesso parcial). A
        // restauração ao estado-base em caso de falha é da worktree (autoridade
        // única, via WorktreeExecutorAdapter → GitWorktree.restoreToBase).
        let touched;
        try { touched = await writeChangeSet(
          changes,
          { writeFile: (path, content) => workspace.writeFile(path, content) },
          signal,
        ); } catch (error) { transcript.application(steps, 'write_failed'); throw error; }
        transcript.application(steps, 'applied');
        return {
          summary: `Modelo ${this.providerLabel} aplicou ${touched.length} edição(ões) estruturada(s) por protocolo limitado, para revisão.`,
          touchedResources: touched,
        };
      }

      // action === 'read'
      if (roundsLeft <= 0) {
        throw new OllamaProtocolError('ollama_read_round_limit', `o modelo esgotou as ${this.maxReadRounds} rodadas de leitura sem propor edições.`);
      }
      const { requests, rejected } = parseReadRequests(response.reads as unknown[], allowed);
      const { served, rejected: missing } = serveReadRequests(requests, contentOf);
      totalReadRequests += requests.length;

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
              allowedPaths: allowed,
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
      ));
    }
    throw new OllamaProtocolError('ollama_read_round_limit', 'protocolo encerrou sem edições.');
  }

  /** Uma volta do protocolo: chama o modelo, checa truncamento e parseia o
   * envelope. Um ÚNICO reparo é permitido quando o schema vem errado — apenas
   * reforçando o formato, sem reapresentar conteúdo algum. */
  private async callProtocol(prompt: string, signal: AbortSignal) {
    const system = this.options.experimentalAnchorMode
      ? [
          SYSTEM,
          EXPERIMENTAL_ANCHOR_SYSTEM,
          ...(this.options.experimentalAnchorMode.readGuidance === 'narrow-target-v1'
            ? [EXPERIMENTAL_ANCHOR_NARROW_READ_GUIDANCE]
            : this.options.experimentalAnchorMode.readGuidance === 'after-scope-v1'
              ? [EXPERIMENTAL_ANCHOR_AFTER_SCOPE_GUIDANCE]
              : []),
        ].join('\n')
      : SYSTEM;
    const messages = [{ role: 'system' as const, content: system }, { role: 'user' as const, content: prompt }];
    assertPromptWithinBudget(system + prompt, this.budget);
    const invoke = async (callMessages: readonly CoderProtocolMessage[]): Promise<CoderProtocolTransportResult | OllamaChatResult> => this.options.protocolTransport
      ? this.options.protocolTransport({ messages: callMessages, signal, timeoutMs: this.timeoutMs })
      : callOllamaChat({ url: this.url, model: this.options.model, messages: callMessages, budget: this.budget, timeoutMs: this.timeoutMs, fetchImpl: this.fetchImpl, signal });
    const first = await invoke(messages);
    if ('meta' in first) assertNotTruncated(system + prompt, first.meta);
    try {
      return parseProtocolResponse(first.content);
    } catch (error) {
      if (!(error instanceof OllamaProtocolError) || error.code !== 'ollama_invalid_response_schema') throw error;
      // Reparo só-de-schema: NÃO reapresenta conteúdo, só exige o formato.
      const assistantEcho = clip(first.content, 500);
      const repairInstruction = 'Sua resposta não seguiu o schema. Responda SOMENTE com um objeto JSON {"action":"read",...} ou {"action":"edit",...}, sem texto fora dele.';
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

const renderServed = (
  served: readonly ServedRead[],
  rejected: readonly string[],
  experimentalAnchors: readonly ServedAnchor[] = [],
): string => {
  const blocks = served.map(item => `Arquivo ${item.path} (sha256 ${item.sha256}):\n${item.slice}`);

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
