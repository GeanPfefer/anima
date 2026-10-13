import { lintAcceptanceContract, lintItemAcceptanceContract, type AutonomousValidationCriterion, type WorkItem } from './index';
const codes = (effects: readonly string[], criteria: readonly AutonomousValidationCriterion[]) => lintAcceptanceContract(effects, criteria).map(f => f.code);
const gate: AutonomousValidationCriterion = { label: 'gate', command: 'test', claimKind: 'gate_assertion', covers: ['aceite'] };
test('provas possíveis automáticas e contrato vazio', () => {
  expect(codes(['aceite'], [gate])).toEqual([]);
  expect(codes(['aceite'], [{ label: 'scope', proof: 'scope', covers: ['aceite'] }])).toEqual([]);
  expect(codes([], [])).toEqual([]);
  expect(codes(['aceite'], [])).toEqual(['acceptance_without_possible_proof', 'no_automated_proof']);
  expect(codes([], [{ label: 'vazio', covers: [] }])).toEqual([]);
});
test.each([' aceite  ', 'ａｃｅｉｔｅ', 'aceite\n'])('texto quase igual não é aceite canônico: %s', text => {
  expect(lintAcceptanceContract(['aceite'], [{ ...gate, covers: [text] }]).slice(0, 2)).toEqual([
    { code: 'covers_unknown_acceptance', subject: text, detail: `covers_unknown_acceptance: ${text}` },
    { code: 'covers_noncanonical_text', subject: text, detail: `covers_noncanonical_text: ${text}` },
  ]);
});
test('espaços internos e Unicode composto normalizam apenas para diagnóstico', () => {
  expect(codes(['café pronto'], [{ ...gate, covers: ['cafe\u0301  pronto'] }])).toContain('covers_noncanonical_text');
  expect(codes(['aceite'], [{ ...gate, covers: ['outro'] }])).not.toContain('covers_noncanonical_text');
});
test('duplicatas internas e entre critérios são reportadas sem mutação', () => {
  const criteria = Object.freeze([Object.freeze({ ...gate, covers: Object.freeze(['aceite', 'aceite']) }), gate]);
  const before = JSON.stringify(criteria);
  expect(codes(['aceite'], criteria)).toEqual(['duplicate_cover', 'duplicate_cover']);
  expect(JSON.stringify(criteria)).toBe(before);
  expect(lintAcceptanceContract(['aceite'], criteria)).toEqual(lintAcceptanceContract(['aceite'], criteria));
});
test('provas impossíveis e revisão humana explícita', () => {
  expect(codes(['aceite'], [{ ...gate, command: undefined }])).toEqual(['gate_assertion_without_gate', 'acceptance_without_possible_proof', 'no_automated_proof']);
  expect(codes(['aceite'], [{ ...gate, proof: 'scope' }])).toEqual(['gate_assertion_without_gate']);
  expect(codes(['aceite'], [{ label: 'human', proof: 'human_review', covers: ['aceite'] }])).toEqual(['no_automated_proof']);
  expect(codes(['aceite'], [{ label: 'human', proof: 'human_review', command: 'test', covers: ['aceite'] }])).toEqual(['human_review_with_command', 'no_automated_proof']);
  expect(codes(['aceite'], [{ ...gate, claimKind: 'substantive' }])).toEqual(['acceptance_without_possible_proof', 'no_automated_proof']);
});
test.each([undefined, 2, 1, '2'] as const)('modo só é v2 para número 2: %s', marker => {
  const item = { intent: { execution_spec: { acceptance_contract: marker } }, proposal: { data: { expectedEffects: [] } } } as unknown as WorkItem;
  expect(lintItemAcceptanceContract(item).mode).toBe(marker === 2 ? 'v2' : 'legacy');
});
