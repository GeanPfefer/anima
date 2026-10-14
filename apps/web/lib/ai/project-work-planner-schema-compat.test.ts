/** @jest-environment node */
import { SUBMIT_PARAMETERS, coercePlannerArrayFields, validatePlannerProposal } from './project-work-planner-shared';

const file = 'apps/web/lib/ai/project-work-planner-shared.test.ts';
const binding = { label: 'Funcional', covers: ['Comportamento'], test_files: [file], min_new_tests: 1, bound_tests: [] };
const legacy = { summary: 'Proposta', objective: 'Objetivo', included_scope: [file], excluded_scope: ['Banco'],
  expected_effects: ['Gate'], risks: ['Regressão'], validation_label: 'Gate', validation_command: 'npm run typecheck',
  validation_covers: ['Gate'], validation_claim_kind: 'gate_assertion' };
const coerce = (value: unknown): unknown => JSON.parse(coercePlannerArrayFields(JSON.stringify(value)));
function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const node = value as Record<string, unknown>;
  visit(node);
  if (node.properties && typeof node.properties === 'object') {
    for (const child of Object.values(node.properties)) walk(child, visit);
  }
  if (node.items) walk(node.items, visit);
}

test('admite apenas o vocabulário estrito em toda a estrutura', () => {
  const allowed = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description', 'minItems', 'maxItems'];
  walk(SUBMIT_PARAMETERS, node => { for (const name of Object.keys(node)) expect(allowed).toContain(name); });
});
test('fecha todos os objetos e exige todas as propriedades', () => {
  walk(SUBMIT_PARAMETERS, node => {
    if (node.type !== 'object') return;
    expect(node.additionalProperties).toBe(false);
    expect(node.required).toEqual(Object.keys(node.properties as Record<string, unknown>));
  });
});
test('omite restrições numéricas e textuais incompatíveis', () => {
  walk(SUBMIT_PARAMETERS, node => {
    for (const name of ['maxLength', 'minimum', 'maximum']) expect(node).not.toHaveProperty(name);
  });
});
test('mantém a rejeição autoritativa dos limites pelo host', () => {
  const proposal = (entry: unknown) => JSON.stringify({ ...legacy, expected_effects: ['Gate', 'Comportamento'], test_bindings: [entry] });
  expect(validatePlannerProposal(proposal({ ...binding, bound_tests: [{ file, full_name: 'a'.repeat(401) }] })))
    .toMatchObject({ ok: false, issue: { rule: 'invalid_bound_test' } });
  for (const min_new_tests of [-1, 101]) {
    expect(validatePlannerProposal(proposal({ ...binding, min_new_tests })))
      .toMatchObject({ ok: false, issue: { rule: 'invalid_min_new_tests' } });
  }
  expect(validatePlannerProposal(JSON.stringify({ ...legacy, test_bindings: [binding, binding, binding, binding] })))
    .toMatchObject({ ok: false, issue: { rule: 'invalid_list' } });
});
test('envolve um efeito de revisão humana em lista', () => {
  expect(coerce({ human_review_effects: 'Revisar' })).toEqual({ human_review_effects: ['Revisar'] });
});
test('envolve um binding único sem criar conteúdo', () => {
  expect(coerce({ test_bindings: binding })).toEqual({ test_bindings: [binding] });
});
test('envolve coberturas e arquivos escalares sem alterar o texto', () => {
  expect(coerce({ test_bindings: [{ covers: 'Efeito', test_files: file, bound_tests: { file, full_name: 'Prova' } }] }))
    .toEqual({ test_bindings: [{ covers: ['Efeito'], test_files: [file], bound_tests: [{ file, full_name: 'Prova' }] }] });
});
test('converte somente inteiros escritos com até três dígitos', () => {
  for (const [input, output] of [['0', 0], ['001', 1], ['100', 100], ['999', 999]]) {
    expect(coerce({ test_bindings: [{ min_new_tests: input }] })).toEqual({ test_bindings: [{ min_new_tests: output }] });
  }
  for (const input of ['1000', '-1', '1.0', ' 1', '1\n', '', 'a']) {
    expect(coerce({ test_bindings: [{ min_new_tests: input }] })).toEqual({ test_bindings: [{ min_new_tests: input }] });
  }
});
test('preserva vírgulas e linhas sem inventar itens', () => {
  const text = 'Primeiro, segundo\nterceiro';
  expect(coerce({ human_review_effects: text, test_bindings: { covers: text, test_files: text } }))
    .toEqual({ human_review_effects: [text], test_bindings: [{ covers: [text], test_files: [text] }] });
});
test('omite campos novos nulos ou vazios e mantém a proposta legada idêntica', () => {
  const raw = JSON.stringify(legacy);
  expect(coercePlannerArrayFields(raw)).toBe(raw);
  for (const value of [null, '']) {
    expect(coercePlannerArrayFields(JSON.stringify({ ...legacy, test_bindings: value, human_review_effects: value }))).toBe(raw);
  }
});
test('devolve texto inválido e valores não objeto intactos', () => {
  for (const raw of ['{', 'null', '[]', '42', '"texto"']) expect(coercePlannerArrayFields(raw)).toBe(raw);
});
test('preserva estruturas corretas e tipos desconhecidos com determinismo', () => {
  for (const value of [{ test_bindings: [binding], human_review_effects: [] },
    { test_bindings: [null, 3, [], { covers: 4, test_files: null, bound_tests: 'texto', min_new_tests: false }], human_review_effects: 7 },
    { test_bindings: 'texto', human_review_effects: {} }]) {
    const raw = JSON.stringify(value);
    expect(coercePlannerArrayFields(raw)).toBe(raw);
    expect(coercePlannerArrayFields(coercePlannerArrayFields(raw))).toBe(raw);
    expect(JSON.stringify(value)).toBe(raw);
  }
});
