import {
  buildCoderTaskSpec,
  buildCoderTaskSpecFromWorkItem,
  coderTaskSpecMismatch,
  renderCoderTaskSpec,
  validateWorkExecutorRequest,
  type AutonomousValidationCriterion,
  type CoderTaskSpecV1,
  type WorkExecutorRequest,
} from '.';

const criteria: readonly AutonomousValidationCriterion[] = [
  // Ordem de chaves propositalmente diferente da canônica: a projeção normaliza.
  { targetPaths: ['src/a.ts'], claimKind: 'substantive', proof: 'gate', covers: ['Efeito A'], command: 'npm test -- src/a.test.ts', label: 'gate-a' },
  { label: 'escopo', covers: ['Efeito B'], proof: 'scope' },
  { label: 'legado' },
];
const proposal = {
  summary: 'Resumo', objective: 'Objetivo', includedScope: ['src/a.ts'], excludedScope: ['src/b.ts'],
  expectedEffects: ['Efeito A', 'Efeito B', 'Efeito C'], risks: ['Risco 1'],
};
const spec = (overrides: Partial<Parameters<typeof buildCoderTaskSpec>[0]> = {}): CoderTaskSpecV1 => buildCoderTaskSpec({
  workItemId: 'w1', approvedProposalVersion: 2, proposal, spec: { validationCriteria: criteria },
  verifierRequirement: 'advisory', contextReferences: [{ kind: 'context_snapshot', id: 's1' }], ...overrides,
});

describe('CoderTaskSpecV1 — projeção derivada da versão aprovada', () => {
  test('carrega todos os campos canônicos com critérios normalizados', () => {
    expect(spec()).toEqual({
      schemaVersion: 1, workItemId: 'w1', approvedProposalVersion: 2,
      summary: 'Resumo', objective: 'Objetivo', includedScope: ['src/a.ts'], excludedScope: ['src/b.ts'],
      expectedEffects: ['Efeito A', 'Efeito B', 'Efeito C'], risks: ['Risco 1'],
      validationCriteria: [
        { label: 'gate-a', command: 'npm test -- src/a.test.ts', covers: ['Efeito A'], proof: 'gate', claimKind: 'substantive', targetPaths: ['src/a.ts'] },
        { label: 'escopo', covers: ['Efeito B'], proof: 'scope' },
        { label: 'legado' },
      ],
      verifierRequirement: 'advisory', contextReferences: [{ kind: 'context_snapshot', id: 's1' }],
    });
  });

  test('verifier requirement vem do execution_spec do Work Item (ausente ⇒ advisory)', () => {
    const item = { id: 'w1', proposalVersion: 2, proposal: { schemaVersion: 1 as const, data: proposal } };
    expect(buildCoderTaskSpecFromWorkItem({ ...item, intent: { execution_spec: { verifier_requirement: 'required_fail_closed' } } }, { validationCriteria: criteria }, []).verifierRequirement).toBe('required_fail_closed');
    expect(buildCoderTaskSpecFromWorkItem({ ...item, intent: {} }, { validationCriteria: criteria }, []).verifierRequirement).toBe('advisory');
  });

  test('renderização é determinística, separa categorias e não inventa conteúdo', () => {
    const commands = [{ label: 'gate-a', program: 'npm', args: ['test', '--', 'src/a.test.ts'] }];
    const text = renderCoderTaskSpec(spec(), commands);
    expect(renderCoderTaskSpec(spec(), commands)).toBe(text);
    expect(text).toContain('Efeitos esperados (aceites da proposta aprovada):\n  E1. Efeito A\n  E2. Efeito B\n  E3. Efeito C');
    expect(text).toContain('  V1. gate-a\n      comando: npm test -- src/a.test.ts\n      prova: gate\n      claimKind: substantive\n      alvos: src/a.ts\n      cobre: E1');
    expect(text).toContain('  V3. legado\n      comando: (sem comando)\n      prova: (não declarada)\n      claimKind: (não declarado)\n      alvos: (não declarados)\n      cobre: (não declarado)');
    expect(text).toContain('Comandos de validação autorizados pelo host (informativos; o host executa e julga):\n  - gate-a: npm test -- src/a.test.ts');
    expect(text).toContain('Requisito do Verifier: advisory');
    expect(text).toContain('  - context_snapshot:s1');
    // Permissões não fazem parte da projeção.
    expect(text).not.toMatch(/workspace_write|permiss(ão|ões):/i);
  });

  test('covers sem efeito correspondente é preservado literalmente; sem comandos autorizados é explícito', () => {
    const text = renderCoderTaskSpec(spec({ spec: { validationCriteria: [{ label: 'x', covers: ['Texto órfão'] }] }, contextReferences: [] }));
    expect(text).toContain('cobre: "Texto órfão"');
    expect(text).toContain('  (nenhum comando executável autorizado)');
    expect(text).not.toContain('Referências de contexto');
  });

  test('divergência entre projeção e campos de autoridade é recusada (fail-closed)', () => {
    const authority = {
      workItemId: 'w1', approvedProposalVersion: 2, objective: 'Objetivo', includedScope: ['src/a.ts'], excludedScope: ['src/b.ts'],
      validationCriteria: criteria, contextReferences: [{ kind: 'context_snapshot', id: 's1' }],
    };
    expect(coderTaskSpecMismatch(spec(), authority)).toBeNull();
    expect(coderTaskSpecMismatch(spec(), { ...authority, approvedProposalVersion: 3 })).toMatch(/correlação/);
    expect(coderTaskSpecMismatch(spec(), { ...authority, includedScope: ['src/a.ts', 'src/extra.ts'] })).toMatch(/escopo/);
    expect(coderTaskSpecMismatch(spec(), { ...authority, validationCriteria: [criteria[0]!] })).toMatch(/critérios/);
    expect(coderTaskSpecMismatch(spec(), { ...authority, contextReferences: [] })).toMatch(/referências/);
  });

  test('validateWorkExecutorRequest exige projeção coerente com o request', () => {
    const request: WorkExecutorRequest = {
      attemptId: 'a1', workItemId: 'w1', approvedProposalVersion: 2, capability: 'programming', objective: 'Objetivo',
      includedScope: ['src/a.ts'], excludedScope: ['src/b.ts'], target: { kind: 'project', reference: 'anima' }, permissions: [],
      validationCriteria: criteria, limits: { maxAttempts: 1 }, contextReferences: [{ kind: 'context_snapshot', id: 's1' }], taskSpec: spec(),
    };
    expect(validateWorkExecutorRequest(request)).toBeNull();
    expect(validateWorkExecutorRequest({ ...request, taskSpec: { ...spec(), objective: 'Outro' } })).toMatch(/objetivo/);
  });
});
