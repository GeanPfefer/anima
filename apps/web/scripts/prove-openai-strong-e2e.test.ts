import { describe, expect, it } from 'vitest';
import { resolveTaskMessage } from './prove-openai-strong-e2e';

describe('resolveTaskMessage', () => {
  it('resolve uma mensagem direta válida', async () => {
    await expect(resolveTaskMessage(['--message', '  Planeje esta tarefa.  ']))
      .resolves.toBe('Planeje esta tarefa.');
  });

  it('resolve e normaliza a mensagem de --message-file', async () => {
    const readFile = async (path: string) => {
      expect(path).toBe('task.txt');
      return '\nTarefa vinda do arquivo.\n';
    };

    await expect(resolveTaskMessage(['--message-file', 'task.txt'], readFile))
      .resolves.toBe('Tarefa vinda do arquivo.');
  });

  it('rejeita ausência, conflito e conteúdo vazio', async () => {
    await expect(resolveTaskMessage([])).rejects.toThrow('--message ou --message-file');
    await expect(resolveTaskMessage(['--message', 'a', '--message-file', 'task.txt']))
      .rejects.toThrow('exatamente uma');
    await expect(resolveTaskMessage(['--message', '   '])).rejects.toThrow('não pode estar vazia');
  });
});
