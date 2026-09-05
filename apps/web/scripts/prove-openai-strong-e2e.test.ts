import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveTaskMessage } from './prove-openai-strong-e2e';

test('resolveTaskMessage accepts a direct message', async () => {
  assert.equal(await resolveTaskMessage('Tarefa direta.'), 'Tarefa direta.');
});

test('resolveTaskMessage reads a UTF-8 task message file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anima-task-message-'));
  const filePath = join(directory, 'task.txt');
  try {
    await writeFile(filePath, 'Tarefa em arquivo UTF-8: ação.', 'utf8');
    assert.equal(
      await resolveTaskMessage({ filePath }),
      'Tarefa em arquivo UTF-8: ação.',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('resolveTaskMessage hides file details when loading fails', async () => {
  const sensitivePath = '/tmp/secret-token-should-not-appear.txt';
  await assert.rejects(
    () => resolveTaskMessage({ filePath: sensitivePath }),
    error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Não foi possível carregar a mensagem da tarefa a partir do arquivo UTF-8.');
      assert.doesNotMatch(error.message, /secret-token-should-not-appear/);
      return true;
    },
  );
});
