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
  it('exige uma fonte de mensagem', () => {
    expect(() => resolveTaskMessage([])).toThrow('Informe uma mensagem usando --message ou --message-file.');
  });

  it('aceita mensagem direta nas formas separada e inline sem alterar seu conteúdo', () => {
    expect(resolveTaskMessage(['--message', '  corrija o planner  '])).toBe('  corrija o planner  ');
    expect(resolveTaskMessage(['--message=adicione testes'])).toBe('adicione testes');
  });

  it('lê mensagem de arquivo nas formas separada e inline sem alterar seu conteúdo', () => {
    const readFile = jest.fn(() => '  mensagem do arquivo  ');

    expect(resolveTaskMessage(['--message-file', 'tarefa.txt'], readFile)).toBe('  mensagem do arquivo  ');
    expect(resolveTaskMessage(['--message-file=tarefa.txt'], readFile)).toBe('  mensagem do arquivo  ');
    expect(readFile).toHaveBeenCalledWith('tarefa.txt');
  });

  it('rejeita fontes conflitantes, conteúdo vazio e falha de leitura sem expor detalhes', () => {
    expect(() => resolveTaskMessage(['--message', 'direta', '--message-file', 'tarefa.txt'])).toThrow(
      'Use somente uma entre --message e --message-file.',
    );
    expect(() => resolveTaskMessage(['--message', '   '])).toThrow('A opção --message exige uma mensagem não vazia.');
    expect(() => resolveTaskMessage(['--message-file', 'tarefa.txt'], jest.fn(() => '  '))).toThrow(
      'O arquivo informado em --message-file contém uma mensagem vazia.',
    );
    expect(() => resolveTaskMessage(['--message-file', 'segredo.txt'], jest.fn(() => {
      throw new Error('conteúdo secreto');
    }))).toThrow('Não foi possível ler a mensagem informada em --message-file.');
  });
});
