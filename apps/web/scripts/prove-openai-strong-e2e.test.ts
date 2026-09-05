import { describe, expect, it, vi } from 'vitest';

vi.mock('@/cli/identity', () => ({
  resolveCliIdentity: () => new Promise(() => {}),
}));

import { resolveTaskMessage } from './prove-openai-strong-e2e';

describe('resolveTaskMessage', () => {
  it('lê, valida e normaliza a mensagem usando o leitor injetado', async () => {
    const readFile = vi.fn().mockResolvedValue('  Corrija o fluxo de planejamento.\n');

    await expect(resolveTaskMessage('/tmp/task.md', readFile)).resolves.toBe('Corrija o fluxo de planejamento.');
    expect(readFile).toHaveBeenCalledWith('/tmp/task.md');
  });

  it('rejeita arquivo com mensagem vazia antes de criar trabalho', async () => {
    await expect(resolveTaskMessage('/tmp/task.md', async () => ' \n ')).rejects.toThrow(
      'A mensagem da tarefa em /tmp/task.md está vazia.',
    );
  });

  it('exige um caminho de arquivo configurado', async () => {
    await expect(resolveTaskMessage(undefined, async () => 'não deve ler')).rejects.toThrow(
      'Defina ANIMA_STRONG_E2E_TASK_FILE',
    );
  });
});
