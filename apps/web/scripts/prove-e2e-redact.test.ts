import { redactSecrets } from './prove-e2e-redact';

// Teste focado por JEST (globais describe/it/expect, sem import de framework), no
// mesmo estilo dos demais testes deste repositório.
describe('redactSecrets', () => {
  it('redige um segredo estilo OpenAI (sk-…) preservando o texto ao redor', () => {
    const input = 'Authorization: Bearer sk-proj-ABCDEF0123456789 falhou';
    const output = redactSecrets(input);
    expect(output).toBe('Authorization: Bearer sk-***REDACTED*** falhou');
    expect(output).not.toContain('ABCDEF0123456789');
  });

  it('não altera texto sem segredos', () => {
    expect(redactSecrets('planejamento concluído sem incidentes')).toBe(
      'planejamento concluído sem incidentes',
    );
  });

  it('redige múltiplas ocorrências', () => {
    expect(redactSecrets('sk-aaaaaaaa e sk-bbbbbbbb')).toBe('sk-***REDACTED*** e sk-***REDACTED***');
  });
});
