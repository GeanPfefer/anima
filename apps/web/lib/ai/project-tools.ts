import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

type JsonObject = Record<string, unknown>;

const MAX_OUTPUT_CHARS = 48_000;
const MAX_READ_LINES = 400;
const MAX_TOOL_CALLS = 10;

const BLOCKED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.worktrees',
  '.claude',
]);

const BLOCKED_FILE = /(^|\/)(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|id_(?:rsa|ed25519))(?:$|\/)/i;

export const PROJECT_TOOL_CALL_LIMIT = MAX_TOOL_CALLS;

export const OPENAI_PROJECT_TOOLS = [
  {
    type: 'function',
    name: 'project_search',
    description: 'Procura texto literal no repositório autorizado do Anima e devolve caminhos e linhas. Use antes de afirmar onde algo está implementado.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto literal a procurar.' },
        path: { type: ['string', 'null'], description: 'Subdiretório relativo opcional, como apps/web.' },
      },
      required: ['query', 'path'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'project_read_file',
    description: 'Lê um intervalo limitado de linhas de um arquivo não secreto do repositório autorizado.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo do arquivo.' },
        start_line: { type: 'integer', minimum: 1, description: 'Primeira linha, começando em 1.' },
        end_line: { type: 'integer', minimum: 1, description: 'Última linha inclusiva; no máximo 400 linhas por chamada.' },
      },
      required: ['path', 'start_line', 'end_line'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'project_list_files',
    description: 'Lista arquivos não secretos do repositório, opcionalmente filtrados por texto no caminho.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: ['string', 'null'], description: 'Subdiretório relativo opcional.' },
        contains: { type: ['string', 'null'], description: 'Texto opcional que deve aparecer no caminho.' },
      },
      required: ['path', 'contains'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'project_git_status',
    description: 'Mostra o estado Git atual do projeto e alterações não versionadas, sem modificar o repositório.',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'project_git_diff',
    description: 'Mostra o diff Git atual, limitado. Pode restringir a um caminho relativo não secreto.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: ['string', 'null'], description: 'Arquivo ou diretório relativo opcional.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
] as const;

function projectRoot(): string {
  return resolve(process.env.ANIMA_PROJECT_ROOT ?? resolve(process.cwd(), '..', '..'));
}

function safeRelativePath(value: unknown, allowRoot = false): string {
  if (typeof value !== 'string') {
    if (allowRoot && (value === null || value === undefined)) return '';
    throw new Error('Caminho inválido.');
  }
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized && allowRoot) return '';
  if (!normalized || isAbsolute(normalized) || normalized.split('/').includes('..')) throw new Error('Caminho fora do projeto.');
  const segments = normalized.toLowerCase().split('/');
  if (segments.some(segment => BLOCKED_SEGMENTS.has(segment)) || BLOCKED_FILE.test(`/${normalized}`)) throw new Error('Arquivo sensível ou interno bloqueado.');
  const root = projectRoot();
  const target = resolve(root, normalized);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel) || target === root) throw new Error('Caminho fora do projeto.');
  return normalized;
}

function visiblePath(path: string): boolean {
  try {
    safeRelativePath(path);
    return true;
  } catch {
    return false;
  }
}

function clipped(value: string): { text: string; truncated: boolean } {
  return value.length <= MAX_OUTPUT_CHARS
    ? { text: value, truncated: false }
    : { text: value.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}

function run(file: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise(resolveResult => {
    execFile(file, args, {
      cwd: projectRoot(),
      windowsHide: true,
      maxBuffer: 2_000_000,
      timeout: 15_000,
      killSignal: 'SIGTERM',
    }, (error, stdout, stderr) => {
      const code = typeof (error as NodeJS.ErrnoException & { code?: unknown } | null)?.code === 'number'
        ? (error as unknown as { code: number }).code
        : error ? 1 : 0;
      resolveResult({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });
}

function parsedArgs(value: string): JsonObject {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Argumentos inválidos.');
  return parsed as JsonObject;
}

async function search(args: JsonObject): Promise<unknown> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query || query.length > 300) throw new Error('Consulta vazia ou longa demais.');
  const path = safeRelativePath(args.path, true);
  const command = ['-n', '--no-heading', '--color', 'never', '--fixed-strings', '--glob', '!*.env*', '--glob', '!.git/**', '--glob', '!node_modules/**', '--glob', '!.next/**', '--', query];
  command.push(path || '.');
  const result = await run('rg', command);
  const lines = result.stdout.split(/\r?\n/).filter(Boolean).filter(line => visiblePath(line.split(':', 1)[0] ?? '')).slice(0, 120);
  return { query, path: path || '.', matches: lines, truncated: result.stdout.split(/\r?\n/).filter(Boolean).length > lines.length };
}

async function readProjectFile(args: JsonObject): Promise<unknown> {
  const path = safeRelativePath(args.path);
  const start = Number.isInteger(args.start_line) ? Number(args.start_line) : 1;
  const requestedEnd = Number.isInteger(args.end_line) ? Number(args.end_line) : start + 199;
  if (start < 1 || requestedEnd < start) throw new Error('Intervalo de linhas inválido.');
  const end = Math.min(requestedEnd, start + MAX_READ_LINES - 1);
  const target = resolve(projectRoot(), path);
  if (!(await stat(target)).isFile()) throw new Error('O caminho não é um arquivo.');
  const lines = (await readFile(target, 'utf8')).split(/\r?\n/);
  const content = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n');
  return { path, startLine: start, endLine: Math.min(end, lines.length), totalLines: lines.length, ...clipped(content) };
}

async function listFiles(args: JsonObject): Promise<unknown> {
  const path = safeRelativePath(args.path, true);
  const contains = typeof args.contains === 'string' ? args.contains.toLowerCase() : '';
  const command = ['--files', '--glob', '!*.env*', '--glob', '!.git/**', '--glob', '!node_modules/**', '--glob', '!.next/**'];
  if (path) command.push(path);
  const result = await run('rg', command);
  const files = result.stdout.split(/\r?\n/).filter(Boolean).map(item => item.replace(/\\/g, '/')).filter(visiblePath).filter(item => !contains || item.toLowerCase().includes(contains)).slice(0, 300);
  return { path: path || '.', contains: contains || null, files, truncated: files.length === 300 };
}

async function gitStatus(): Promise<unknown> {
  const result = await run('git', ['status', '--short', '--branch']);
  return { ...clipped(result.stdout), stderr: result.stderr, exitCode: result.code };
}

async function gitDiff(args: JsonObject): Promise<unknown> {
  const path = safeRelativePath(args.path, true);
  const command = ['diff', '--no-ext-diff', '--'];
  if (path) command.push(path);
  const result = await run('git', command);
  return { path: path || null, ...clipped(result.stdout), stderr: result.stderr, exitCode: result.code };
}

export async function executeProjectTool(name: string, rawArguments: string): Promise<string> {
  try {
    const args = parsedArgs(rawArguments);
    const result = name === 'project_search' ? await search(args)
      : name === 'project_read_file' ? await readProjectFile(args)
      : name === 'project_list_files' ? await listFiles(args)
      : name === 'project_git_status' ? await gitStatus()
      : name === 'project_git_diff' ? await gitDiff(args)
      : (() => { throw new Error('Ferramenta desconhecida.'); })();
    return JSON.stringify({ ok: true, result });
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Falha na ferramenta.' });
  }
}
