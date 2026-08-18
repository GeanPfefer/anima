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
