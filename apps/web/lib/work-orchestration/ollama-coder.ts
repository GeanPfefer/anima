import { coderBackendId, type CoderBackend, type CoderEditRequest, type CoderEditResult, type CoderWorkspace } from './coder-backend';
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
  writeChangeSet,
  type ContextBudget,
  type ManifestInputFile,
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
}

const SYSTEM = [
  'Você edita um repositório por um PROTOCOLO LIMITADO em JSON. Nunca recebe nem devolve arquivos inteiros.',
  'Você recebe um MANIFESTO (caminho, tamanho, sha256, estrutura) e pode pedir TRECHOS antes de editar.',
  'Responda SEMPRE com UM objeto JSON, sem texto fora dele, em uma destas formas:',
  'LER: {"action":"read","reads":[{"path":"<do escopo>","search":"<termo opcional>","lineRange":[inicio,fim],"contextBefore":3,"contextAfter":3,"maxLines":60}]}',
  'EDITAR: {"action":"edit","operations":[{"kind":"replace_exact","path":"<do escopo>","expected_file_sha256":"<sha do arquivo como lido>","before":"<texto EXATO e ÚNICO do arquivo atual>","after":"<novo texto>","expected_occurrences":1}]}',
  'Também é permitido {"kind":"create_file","path":"<do escopo>","content":"<conteúdo>"} para arquivo NOVO. Exclusão não é permitida.',
  'Acrescentar ao FIM de arquivo existente: {"kind":"append","path":"<escopo>","expected_file_sha256":"<sha lido>","content":"<texto>"}. Não invente "before" para o fim.',
  'Regras: só caminhos do escopo; "before" deve ser copiado EXATAMENTE de um trecho lido e ocorrer uma única vez; use o sha256 do arquivo como lido; peça leituras antes de editar; não explique.',
].join('\n');

const clip = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max)}…`);

export class OllamaCoderBackend implements CoderBackend {
  readonly id: string;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxReadRounds: number;
  private readonly budget: ContextBudget;

  constructor(private readonly options: OllamaCoderOptions) {
    this.id = options.backendId ?? coderBackendId('ollama', options.model);
    this.url = options.url ?? process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxReadRounds = Math.max(1, Math.min(options.maxReadRounds ?? 3, 6));
    this.budget = resolveContextBudget({
      declaredContextLength: options.declaredContextLength ?? null,
      operationalCap: options.operationalContextCap ?? 8192,
      outputReserveTokens: options.outputReserveTokens ?? 1536,
      numPredict: options.numPredict ?? 1536,
    });
  }

  async edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult> {
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
    const header = [
      `Tarefa: ${request.objective}`,
      `Escopo permitido (só estes caminhos): ${scope.join(', ')}`,
      `Fora do escopo (não toque): ${request.excludedScope.join('; ')}`,
      `Manifesto (sem conteúdo integral): ${JSON.stringify(manifest)}`,
    ].join('\n') + carried;

    const servedBlocks: string[] = [];
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
      const prompt = [
        header,
        servedBlocks.length ? `Contexto já fornecido:\n${servedBlocks.join('\n')}` : 'Nenhum trecho fornecido ainda.',
        budgetLine,
      ].join('\n\n');

      const response = await this.callProtocol(prompt, signal);

      if (response.action === 'edit') {
        const operations = parseEditOperations(response.operations as unknown[], allowed);
        const changes = applyEditOperations(operations, contentOf);
        // Validação integral contra o snapshot já ocorreu (applyEditOperations).
        // Aqui só escrevemos o lote (escreve-ou-lança, nunca sucesso parcial). A
        // restauração ao estado-base em caso de falha é da worktree (autoridade
        // única, via WorktreeExecutorAdapter → GitWorktree.restoreToBase).
        const touched = await writeChangeSet(
          changes,
          { writeFile: (path, content) => workspace.writeFile(path, content) },
          signal,
        );
        return {
          summary: `Modelo Ollama ${this.options.model} aplicou ${touched.length} edição(ões) estruturada(s) por protocolo limitado, para revisão.`,
          touchedResources: touched,
        };
      }

      // action === 'read'
      if (roundsLeft <= 0) {
        throw new OllamaProtocolError('ollama_read_round_limit', `o modelo esgotou as ${this.maxReadRounds} rodadas de leitura sem propor edições.`);
      }
      const { requests, rejected } = parseReadRequests(response.reads as unknown[], allowed);
      const { served, rejected: missing } = serveReadRequests(requests, contentOf);
      servedBlocks.push(renderServed(served, [...rejected, ...missing]));
    }
    throw new OllamaProtocolError('ollama_read_round_limit', 'protocolo encerrou sem edições.');
  }

  /** Uma volta do protocolo: chama o modelo, checa truncamento e parseia o
   * envelope. Um ÚNICO reparo é permitido quando o schema vem errado — apenas
   * reforçando o formato, sem reapresentar conteúdo algum. */
  private async callProtocol(prompt: string, signal: AbortSignal) {
    const messages = [{ role: 'system' as const, content: SYSTEM }, { role: 'user' as const, content: prompt }];
    assertPromptWithinBudget(SYSTEM + prompt, this.budget);
    const first = await callOllamaChat({ url: this.url, model: this.options.model, messages, budget: this.budget, timeoutMs: this.timeoutMs, fetchImpl: this.fetchImpl, signal });
    assertNotTruncated(SYSTEM + prompt, first.meta);
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
      const repairText = SYSTEM + prompt + assistantEcho + repairInstruction;
      assertPromptWithinBudget(repairText, this.budget);
      const repaired = await callOllamaChat({ url: this.url, model: this.options.model, messages: repairMessages, budget: this.budget, timeoutMs: this.timeoutMs, fetchImpl: this.fetchImpl, signal });
      assertNotTruncated(repairText, repaired.meta);
      return parseProtocolResponse(repaired.content);
    }
  }
}

const renderServed = (served: readonly ServedRead[], rejected: readonly string[]): string => {
  const blocks = served.map(item => `Arquivo ${item.path} (sha256 ${item.sha256}):\n${item.slice}`);
  if (rejected.length) blocks.push(`Rejeitados: ${rejected.join('; ')}`);
  return blocks.join('\n');
};
