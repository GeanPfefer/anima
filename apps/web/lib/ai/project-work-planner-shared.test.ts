/** @jest-environment node */
import {
  SUBMIT_PARAMETERS,
  parseProposal,
  parseAdditionalValidations,
  normalizeClaimKind,
  validatePlannerProposal,
} from './project-work-planner-shared';

// ============================================================
// Contrato claim_kind do Project Work Planner (host-side): o planner DECLARA a
// classe de afirmação de cada gate; o host valida fail-closed e SEM heurística de
// texto. Ausência ⇒ substantive conservador (nunca gate_assertion); valor inválido
// ⇒ proposta rejeitada. Espelha o `WorkClaimKind` canônico lido pelo Verifier v3.
// ============================================================

const validArgs = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    summary: 'Ajuste pequeno',
    objective: 'Objetivo claro',
    included_scope: ['apps/web/lib/ai/project-work-planner.ts'],
    excluded_scope: ['Não alterar banco'],
    expected_effects: ['gate verde'],
    risks: ['variância'],
    validation_label: 'unit',
    validation_command: 'npm test -- coder-backend.test.ts',
    validation_covers: ['gate verde'],
    validation_claim_kind: 'gate_assertion',
    additional_validations: [],
    ...over,
  });

describe('normalizeClaimKind — fail-closed sem heurística', () => {
  test('valores válidos passam', () => {
    expect(normalizeClaimKind('gate_assertion')).toBe('gate_assertion');
    expect(normalizeClaimKind('substantive')).toBe('substantive');
  });
  test('ausência (undefined/null) ⇒ substantive conservador, NUNCA gate_assertion', () => {
    expect(normalizeClaimKind(undefined)).toBe('substantive');
    expect(normalizeClaimKind(null)).toBe('substantive');
  });
  test('valor fora do domínio ⇒ null (rejeição)', () => {
    expect(normalizeClaimKind('gate')).toBeNull();
    expect(normalizeClaimKind('GATE_ASSERTION')).toBeNull();
    expect(normalizeClaimKind(1)).toBeNull();
    expect(normalizeClaimKind({})).toBeNull();
  });
});

describe('SUBMIT_PARAMETERS — schema enviado ao modelo exige claim_kind', () => {
  test('validation_claim_kind é enum obrigatório', () => {
    const props = SUBMIT_PARAMETERS.properties as unknown as Record<string, { enum?: readonly unknown[] }>;
    expect(props.validation_claim_kind?.enum).toEqual(['gate_assertion', 'substantive']);
    expect(SUBMIT_PARAMETERS.required as readonly string[]).toContain('validation_claim_kind');
  });
  test('cada additional_validation exige claim_kind (enum)', () => {
    const item = (SUBMIT_PARAMETERS.properties as { additional_validations: { items: { properties: Record<string, { enum?: readonly string[] }>; required: readonly string[] } } })
      .additional_validations.items;
    expect(item.properties.claim_kind?.enum).toEqual(['gate_assertion', 'substantive']);
    expect(item.required).toContain('claim_kind');
  });
});

describe('parseProposal — claim_kind do gate principal', () => {
  test('1. gate_assertion válido é aceito e preservado', () => {
    const parsed = parseProposal(validArgs({ validation_claim_kind: 'gate_assertion' }));
    expect(parsed).not.toBeNull();
    expect(parsed!.validation_claim_kind).toBe('gate_assertion');
  });

  test('2. substantive válido é aceito e preservado', () => {
    const parsed = parseProposal(validArgs({ validation_claim_kind: 'substantive' }));
    expect(parsed).not.toBeNull();
    expect(parsed!.validation_claim_kind).toBe('substantive');
  });

  test('3. claim_kind inválido rejeita a proposta (fail-closed)', () => {
    expect(parseProposal(validArgs({ validation_claim_kind: 'gate' }))).toBeNull();
    expect(parseProposal(validArgs({ validation_claim_kind: '' }))).toBeNull();
    expect(parseProposal(validArgs({ validation_claim_kind: 123 }))).toBeNull();
  });

  test('4. claim_kind ausente ⇒ substantive conservador (nunca gate_assertion)', () => {
    const raw = JSON.stringify({
      summary: 's', objective: 'o',
      included_scope: ['apps/web/lib/ai/project-work-planner.ts'],
      excluded_scope: ['x'], expected_effects: ['e'], risks: ['r'],
      validation_label: 'unit', validation_command: 'npm test -- x.test.ts',
      validation_covers: ['e'], additional_validations: [],
      // validation_claim_kind AUSENTE de propósito
    });
    const parsed = parseProposal(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.validation_claim_kind).toBe('substantive');
  });

  test('5. resposta malformada (JSON inválido) NÃO é silenciosamente consertada', () => {
    expect(parseProposal('{ isso não é json')).toBeNull();
    expect(parseProposal('null')).toBeNull();
  });

  test('8. SEM heurística: comando "typecheck" declarado substantive permanece substantive', () => {
    const parsed = parseProposal(validArgs({
      validation_label: 'typecheck', validation_command: 'npm run typecheck --workspace=apps/web',
      validation_claim_kind: 'substantive',
    }));
    expect(parsed).not.toBeNull();
    expect(parsed!.validation_claim_kind).toBe('substantive');
  });

  test('10. covers fora de expected_effects continua inválido (contrato preservado)', () => {
    expect(parseProposal(validArgs({ validation_covers: ['efeito fantasma'] }))).toBeNull();
  });
});

describe('validatePlannerProposal — diagnóstico sem relaxar contrato', () => {
  test.each([
    ['campo obrigatório', { summary: undefined }, 'summary', 'required_non_blank'],
    ['gate fora da allowlist', { validation_command: 'python test.py' }, 'validation_command', 'command_not_allowed'],
    ['claim_kind inválido', { validation_claim_kind: 'gate' }, 'validation_claim_kind', 'unsupported_value'],
    ['max_attempts inválido', { max_attempts: 4 }, 'max_attempts', 'unsupported_value'],
    ['covers desconhecido', { validation_covers: ['efeito fantasma'] }, 'validation_covers', 'unknown_criterion'],
    ['expected_effect sem cobertura', { expected_effects: ['gate verde', 'sem cobertura'] }, 'validation_covers', 'missing_coverage'],
    ['included_scope inseguro', { included_scope: ['../fora.ts'] }, 'included_scope', 'safe_path'],
    ['target_paths não exato', { validation_target_paths: ['apps/web/cli/'] }, 'validation_target_paths', 'exact_file_paths'],
    ['gate adicional fora da allowlist', { additional_validations: [{ label: 'x', command: 'rm -rf /', covers: ['gate verde'], claim_kind: 'substantive' }] },
      'additional_validations[0].command', 'command_not_allowed'],
  ])('%s retorna campo e regra estáveis', (_label, override, field, rule) => {
    const result = validatePlannerProposal(validArgs(override));
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      issue: expect.objectContaining({ code: 'proposal_invalid', field, rule }),
    }));
    expect(parseProposal(validArgs(override))).toBeNull();
  });

  test('JSON inválido é proposal_invalid na raiz', () => {
    expect(validatePlannerProposal('{nao-json')).toEqual({
      ok: false,
      issue: expect.objectContaining({ code: 'proposal_invalid', field: '$', rule: 'invalid_json' }),
    });
    expect(parseProposal('{nao-json')).toBeNull();
  });

  test('proposta válida mantém exatamente a aceitação anterior', () => {
    const raw = validArgs();
    const result = validatePlannerProposal(raw);
    expect(result.ok).toBe(true);
    expect(parseProposal(raw)).not.toBeNull();
  });
});

describe('parseAdditionalValidations — claim_kind por prova adicional', () => {
  test('6/7. claim_kind explícito por prova é preservado; ausência ⇒ substantive', () => {
    const result = parseAdditionalValidations([
      { label: 'a', command: 'npm run typecheck --workspace=apps/web', covers: ['x'], claim_kind: 'gate_assertion' },
      { label: 'b', command: 'npm test --workspace=apps/web -- y.test.ts', covers: ['y'] },
    ]);
    expect(result).toEqual([
      { label: 'a', command: 'npm run typecheck --workspace=apps/web', covers: ['x'], claim_kind: 'gate_assertion' },
      { label: 'b', command: 'npm test --workspace=apps/web -- y.test.ts', covers: ['y'], claim_kind: 'substantive' },
    ]);
  });

  test('claim_kind inválido em prova adicional ⇒ null (rejeita a proposta inteira via parseProposal)', () => {
    expect(parseAdditionalValidations([
      { label: 'a', command: 'npm run typecheck --workspace=apps/web', covers: ['x'], claim_kind: 'bogus' },
    ])).toBeNull();
    expect(parseProposal(validArgs({
      expected_effects: ['gate verde', 'x'],
      additional_validations: [{ label: 'a', command: 'npm run typecheck --workspace=apps/web', covers: ['x'], claim_kind: 'bogus' }],
    }))).toBeNull();
  });
});

describe('target_paths por gate — superfície explícita e conservadora', () => {
  test('gate único preserva um target', () => {
    expect(parseProposal(validArgs({ validation_target_paths: ['apps/web/lib/ai/project-work-planner.test.ts'] }))
      ?.validation_target_paths).toEqual(['apps/web/lib/ai/project-work-planner.test.ts']);
  });

  test('gate preserva múltiplos targets', () => {
    const paths = ['apps/web/lib/ai/project-work-planner.ts', 'apps/web/lib/ai/project-work-planner.test.ts'];
    expect(parseProposal(validArgs({ validation_target_paths: paths }))?.validation_target_paths).toEqual(paths);
  });

  test('múltiplos gates preservam superfícies diferentes', () => {
    const parsed = parseProposal(validArgs({
      expected_effects: ['gate verde', 'tipos verdes'],
      validation_target_paths: ['apps/web/lib/ai/project-work-planner.test.ts'],
      additional_validations: [{
        label: 'types', command: 'npm run typecheck --workspace=apps/web', covers: ['tipos verdes'],
        claim_kind: 'gate_assertion', target_paths: ['apps/web/lib/ai/project-work-planner.ts'],
      }],
    }));
    expect(parsed?.validation_target_paths).toEqual(['apps/web/lib/ai/project-work-planner.test.ts']);
    expect(parsed?.additional_validations?.[0]?.target_paths).toEqual(['apps/web/lib/ai/project-work-planner.ts']);
  });

  test('sem path derivável ([] ou ausente) omite o campo; path inseguro reprova', () => {
    expect(parseProposal(validArgs({ validation_target_paths: [] }))).not.toHaveProperty('validation_target_paths');
    expect(parseProposal(validArgs())).not.toHaveProperty('validation_target_paths');
    expect(parseProposal(validArgs({ validation_target_paths: ['../segredo'] }))).toBeNull();
    expect(parseProposal(validArgs({ validation_target_paths: ['apps/web/lib/*.ts'] }))).toBeNull();
  });
});
