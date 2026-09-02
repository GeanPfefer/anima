import {
  buildCanonicalProvenance,
  readCanonicalProvenanceFromIntent,
  readCanonicalSourceIdFromIntent,
  buildCanonicalMaterializationMessage,
  buildCanonicalSlicePlanningMessage,
  CANONICAL_PROVENANCE_KEY,
} from './canonical-materialization';
import type { CanonicalBacklogCandidate } from './canonical-backlog';

const candidate: CanonicalBacklogCandidate = {
  sourceId: 'SUP-01',
  title: 'Fila persistente',
  status: 'not_started',
  statusEvidence: null,
  dependencies: ['AUTO-01'],
  acceptanceCriteria: ['gates passam'],
  sourceRef: { document: 'docs/planos/002.md', heading: 'SUP-01 — Fila persistente', line: 220 },
};

describe('buildCanonicalProvenance / readCanonicalProvenanceFromIntent', () => {
  test('round-trip: provenance embutida no intent é lida de volta', () => {
    const prov = buildCanonicalProvenance({ candidate, planningGeneration: 1, materializationReason: 'ready' });
    const intent = { [CANONICAL_PROVENANCE_KEY]: prov, execution_spec: { executor: 'worktree' } };
    expect(readCanonicalProvenanceFromIntent(intent)).toEqual(prov);
    expect(readCanonicalSourceIdFromIntent(intent)).toBe('SUP-01');
  });

  test('inclui parentWorkItemId quando fornecido (sequência de slices)', () => {
    const prov = buildCanonicalProvenance({ candidate, planningGeneration: 2, materializationReason: 'more_work', parentWorkItemId: 'wi-1' });
    expect(prov.planningGeneration).toBe(2);
    expect(prov.parentWorkItemId).toBe('wi-1');
    expect(prov.canonicalObjective).toBe('Fila persistente');
  });

  test('correlação é por sourceId (ID estável), não por título', () => {
    const prov = buildCanonicalProvenance({ candidate, planningGeneration: 1, materializationReason: 'ready' });
    expect(prov.sourceId).toBe('SUP-01');
    expect(prov.document).toBe('docs/planos/002.md');
  });

  test('intent não-canônico / malformado → null (fail-safe)', () => {
    expect(readCanonicalProvenanceFromIntent({ execution_spec: {} })).toBeNull();
    expect(readCanonicalProvenanceFromIntent(null)).toBeNull();
    expect(readCanonicalProvenanceFromIntent({ [CANONICAL_PROVENANCE_KEY]: { kind: 'chat' } })).toBeNull();
    expect(readCanonicalProvenanceFromIntent({ [CANONICAL_PROVENANCE_KEY]: { kind: 'canonical_backlog', sourceId: '' } })).toBeNull();
    expect(readCanonicalSourceIdFromIntent({ execution_spec: {} })).toBeNull();
  });

  test('planningGeneration inválida → null', () => {
    const bad = { [CANONICAL_PROVENANCE_KEY]: { kind: 'canonical_backlog', sourceId: 'X', document: 'd', heading: 'h', canonicalObjective: 'o', planningGeneration: 0 } };
    expect(readCanonicalProvenanceFromIntent(bad)).toBeNull();
  });
});

describe('mensagens de materialização/planejamento (puras)', () => {
  test('mensagem de origem marca o gatilho canônico e a fonte', () => {
    const msg = buildCanonicalMaterializationMessage(candidate);
    expect(msg).toContain('[backlog-canônico SUP-01]');
    expect(msg).toContain('Fila persistente');
    expect(msg).toContain('docs/planos/002.md');
  });

  test('instrução de planejamento pede UM slice e cita o objetivo', () => {
    const msg = buildCanonicalSlicePlanningMessage({ candidate, planningGeneration: 1 });
    expect(msg).toContain('EXATAMENTE UM');
    expect(msg).toContain('SUP-01 — Fila persistente');
    expect(msg).not.toContain('Slices anteriores');
  });

  test('instrução inclui slices anteriores quando há histórico', () => {
    const msg = buildCanonicalSlicePlanningMessage({ candidate, planningGeneration: 2, priorSlicesSummary: 'wi-1: criou a tabela.' });
    expect(msg).toContain('Slices anteriores');
    expect(msg).toContain('wi-1: criou a tabela.');
  });
});
