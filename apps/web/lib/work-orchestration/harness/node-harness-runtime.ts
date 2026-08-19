import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DeepSeekHarnessCoderBackend } from '../deepseek-harness-coder';
import { DeepSeekHarnessRuntime } from './deepseek-harness-runtime';
import type {
  HarnessFileSystem,
  HarnessProcessResult,
  HarnessSpawner,
} from './deepseek-harness-runtime';

/**
 * Borda Node real do Harness.
 *
 * Cada execu??o do Anima recebe um DSH_HOME novo e isolado. O profile base do DSH
 * persiste sess?es sob `$DSH_HOME/sessions`; portanto n?o copiamos o algoritmo
 * privado `projectKey(cwd)`: enumeramos somente esse root isolado e devolvemos
 * diret?rios de sess?o mais novos primeiro.
 */
export function createNodeHarnessFileSystem(): HarnessFileSystem {
  return {
    mkdirp: async dir => {
      await mkdir(dir, { recursive: true });
    },

    writeFile: async (path, content) => {
      await writeFile(path, content, 'utf8');
    },

    listSessionDirs: async (dshHome, _cwd) => {
      const sessionsRoot = join(dshHome, 'sessions');

      let projects;
      try {
        projects = await readdir(sessionsRoot, { withFileTypes: true });
      } catch {
        return [];
      }

      const candidates: Array<{ path: string; mtimeMs: number }> = [];

      for (const project of projects) {
        if (!project.isDirectory()) continue;

        const projectPath = join(sessionsRoot, project.name);

        let sessions;
        try {
          sessions = await readdir(projectPath, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const session of sessions) {
          if (!session.isDirectory()) continue;

          const sessionPath = join(projectPath, session.name);

          try {
            const info = await stat(sessionPath);
            candidates.push({
              path: sessionPath,
              mtimeMs: info.mtimeMs,
            });
          } catch {
            // Sess?o desapareceu entre readdir/stat: ignora e continua.
          }
        }
      }

      return candidates
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .map(candidate => candidate.path);
    },

    readSessionLog: async sessionDir => {
      // rc.7 usa zstd por default no session-persistence-jsonl.
      try {
        return await readFile(join(sessionDir, 'session.jsonl.zstd'));
      } catch {
        // Mantemos compatibilidade fail-closed com uma eventual configura??o
        // expl?cita sem compress?o; o runtime decide se o conte?do ? utiliz?vel.
        try {
          return await readFile(join(sessionDir, 'session.jsonl'));
        } catch {
          return null;
        }
      }
    },
  };
}

/**
 * Spawner Node real: sem shell, cwd expl?cito, env expl?cito e cancelamento do
 * host conectado diretamente ao processo filho. C?digo de sa?da ? evid?ncia,
 * nunca exce??o.
 */
export function createNodeHarnessSpawner(): HarnessSpawner {
  return {
    run: input => new Promise<HarnessProcessResult>(resolve => {
      // O subprocesso do Harness recebe deliberadamente um ambiente MÍNIMO: assim o
      // coder nunca herda credenciais do processo web (OPENAI_API_KEY,
      // DEEPSEEK_API_KEY, segredos do Supabase etc.) — essa é a razão principal.
      //
      // Sobre o SystemRoot no Windows (medido, não suposto): node.exe ABORTA na
      // inicialização (exit 134, assert CSPRNG) quando SystemRoot está presente como
      // string VAZIA; o libuv só reabastece SystemRoot no filho quando a CHAVE está
      // AUSENTE (chave presente e vazia é mantida vazia). Como o overlay do planejador
      // OMITE SystemRoot, o caso normal já é seguro pelo reabastecimento do libuv — não
      // é a causa da falha viva observada, que permanece não reproduzida. Ainda assim
      // garantimos explicitamente um SystemRoot NÃO VAZIO para não depender desse
      // comportamento não documentado do libuv e para blindar o único modo de crash
      // reproduzível (vazio ⇒ 134). O overlay do Harness segue autoridade das demais.
      const winSystemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
      const runtimeEnv: Record<string, string> = {
        ...(process.platform === 'win32' ? { SystemRoot: winSystemRoot } : {}),
        ...input.env,
      };

      const child = spawn(input.command, [...input.args], {
        cwd: input.cwd,
        // Node/Next estreita ProcessEnv exigindo NODE_ENV no tipo global, embora
        // spawn aceite normalmente este mapa parcial em runtime.
        env: runtimeEnv as NodeJS.ProcessEnv,
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });

      let settled = false;
      let hostAborted = false;

      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        input.signal.removeEventListener('abort', onAbort);
        resolve({ exitCode, hostAborted });
      };

      const onAbort = (): void => {
        hostAborted = true;
        child.kill();
      };

      if (input.signal.aborted) {
        onAbort();
      } else {
        input.signal.addEventListener('abort', onAbort, { once: true });
      }

      child.on('error', () => finish(-1));
      child.on('close', code => finish(code));
    }),
  };
}


export interface NodeDeepSeekHarnessBackendOptions {
  readonly model: string;
  /** Raiz do checkout do Anima, usada somente para localizar o plugin versionado. */
  readonly repoRoot: string;
  readonly ollamaBaseUrl?: string;
  readonly gateStepBudget?: number;
}

/**
 * Monta a borda real do CoderBackend DeepSeek Harness.
 *
 * `require.resolve` ? deliberadamente usado no lado servidor para resolver a
 * instala??o efetiva do pacote, em vez de fixar um caminho de node_modules.
 */
export function createNodeDeepSeekHarnessBackend(
  options: NodeDeepSeekHarnessBackendOptions,
): DeepSeekHarnessCoderBackend {
  const packageJson = require.resolve('@deepseek-ai/dsh/package.json');
  const dshBinPath = resolve(dirname(packageJson), 'lib', 'bin.js');
  const pluginPath = resolve(
    options.repoRoot,
    'apps',
    'web',
    'lib',
    'work-orchestration',
    'harness',
    'anima-harness-plugin.mjs',
  );

  const runtime = new DeepSeekHarnessRuntime({
    nodeExecPath: process.execPath,
    dshBinPath,
    pluginPath,
    ollamaBaseUrl: options.ollamaBaseUrl ?? 'http://127.0.0.1:11434/v1',
    model: options.model,
    dshHomeFactory: () => {
      // DeepSeekHarnessRuntime espera uma f?brica s?ncrona. O diret?rio-base ?
      // ?nico por processo/turno; mkdirp materializa o caminho depois.
      return join(
        tmpdir(),
        `anima-dsh-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
    },
    fs: createNodeHarnessFileSystem(),
    spawner: createNodeHarnessSpawner(),
  });

  return new DeepSeekHarnessCoderBackend({
    runtime,
    model: options.model,
    ...(options.gateStepBudget !== undefined
      ? { stepBudget: options.gateStepBudget }
      : {}),
  });
}
