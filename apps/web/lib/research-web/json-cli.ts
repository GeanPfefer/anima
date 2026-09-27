// ============================================================
// Execução de uma CLI externa que responde JSON (Research Web V1).
//
// Mesmo padrão do spawner do Harness (sem shell, env explícito e mínimo, abort
// ligado ao filho), mas capturando o stdout — é nele que vem o JSON.
//
// Armadilha medida no POC do agent-browser (Windows): o primeiro comando de uma
// sessão faz spawn de um daemon que HERDA o pipe de stdout, então o evento
// `close` só chega quando o daemon morre. Por isso resolvemos no `exit` do
// processo (com uma breve drenagem), nunca esperando o `close`.
// ============================================================

import { spawn } from 'node:child_process';

export interface JsonCliRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxStdoutChars: number;
}

export interface JsonCliResult {
  readonly exitCode: number | null;
  readonly json: unknown;
  readonly timedOut: boolean;
  readonly stdoutTruncated: boolean;
  readonly parseError: boolean;
  readonly spawnError?: string;
}

export type JsonCliRunner = (request: JsonCliRequest) => Promise<JsonCliResult>;

/** Variáveis NÃO secretas que o filho precisa para achar perfil/temp do sistema. */
const SYSTEM_ENV_ALLOWLIST = [
  'SystemRoot',
  'windir',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'APPDATA',
  'ProgramData',
  'PATH',
  'LANG',
];

/** Env mínimo: sistema + overlay explícito. Nunca herda credenciais do processo web. */
export function minimalChildEnv(
  overlay: Readonly<Record<string, string>>,
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SYSTEM_ENV_ALLOWLIST) {
    const value = source[key];
    if (typeof value === 'string' && value !== '') env[key] = value;
  }
  return { ...env, ...overlay };
}

function parseLastJsonLine(stdout: string): { json: unknown; parseError: boolean } {
  const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
  const last = lines[lines.length - 1];
  if (last === undefined) return { json: null, parseError: true };
  try {
    return { json: JSON.parse(last) as unknown, parseError: false };
  } catch {
    return { json: null, parseError: true };
  }
}

export const runJsonCli: JsonCliRunner = request =>
  new Promise<JsonCliResult>(resolve => {
    let stdout = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let spawnError: string | undefined;

    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.env as NodeJS.ProcessEnv,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length + chunk.length > request.maxStdoutChars) {
        stdout += chunk.slice(0, Math.max(0, request.maxStdoutChars - stdout.length));
        truncated = true;
      } else {
        stdout += chunk;
      }
    });

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.removeAllListeners('data');
      child.stdout?.destroy();
      const parsed = truncated ? { json: null, parseError: true } : parseLastJsonLine(stdout);
      resolve({
        exitCode,
        json: parsed.json,
        timedOut,
        stdoutTruncated: truncated,
        parseError: parsed.parseError,
        ...(spawnError ? { spawnError } : {}),
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish(null);
    }, request.timeoutMs);

    child.on('error', error => {
      spawnError = error instanceof Error ? error.message : String(error);
      finish(-1);
    });
    // `exit` + drenagem curta: o stdout já foi escrito pela CLI antes de sair.
    child.on('exit', code => setTimeout(() => finish(code), 50));
  });
