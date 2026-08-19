/** @jest-environment node */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createNodeHarnessFileSystem,
  createNodeHarnessSpawner,
} from './node-harness-runtime';

describe('Node Harness runtime edge', () => {
  test('filesystem localiza sess?o no DSH_HOME isolado e l? o log zstd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'anima-harness-edge-'));

    try {
      const session = join(root, 'sessions', 'project-key', 'session-abc');
      await mkdir(session, { recursive: true });

      const payload = Buffer.from('zstd-placeholder');
      await writeFile(join(session, 'session.jsonl.zstd'), payload);

      const fs = createNodeHarnessFileSystem();
      const dirs = await fs.listSessionDirs(root, 'G:/anima/worktree');

      expect(dirs).toEqual([session]);
      expect(await fs.readSessionLog(session)).toEqual(payload);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('spawner executa processo sem shell e observa exitCode real', async () => {
    const spawner = createNodeHarnessSpawner();

    const result = await spawner.run({
      command: process.execPath,
      args: ['-e', 'process.exit(7)'],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      exitCode: 7,
      hostAborted: false,
    });
  });

  test('spawner isola credenciais (env mínimo) e garante SystemRoot não vazio no Windows', async () => {
    const spawner = createNodeHarnessSpawner();

    // Injetamos credenciais reais no processo pai para provar que o spawner NUNCA
    // herda process.env: se algum dia alguém trocar para {...process.env, ...},
    // o filho enxergaria estas chaves e o teste falharia com exit 22/23. A checagem
    // 24 garante que, no Windows, o filho recebe um SystemRoot NÃO VAZIO (node.exe
    // aborta com exit 134 quando SystemRoot existe vazio).
    const previousOpenAi = process.env.OPENAI_API_KEY;
    const previousDeepSeek = process.env.DEEPSEEK_API_KEY;
    process.env.OPENAI_API_KEY = 'leak-canary-openai';
    process.env.DEEPSEEK_API_KEY = 'leak-canary-deepseek';

    try {
      const result = await spawner.run({
        command: process.execPath,
        args: [
          '-e',
          [
            "if (process.env.DSH_HOME !== 'isolated-home') process.exit(21)",
            "if (process.env.OPENAI_API_KEY !== undefined) process.exit(22)",
            "if (process.env.DEEPSEEK_API_KEY !== undefined) process.exit(23)",
            "if (process.platform === 'win32' && !process.env.SystemRoot) process.exit(24)",
            "process.exit(0)",
          ].join(';'),
        ],
        cwd: process.cwd(),
        env: { DSH_HOME: 'isolated-home' },
        signal: new AbortController().signal,
      });

      expect(result).toEqual({
        exitCode: 0,
        hostAborted: false,
      });
    } finally {
      if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAi;
      if (previousDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousDeepSeek;
    }
  });

  test('spawner distingue cancelamento do host', async () => {
    const spawner = createNodeHarnessSpawner();
    const controller = new AbortController();

    const running = spawner.run({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 50);

    const result = await running;

    expect(result.hostAborted).toBe(true);
  });
});
