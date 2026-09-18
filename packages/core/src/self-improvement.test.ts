import { isValidWorkIntent, isValidWorkProposal, type CreateWorkProposalCommand } from './work-orchestration';
import type { SelfDeficiencyV0 } from './self-deficiency';
import {
  buildSelfDeficiencyProvenance,
  buildSelfImprovementProposalCommand,
  formulateImprovementProposal,
  materializeSelfImprovementProposal,
  readSelfDeficiencyIdFromIntent,
  readSelfDeficiencyProvenanceFromIntent,
  selectSelfDeficiencyToPropose,
  SELF_DEFICIENCY_PROVENANCE_KEY,
  type SelfImprovementMaterializerDeps,
} from './self-improvement';

function deficiency(over: Partial<SelfDeficiencyV0> = {}): SelfDeficiencyV0 {
  return {
    schemaVersion: 1,
    id: 'repeated_failure|gate_failed',
    kind: 'repeated_failure',
    subject: 'gate_failed',
    summary: 'A causa "gate_failed" recorre em 2 work_items.',
    rationale: 'Causa estrutural atravessa tarefas.',
    evidenceRefs: [{ kind: 'work_event', ref: 'e1' }, { kind: 'attempt', ref: 'a1' }],
    firstObservedAt: '2026-09-10T10:00:00.000Z',
    lastObservedAt: '2026-09-11T10:00:00.000Z',
    occurrences: 2,
    occasions: 2,
    status: 'open',
    ...over,
  };
}

interface FakeDeps extends SelfImprovementMaterializerDeps {
  readonly audit: string[];
  readonly created: CreateWorkProposalCommand[];
}

function fakeDeps(materialized: readonly string[] = []): FakeDeps {
  const audit: string[] = [];
  const created: CreateWorkProposalCommand[] = [];
  return {
    audit,
    created,
    readMaterializedDeficiencyIds: async () => { audit.push('read'); return new Set(materialized); },
    persistSourceMessage: async () => { audit.push('persistSourceMessage'); return 'msg-1'; },
    createProposal: async (command) => { audit.push('createProposal'); created.push(command); return { ok: true, workItemId: 'wi-1' }; },
  };
}

describe('Self-Improvement V0 — formulação determinística', () => {
  test('mesma deficiência → mesma proposta (determinística)', () => {
    const d = deficiency();
    expect(formulateImprovementProposal(d)).toEqual(formulateImprovementProposal(d));
  });

  test('proposta descreve objetivo + critérios de aceite (não edição cirúrgica)', () => {
    const p = formulateImprovementProposal(deficiency());
    expect(p.objective).toContain('gate_failed');
    expect(p.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(p.impactLevel).toBe('structural');
    expect(p.capability).toBe('programming');
  });

  test('cada classe de deficiência tem template próprio', () => {
    const kinds = ['repeated_failure', 'capability_regression', 'verifier_recurrent_issue'] as const;
    const objectives = kinds.map(kind => formulateImprovementProposal(deficiency({ kind, subject: 'x', id: `${kind}|x` })).objective);
    expect(new Set(objectives).size).toBe(kinds.length);
  });
});

describe('Self-Improvement V0 — proveniência e comando canônico', () => {
  test('provenance roundtrip pelo intent', () => {
    const d = deficiency();
    const command = buildSelfImprovementProposalCommand({
      proposal: formulateImprovementProposal(d), deficiency: d, sourceMessageId: 'msg-1',
    });
    expect(readSelfDeficiencyProvenanceFromIntent(command.intent)).toEqual(buildSelfDeficiencyProvenance(d));
    expect(readSelfDeficiencyIdFromIntent(command.intent)).toBe(d.id);
  });

  test('intent malformado → provenance null (fail-safe)', () => {
    expect(readSelfDeficiencyProvenanceFromIntent(null)).toBeNull();
    expect(readSelfDeficiencyProvenanceFromIntent({})).toBeNull();
    expect(readSelfDeficiencyProvenanceFromIntent({ [SELF_DEFICIENCY_PROVENANCE_KEY]: { kind: 'x' } })).toBeNull();
  });

  test('comando é um WorkProposal/WorkIntent VÁLIDO e NÃO carrega execution_spec', () => {
    const d = deficiency();
    const command = buildSelfImprovementProposalCommand({
      proposal: formulateImprovementProposal(d), deficiency: d, sourceMessageId: 'msg-1',
    });
    expect(isValidWorkIntent(command.intent)).toBe(true);
    expect(isValidWorkProposal(command.proposal)).toBe(true);
    expect(command.intent).not.toHaveProperty('execution_spec');
  });
});

describe('Self-Improvement V0 — materialização governada (para antes da aprovação)', () => {
  test('13. materializa a deficiência open em work_item `proposed`; único efeito é create_work_proposal', async () => {
    const deps = fakeDeps();
    const result = await materializeSelfImprovementProposal({ candidates: [deficiency()] }, deps);
    expect(result).toMatchObject({ ok: true, workItemId: 'wi-1', deficiencyId: 'repeated_failure|gate_failed' });
    // A superfície de efeitos é só leitura + mensagem de origem + criação da proposta.
    expect(deps.audit).toEqual(['read', 'persistSourceMessage', 'createProposal']);
  });

  test('14-17,20. NÃO cria approval/authority/reservation/attempt nem usa provider pago', async () => {
    const deps = fakeDeps();
    await materializeSelfImprovementProposal({ candidates: [deficiency()] }, deps);
    // Estrutural: os únicos portos existentes são read/persist/create; nenhuma etapa
    // de aprovação, autoridade, reserva, attempt ou provider pago é sequer acessível.
    for (const forbidden of ['approve', 'authorize', 'reserve', 'reservation', 'attempt', 'provider', 'openai', 'runpod', 'pay']) {
      expect(deps.audit.join('|').toLowerCase()).not.toContain(forbidden);
    }
    const command = deps.created[0]!;
    // A via `create_work_proposal` só cria `proposed`; o comando não carrega decisão nem autoridade.
    expect(command.intent).not.toHaveProperty('approval');
    expect(command.intent).not.toHaveProperty('authority');
    expect(command.intent).not.toHaveProperty('reservation');
  });

  test('8/dedup. deficiência já materializada não gera nova proposta', async () => {
    const deps = fakeDeps(['repeated_failure|gate_failed']);
    const result = await materializeSelfImprovementProposal({ candidates: [deficiency()] }, deps);
    expect(result).toEqual({ ok: false, reason: 'no_candidate' });
    expect(deps.audit).toEqual(['read']); // nada além da leitura de correlação
  });

  test('deficiência covered/resolved não é candidata a proposta', () => {
    expect(selectSelfDeficiencyToPropose([deficiency({ status: 'covered' })], new Set())).toBeNull();
    expect(selectSelfDeficiencyToPropose([deficiency({ status: 'resolved' })], new Set())).toBeNull();
    expect(selectSelfDeficiencyToPropose([deficiency({ status: 'reopened' })], new Set())).not.toBeNull();
  });

  test('seleção é determinística: mais forte (mais ocasiões) primeiro', () => {
    const weak = deficiency({ id: 'repeated_failure|a', subject: 'a', occasions: 2, occurrences: 2 });
    const strong = deficiency({ id: 'repeated_failure|b', subject: 'b', occasions: 5, occurrences: 9 });
    expect(selectSelfDeficiencyToPropose([weak, strong], new Set())?.id).toBe('repeated_failure|b');
  });

  test('falha de persistência da mensagem de origem → sem escrita de proposta', async () => {
    const deps = fakeDeps();
    const failing: FakeDeps = { ...deps, persistSourceMessage: async () => { deps.audit.push('persistSourceMessage'); return null; } };
    const result = await materializeSelfImprovementProposal({ candidates: [deficiency()] }, failing);
    expect(result).toEqual({ ok: false, reason: 'source_message_persist_failed' });
    expect(deps.audit).not.toContain('createProposal');
  });
});
