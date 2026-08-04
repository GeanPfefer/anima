import type { CoderBackend, CoderEditRequest, CoderEditResult, CoderWorkspace } from './coder-backend';

// ============================================================
// Backend de código LOCAL (Ollama) por trás da interface CoderBackend (ADR-001).
//
// É uma das inteligências SELECIONÁVEIS: o adaptador de worktree e o Supervisor
// não conhecem Ollama — recebem um CoderBackend. Single-shot e confinado: lê os
// arquivos do escopo, pede ao modelo o conteúdo novo COMPLETO de cada um em JSON
// e escreve só caminhos do escopo (as guardas do worktree ainda valem por cima).
// Não é agêntico (sem laço de ferramentas): a validação real é o gate, e o
// resultado sempre vai para revisão humana.
// ============================================================

export interface OllamaCoderOptions {
  readonly model: string;
  readonly url?: string;
  readonly timeoutMs?: number;
  /** Injeção para teste; por padrão o fetch global. */
  readonly fetchImpl?: typeof fetch;
}

interface ModelFile { readonly path: string; readonly content: string; }

const SYSTEM = [
  'Você é um engenheiro que edita um repositório TypeScript.',
  'Receberá um objetivo e o conteúdo atual dos arquivos DENTRO do escopo permitido.',
  'Responda SOMENTE com JSON no formato {"files":[{"path":"<caminho relativo exato do escopo>","content":"<conteúdo COMPLETO novo do arquivo>"}]}.',
  'Inclua apenas arquivos do escopo permitido. O content é o arquivo inteiro, nunca um diff. Não explique.',
].join(' ');

export class OllamaCoderBackend implements CoderBackend {
  readonly id: string;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: OllamaCoderOptions) {
    this.id = `ollama:${options.model}`;
    this.url = options.url ?? process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult> {
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

    const response = await this.fetchImpl(`${this.url}/api/chat`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.options.model, stream: false, format: 'json',
        options: { num_ctx: 8192, temperature: 0 },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
      }),
    }).catch(() => null);

    if (!response || !response.ok) throw new Error(`O modelo local não respondeu (${response ? response.status : 'sem conexão'}).`);
    const body = await response.json().catch(() => null) as { message?: { content?: string } } | null;
    const files = this.parseFiles(body?.message?.content ?? '', new Set(scope));
    if (files.length === 0) throw new Error('O modelo local não retornou arquivos válidos dentro do escopo.');

    const touched: string[] = [];
    for (const file of files) {
      if (signal.aborted) break;
      if (await workspace.writeFile(file.path, file.content)) touched.push(file.path);
    }
    if (touched.length === 0) throw new Error('Nenhum arquivo do escopo pôde ser escrito.');
    return { summary: `Modelo local ${this.options.model} editou ${touched.length} arquivo(s) do escopo, para validação.`, touchedResources: touched };
  }

  private parseFiles(raw: string, allowed: ReadonlySet<string>): ModelFile[] {
    try {
      const root = JSON.parse(raw) as { files?: unknown };
      if (!Array.isArray(root.files)) return [];
      const out: ModelFile[] = [];
      for (const entry of root.files) {
        if (!entry || typeof entry !== 'object') continue;
        const candidate = entry as { path?: unknown; content?: unknown };
        if (typeof candidate.path !== 'string' || typeof candidate.content !== 'string') continue;
        const path = candidate.path.replace(/\\/g, '/');
        if (allowed.has(path)) out.push({ path, content: candidate.content });
      }
      return out;
    } catch { return []; }
  }
}
