import { describe, expect, it } from 'vitest';
import { resolveTaskMessage } from './prove-openai-strong-e2e';

describe('resolveTaskMessage', () => {
  it('aceita uma mensagem inline', async () => {
    await expect(resolveTaskMessage(['--message', 'Corrija o teste focado.']))
      .resolves.toBe('Corrija o teste focado.');
  });

  it('carrega a mensagem de um arquivo', async () => {
    const readTaskFile = async (path: string) => {
      expect(path).toBe('task.txt');
      return 'Implemente a tarefa do arquivo.';
    };

    await expect(resolveTaskMessage(['--message-file', 'task.txt'], readTaskFile))
      .resolves.toBe('Implemente a tarefa do arquivo.');
  });

  it('exige exatamente uma fonte de mensagem', async () => {
    await expect(resolveTaskMessage([])).rejects.toThrow('exclusivamente uma mensagem');
    await expect(resolveTaskMessage(['--message', 'inline', '--message-file', 'task.txt']))
      .rejects.toThrow('exclusivamente uma mensagem');
  });
});
