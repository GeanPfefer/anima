import { redactSecrets } from './prove-e2e-redact';

// Testes focados por JEST do harness de prova E2E forte (globais describe/it/expect,
// sem import de framework de teste; jest.fn() para stubs). Novos casos de unidades
// puras do harness (ex.: resolveTaskMessage) devem ser ADICIONADOS aqui, no mesmo
// estilo jest, sem introduzir vitest nem node:test.
describe('redactSecrets', () => {
  it('redige um segredo estilo OpenAI (sk-…) preservando o texto ao redor', () => {
    const output = redactSecrets('Authorization: Bearer sk-proj-ABCDEF0123456789 falhou');
    expect(output).toBe('Authorization: Bearer sk-***REDACTED*** falhou');
    expect(output).not.toContain('ABCDEF0123456789');
  });

  it('não altera texto sem segredos', () => {
    expect(redactSecrets('planejamento concluído')).toBe('planejamento concluído');
  });
});


import { resolveTaskMessage } from './prove-openai-strong-e2e';

describe('resolveTaskMessage', () => {
  it('usa a mensagem default quando não há argumentos de tarefa', () => {
    expect(resolveTaskMessage([])).toContain('Adicione uma função pura de diagnóstico');
  });

  it('aceita a mensagem informada diretamente por --task', () => {
    expect(resolveTaskMessage(['--task', 'corrija o planner'])).toBe('corrija o planner');
    expect(resolveTaskMessage(['--task=adicione testes'])).toBe('adicione testes');
  });

  it('lê a mensagem de --task-file pelo leitor injetado', () => {
    const readFile = jest.fn(() => 'mensagem do arquivo');

    expect(resolveTaskMessage(['--task-file', 'tarefa.txt'], readFile)).toBe('mensagem do arquivo');
    expect(readFile).toHaveBeenCalledWith('tarefa.txt');
  });

  it('rejeita fontes de tarefa conflitantes', () => {
    expect(() => resolveTaskMessage(['--task', 'direta', '--task-file', 'tarefa.txt'])).toThrow(
      'Use somente uma entre --task e --task-file.',
    );
  });
});
