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
