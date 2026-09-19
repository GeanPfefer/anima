import { buildNotEligibleBlockPayload, evaluateAutonomousEligibility, readAutonomousExecutionSpec, type AutonomousEligibilityGapCode, type WorkItem, type WorkState } from '.';
import type { Json } from '@anima/types';

const fullSpec: Json = { schema_version: 1, target: { kind: 'project', reference: 'G:/anima' }, permissions: ['read_repo', 'run_tests'], validation_criteria: [{ label: 'npm test', command: 'npm test' }], limits: { max_attempts: 3 } };
const makeItem = (overrides: Partial<WorkItem> = {}, spec: Json | 'sem-especificacao' = fullSpec): WorkItem => ({
  id: 'i', userId: 'u', sourceMessageId: 'm', state: 'approved', impactLevel: 'low', capability: 'programming', originalRequest: 'x',
  intent: spec === 'sem-especificacao' ? {} : { execution_spec: spec },
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'objetivo claro', includedScope: ['migrar tela X'], excludedScope: ['não tocar no mobile'], expectedEffects: ['tela X migrada com testes verdes'], risks: [] } },
  proposalVersion: 3, createdAt: new Date(), updatedAt: new Date(), ...overrides,
});
const codes = (item: WorkItem): readonly AutonomousEligibilityGapCode[] => { const result = evaluateAutonomousEligibility(item); return result.eligible ? [] : result.gaps.map(entry => entry.code); };

describe('elegibilidade autônoma — caso elegível', () => {
  test('item aprovado com proposta concreta e especificação completa é elegível', () => {
    const result = evaluateAutonomousEligibility(makeItem());
    expect(result).toMatchObject({ eligible: true, spec: { schemaVersion: 1, target: { kind: 'project', reference: 'G:/anima' }, permissions: ['read_repo', 'run_tests'], validationCriteria: [{ label: 'npm test', command: 'npm test' }], limits: { maxAttempts: 3 } } });
  });
  test('permissões explicitamente vazias contam como declaradas', () => expect(evaluateAutonomousEligibility(makeItem({}, { ...(fullSpec as object), permissions: [] } as Json))).toMatchObject({ eligible: true, spec: { permissions: [] } }));
  test('limite apenas de tempo é suficiente', () => expect(evaluateAutonomousEligibility(makeItem({}, { ...(fullSpec as object), limits: { max_duration_minutes: 30 } } as Json))).toMatchObject({ eligible: true, spec: { limits: { maxDurationMinutes: 30 } } }));
  test('item elegível não gera payload de bloqueio', () => expect(buildNotEligibleBlockPayload(evaluateAutonomousEligibility(makeItem()))).toBeNull());
});

describe('elegibilidade autônoma — eixo de estado (aprovação e decisão pendente)', () => {
  test('proposed acumula falta de aprovação e decisão pendente', () => expect(codes(makeItem({ state: 'proposed' }))).toEqual(['proposal_not_approved', 'human_decision_pending']));
  test.each<WorkState>(['review', 'changes_requested'])('%s tem decisão humana pendente', state => expect(codes(makeItem({ state }))).toEqual(['human_decision_pending']));
  test('in_progress já possui execução ativa', () => expect(codes(makeItem({ state: 'in_progress' }))).toEqual(['execution_already_active']));
  test('blocked aguarda desbloqueio', () => expect(codes(makeItem({ state: 'blocked' }))).toEqual(['work_blocked_unresolved']));
  test.each<WorkState>(['completed', 'failed', 'rejected', 'cancelled'])('%s está encerrado', state => expect(codes(makeItem({ state }))).toEqual(['work_already_closed']));
});

describe('elegibilidade autônoma — conteúdo da proposta', () => {
  const proposal = makeItem().proposal;
  const withData = (data: Partial<typeof proposal.data>): WorkItem => makeItem({ proposal: { schemaVersion: 1, data: { ...proposal.data, ...data } } });
  test('escopo incluído vazio não é concreto', () => expect(codes(withData({ includedScope: [] }))).toEqual(['scope_not_concrete']));
  test('escopo excluído vazio não é concreto', () => expect(codes(withData({ excludedScope: [] }))).toEqual(['scope_not_concrete']));
  test('entrada em branco no escopo não é concreta', () => expect(codes(withData({ includedScope: ['   '] }))).toEqual(['scope_not_concrete']));
  test('objetivo em branco deixa o resultado esperado sem descrição', () => expect(codes(withData({ objective: '  ' }))).toEqual(['expected_result_missing']));
  test('efeitos esperados vazios deixam o resultado sem descrição', () => expect(codes(withData({ expectedEffects: [] }))).toEqual(['expected_result_missing']));
  test('capacidade fora do enum é recusada', () => expect(codes(makeItem({ capability: 'telepatia' as WorkItem['capability'] }))).toEqual(['capability_unknown']));
});

describe('elegibilidade autônoma — especificação de execução (fail-closed)', () => {
  test('sem especificação, cada requisito ausente vira lacuna própria', () => expect(codes(makeItem({}, 'sem-especificacao'))).toEqual(['target_missing', 'permissions_not_declared', 'validation_criteria_missing', 'limits_missing']));
  test('especificação com versão desconhecida é inválida', () => expect(codes(makeItem({}, { schema_version: 2 }))).toEqual(['execution_spec_invalid']));
  test('especificação que não é objeto é inválida', () => expect(codes(makeItem({}, 'tudo liberado'))).toEqual(['execution_spec_invalid']));
  test('dependências válidas são projetadas no spec', () => expect(evaluateAutonomousEligibility(makeItem({}, { ...(fullSpec as object), depends_on_work_item_ids: ['11111111-1111-4111-8111-111111111111'] } as Json))).toMatchObject({ eligible: true, spec: { dependsOnWorkItemIds: ['11111111-1111-4111-8111-111111111111'] } }));
  test('dependências malformadas falham fechado', () => expect(codes(makeItem({}, { ...(fullSpec as object), depends_on_work_item_ids: ['não-é-uuid'] } as Json))).toEqual(['execution_spec_invalid']));
  const withSpec = (spec: Record<string, Json>): WorkItem => makeItem({}, { ...(fullSpec as object), ...spec } as Json);
  test('alvo com kind desconhecido falta', () => expect(codes(withSpec({ target: { kind: 'planeta', reference: 'x' } }))).toEqual(['target_missing']));
  test('alvo com referência em branco falta', () => expect(codes(withSpec({ target: { kind: 'project', reference: ' ' } }))).toEqual(['target_missing']));
  test('permissões fora de lista não estão declaradas', () => expect(codes(withSpec({ permissions: 'todas' }))).toEqual(['permissions_not_declared']));
  test('permissão em branco não está declarada', () => expect(codes(withSpec({ permissions: ['ler', ' '] }))).toEqual(['permissions_not_declared']));
  test('critérios de validação vazios faltam', () => expect(codes(withSpec({ validation_criteria: [] }))).toEqual(['validation_criteria_missing']));
  test('critério sem rótulo falta', () => expect(codes(withSpec({ validation_criteria: [{ command: 'npm test' }] }))).toEqual(['validation_criteria_missing']));
  test('claim_kind gate_assertion é projetado no spec (claimKind)', () => expect(evaluateAutonomousEligibility(withSpec({ validation_criteria: [{ label: 'unit', command: 'npm test', claim_kind: 'gate_assertion' }] }))).toMatchObject({ eligible: true, spec: { validationCriteria: [{ label: 'unit', command: 'npm test', claimKind: 'gate_assertion' }] } }));
  test('claim_kind substantive é projetado no spec (claimKind)', () => expect(evaluateAutonomousEligibility(withSpec({ validation_criteria: [{ label: 'unit', command: 'npm test', claim_kind: 'substantive' }] }))).toMatchObject({ eligible: true, spec: { validationCriteria: [{ label: 'unit', command: 'npm test', claimKind: 'substantive' }] } }));
  test('claim_kind fora do domínio falha fechado', () => expect(codes(withSpec({ validation_criteria: [{ label: 'unit', command: 'npm test', claim_kind: 'talvez' }] }))).toEqual(['validation_criteria_missing']));
  test('claim_kind ausente é honesto: critério elegível SEM claimKind (não promovido silenciosamente)', () => {
    const result = evaluateAutonomousEligibility(withSpec({ validation_criteria: [{ label: 'unit', command: 'npm test' }] }));
    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.spec.validationCriteria[0]!.claimKind).toBeUndefined();
  });
  test('limites sem nenhum valor faltam', () => expect(codes(withSpec({ limits: {} }))).toEqual(['limits_missing']));
  test('limite não inteiro positivo falta', () => expect(codes(withSpec({ limits: { max_attempts: 0 } }))).toEqual(['limits_missing']));
  test('limite fracionário falta', () => expect(codes(withSpec({ limits: { max_duration_minutes: 2.5 } }))).toEqual(['limits_missing']));
});

describe('elegibilidade autônoma — target_paths estrutural do gate (aditivo, fail-closed)', () => {
  const withSpec = (spec: Record<string, Json>): WorkItem => makeItem({}, { ...(fullSpec as object), ...spec } as Json);
  const criterion = (over: Record<string, Json>): Record<string, Json> => ({ label: 'unit', command: 'npm test', ...over });

  test('target_paths válido (único) é projetado no spec', () => {
    expect(evaluateAutonomousEligibility(withSpec({ validation_criteria: [criterion({ target_paths: ['apps/web/lib/ai/x.test.ts'] })] })))
      .toMatchObject({ eligible: true, spec: { validationCriteria: [{ label: 'unit', targetPaths: ['apps/web/lib/ai/x.test.ts'] }] } });
  });

  test('múltiplos target_paths são preservados na ordem', () => {
    const paths = ['packages/core/src/a.ts', 'packages/core/src/a.test.ts'];
    expect(evaluateAutonomousEligibility(withSpec({ validation_criteria: [criterion({ target_paths: paths })] })))
      .toMatchObject({ eligible: true, spec: { validationCriteria: [{ targetPaths: paths }] } });
  });

  test('ausência de target_paths ⇒ critério IDÊNTICO ao anterior (retrocompatível, sem o campo)', () => {
    const result = evaluateAutonomousEligibility(withSpec({ validation_criteria: [criterion({})] }));
    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.spec.validationCriteria[0]!.targetPaths).toBeUndefined();
  });

  test('formato ANTIGO (spec sem target_paths em nenhum critério) continua elegível e igual', () => {
    expect(evaluateAutonomousEligibility(makeItem())).toMatchObject({ eligible: true, spec: { validationCriteria: [{ label: 'npm test', command: 'npm test' }] } });
  });

  test.each<[string, Json]>([
    ['caminho absoluto (posix)', ['/etc/passwd']],
    ['caminho com drive (win)', ['C:/segredo.ts']],
    ['traversal', ['../fora.ts']],
    ['item não-string', [123 as unknown as Json]],
    ['item em branco', ['   ']],
    ['segmento sensível node_modules', ['node_modules/x.ts']],
    ['arquivo sensível .env', ['apps/web/.env.local']],
    ['glob', ['apps/web/lib/*.ts']],
    ['diretório sintático', ['apps/web/lib/']],
    ['array vazio (contrato: lista não-vazia)', []],
    ['não-array', 'apps/web/x.ts' as unknown as Json],
  ])('fail-closed: target_paths %s ⇒ validation_criteria_missing', (_label, bad) => {
    expect(codes(withSpec({ validation_criteria: [criterion({ target_paths: bad })] }))).toEqual(['validation_criteria_missing']);
  });

  test('parsing preserva claim_kind/proof/covers ao lado de target_paths', () => {
    const spec = withSpec({ validation_criteria: [criterion({ covers: ['tela X migrada com testes verdes'], proof: 'gate', claim_kind: 'gate_assertion', target_paths: ['packages/core/src/a.test.ts'] })] });
    expect(evaluateAutonomousEligibility(spec)).toMatchObject({
      eligible: true,
      spec: { validationCriteria: [{ label: 'unit', command: 'npm test', covers: ['tela X migrada com testes verdes'], proof: 'gate', claimKind: 'gate_assertion', targetPaths: ['packages/core/src/a.test.ts'] }] },
    });
  });

  test('readAutonomousExecutionSpec expõe target_paths quando presente', () => {
    const item = withSpec({ validation_criteria: [criterion({ target_paths: ['packages/core/src/a.test.ts'] })] });
    const spec = readAutonomousExecutionSpec(item.intent);
    expect(spec?.validationCriteria[0]!.targetPaths).toEqual(['packages/core/src/a.test.ts']);
  });

  test('readAutonomousExecutionSpec: ausência de target_paths continua null-safe e omite o campo', () => {
    const spec = readAutonomousExecutionSpec(makeItem().intent);
    expect(spec?.validationCriteria[0]!.targetPaths).toBeUndefined();
  });
});

describe('elegibilidade autônoma — combinações e payload de bloqueio', () => {
  test('lacunas se acumulam em ordem estável entre eixos', () => {
    const item = makeItem({ state: 'proposed', proposal: { schemaVersion: 1, data: { summary: 's', objective: ' ', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } } }, 'sem-especificacao');
    expect(codes(item)).toEqual(['proposal_not_approved', 'human_decision_pending', 'scope_not_concrete', 'expected_result_missing', 'target_missing', 'permissions_not_declared', 'validation_criteria_missing', 'limits_missing']);
  });
  test('cada lacuna referencia o requisito do Marco 003 e explica o que falta', () => {
    const result = evaluateAutonomousEligibility(makeItem({ state: 'proposed' }, undefined));
    expect(result.eligible).toBe(false);
    if (!result.eligible) for (const entry of result.gaps) { expect(entry.requirement.length).toBeGreaterThan(0); expect(entry.explanation.length).toBeGreaterThan(0); }
  });
  test('payload de bloqueio carrega razão tipada e códigos exatos', () => {
    const payload = buildNotEligibleBlockPayload(evaluateAutonomousEligibility(makeItem({ state: 'blocked' })));
    expect(payload).toEqual({ schema_version: 1, reason: 'not_eligible', gaps: ['work_blocked_unresolved'] });
  });
});
