import { parseScopedFiles, type CoderBackend, type CoderEditRequest, type CoderEditResult, type CoderWorkspace } from './coder-backend';

// ============================================================
// Backend de código na NUVEM (OpenAI/GPT) por trás da interface CoderBackend
// (ADR-001). É uma das inteligências SELECIONÁVEIS, ao lado do Ollama local: o
// adaptador de worktree e o Supervisor não conhecem OpenAI — recebem um
// CoderBackend. Single-shot e confinado (as guardas do worktree valem por cima;
// a validação real é o gate). A chave vive só no servidor, nunca no bundle
// mobile. Não é agêntico e nunca aplica: o resultado sempre vai para revisão.
// ============================================================

export interface GptCoderOptions {
  readonly model?: string;
  readonly apiKey?: string;
  readonly url?: string;
  /** Injeção para teste; por padrão o fetch global. Nenhum teste chama a API paga. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const SYSTEM = [
  'Você é um engenheiro que edita um repositório TypeScript.',
  'Receberá um objetivo e o conteúdo atual dos arquivos DENTRO do escopo permitido.',
  'Responda SOMENTE com JSON no formato {"files":[{"path":"<caminho relativo exato do escopo>","content":"<conteúdo COMPLETO novo do arquivo>"}]}.',
  'Inclua apenas arquivos do escopo permitido. O content é o arquivo inteiro, nunca um diff. Não explique.',
].join(' ');

function timeoutSignal(milliseconds: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  (timer as NodeJS.Timeout).unref?.();
  return controller.signal;
}

function extractText(body: unknown): string {
  const root = body as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> } | null;
  if (typeof root?.output_text === 'string') return root.output_text;
  return (root?.output ?? [])
    .flatMap(item => item.content ?? [])
    .filter(part => part.type === 'output_text')
    .map(part => part.text ?? '')
    .join('');
}

export class GptCoderBackend implements CoderBackend {
  readonly id: string;
  private readonly model: string;
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GptCoderOptions = {}) {
    this.model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
    this.id = `openai:${this.model}`;
    this.url = options.url ?? 'https://api.openai.com/v1/responses';
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult> {
    if (!this.apiKey) throw new Error('A chave da OpenAI não está configurada no servidor.');
    const scope = request.includedScope.map(path => path.replace(/\\/g, '/'));
    const current: string[] = [];
    for (const path of scope) {
      const content = await workspace.readFile(path);
      current.push(`--- ${path} ---\n${content ?? '(arquivo ainda não existe)'}`);
    }
    const carried = request.carriedContext
      ? `\n\nRetomada — próximo passo: ${request.carriedContext.nextStep}. Restantes: ${request.carriedContext.remainingSteps.join('; ')}.`
      : '';
    const prompt = [
      `Objetivo: ${request.objective}`,
      `Escopo permitido (edite apenas estes caminhos):\n${scope.join('\n')}`,
      `Fora do escopo (não toque): ${request.excludedScope.join('; ')}`,
      `Conteúdo atual:\n${current.join('\n\n')}${carried}`,
    ].join('\n\n');

    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      signal: signal.aborted ? signal : (AbortSignal.any ? AbortSignal.any([signal, timeoutSignal(this.timeoutMs)]) : signal),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, stream: false, store: false, instructions: SYSTEM, input: prompt }),
    }).catch(() => null);

    if (!response || !response.ok) throw new Error(`A OpenAI não respondeu (${response ? response.status : 'sem conexão'}).`);
    const body = await response.json().catch(() => null);
    const files = parseScopedFiles(extractText(body), new Set(scope));
    if (files.length === 0) throw new Error('A OpenAI não retornou arquivos válidos dentro do escopo.');

    const touched: string[] = [];
    for (const file of files) {
      if (signal.aborted) break;
      if (await workspace.writeFile(file.path, file.content)) touched.push(file.path);
    }
    if (touched.length === 0) throw new Error('Nenhum arquivo do escopo pôde ser escrito.');
    return { summary: `Modelo de nuvem ${this.model} editou ${touched.length} arquivo(s) do escopo, para validação.`, touchedResources: touched };
  }
}
