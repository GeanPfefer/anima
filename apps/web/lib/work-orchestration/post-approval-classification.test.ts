/** @jest-environment node */
import { planAutonomousBacklogTurn, validateWorkIntelligenceClassification, type AutonomousQueueCandidate, type WorkState, type WorkIntelligenceClassificationV1 } from '@anima/core';
import { buildInvestigationProposal } from './investigation-preparation';
import { classifyApprovedUnclassified, readPostApprovalClassificationConfig } from './post-approval-classification';

const since = new Date('2026-10-01T00:00:00Z');
const approvedAt = new Date('2026-10-05T12:00:00Z');
const canonical = { canonical_provenance: { kind: 'canonical_backlog', sourceId: 'SDC-22', document: 'plan', heading: 'SDC', canonicalObjective: 'Classify', planningGeneration: 1 } };
const investigation = buildInvestigationProposal({ question: 'Contrato?', baseSha: 'a'.repeat(40) }, 'INV-01', approvedAt.toISOString());
const classification: WorkIntelligenceClassificationV1 = { schemaVersion: 1, complexity: 'bounded', risk: 'low', reversibility: 'reversible', planClarity: 'clear', urgency: 'normal', provenance: { kind: 'system_assessed', classifiedAt: approvedAt.toISOString(), classifierId: 'canonical_backlog_v1-bridge', policyVersion: 'human-approved-project-planner-v1' } };
function candidate(id = 'A', seq = 1): AutonomousQueueCandidate {
  return { item: { id, userId: 'u', sourceMessageId: 'm', originalRequest: 'Classify', state: 'approved', impactLevel: 'low', capability: 'programming', intent: canonical,
    proposal: investigation.proposal, proposalVersion: 1, createdAt: since, updatedAt: approvedAt },
    approval: { seq, approvedAt, proposalVersion: 1 }, currentClassification: null, openClaim: null };
}
const success = () => jest.fn(async () => ({ ok: true as const, replayed: false }));
const options = (ensure = success()) => ({ ensure, since, attempted: new Set<string>(), now: approvedAt });

describe('configuração estrita e pura', () => {
  test.each([undefined, '', 'today', 'NaN', '2026-10-01', '2026-10-01T00:00:00', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-10-01T24:00:00Z', '2026-10-01T00:00:00Z\n'])('recusa cutoff %s', raw => {
    expect(readPostApprovalClassificationConfig({ ANIMA_POST_APPROVAL_CLASSIFICATION: '1', ANIMA_POST_APPROVAL_CLASSIFICATION_SINCE: raw })).toBeNull();
  });
  test.each([undefined, '0', 'true', '01', ' 1'])('exige ativação exata %s', flag => {
    expect(readPostApprovalClassificationConfig({ ANIMA_POST_APPROVAL_CLASSIFICATION: flag, ANIMA_POST_APPROVAL_CLASSIFICATION_SINCE: since.toISOString() })).toBeNull();
  });
  test.each(['2026-10-01T00:00:00Z', '2026-09-30T21:00:00.000-03:00', '2026-10-01T02:00:00+02:00'])('aceita ISO com fuso %s', raw => {
    expect(readPostApprovalClassificationConfig({ ANIMA_POST_APPROVAL_CLASSIFICATION: '1', ANIMA_POST_APPROVAL_CLASSIFICATION_SINCE: raw })).toEqual({ since });
  });
});

describe('classificação pós-aprovação T3', () => {
  test.each<WorkState>(['proposed', 'in_progress', 'blocked', 'review', 'completed', 'changes_requested', 'failed', 'cancelled', 'rejected'])('exclui estado %s', async state => {
    const c = candidate(), deps = options();
    await classifyApprovedUnclassified([{ ...c, item: { ...c.item, state } }], deps);
    expect(deps.ensure).not.toHaveBeenCalled();
  });
  test('exclui aprovação ausente ou stale, cutoff anterior/igual/NaN e classificação vigente', async () => {
    const c = candidate(), deps = options();
    const variants = [ { ...c, approval: null }, { ...c, approval: { ...c.approval!, proposalVersion: 2 } },
      ...[new Date(since.getTime() - 1), since, new Date(NaN)].map(date => ({ ...c, approval: { ...c.approval!, approvedAt: date } })),
      { ...c, currentClassification: classification } ];
    await classifyApprovedUnclassified(variants, deps);
    expect(deps.ensure).not.toHaveBeenCalled();
  });
  test.each<AutonomousQueueCandidate['item']['intent']>([{}, { planner: 'openai_project_tools_v1' }, { planner: 'local_ollama_project_tools_v1' }, { source: 'chat' }, { execution_spec: { resume_from_checkpoint: {} } }, { investigation_provenance: { origin: 'cli_propose_investigation_v1' } }])('allowlist não vaza para %j', async intent => {
    const c = candidate(), deps = options();
    await classifyApprovedUnclassified([{ ...c, item: { ...c.item, intent } }], deps);
    expect(deps.ensure).not.toHaveBeenCalled();
  });
  test('canonical e investigação válida chamam somente o primitive com id/versão', async () => {
    const c = candidate('INV', 2), deps = options();
    const result = await classifyApprovedUnclassified([candidate(), { ...c, item: { ...c.item, intent: investigation.intent } }], deps);
    expect(deps.ensure.mock.calls).toEqual([['A', 1], ['INV', 1]]);
    expect(result.classified).toHaveLength(2);
  });
  test('investigação com provenance inválida ou envelope inválido é excluída', async () => {
    const c = candidate(), deps = options();
    for (const intent of [{ ...investigation.intent, investigation_provenance: {} }, { ...investigation.intent, execution_spec: {} }]) {
      await classifyApprovedUnclassified([{ ...c, item: { ...c.item, intent } }], deps);
    }
    expect(deps.ensure).not.toHaveBeenCalled();
  });
  test('claim ativo exclui; expirado e liberado permitem', async () => {
    const c = candidate();
    const claim = { claimId: 'claim', workItemId: 'A', approvedProposalVersion: 1, ownerInstanceId: 'host', acquiredAt: since, expiresAt: new Date(approvedAt.getTime() + 1000), attemptId: null, release: null };
    const deps = options();
    await classifyApprovedUnclassified([{ ...c, openClaim: claim }], deps);
    expect(deps.ensure).not.toHaveBeenCalled();
    await classifyApprovedUnclassified([{ ...c, openClaim: { ...claim, expiresAt: approvedAt } }], deps);
    await classifyApprovedUnclassified([{ ...candidate('B'), openClaim: { ...claim, release: { reason: 'released_without_attempt', releasedAt: since } } }], deps);
    expect(deps.ensure).toHaveBeenCalledTimes(2);
  });
  test('FIFO por seq/id, limite configurado e default três', async () => {
    const cs = [candidate('D', 3), candidate('C', 2), candidate('B', 1), candidate('A', 1)];
    const deps = options();
    const result = await classifyApprovedUnclassified(cs, { ...deps, maxItems: 2 });
    expect(deps.ensure.mock.calls).toEqual([['A', 1], ['B', 1]]);
    expect(result.skipped.map(s => s.reason)).toEqual(['max_items', 'max_items']);
    const defaults = options();
    await classifyApprovedUnclassified(cs, defaults);
    expect(defaults.ensure).toHaveBeenCalledTimes(3);
  });
  test.each(['rejected', 'threw'])('absorve ensure %s sem mutação, retry na volta ou elegibilidade', async mode => {
    const c = candidate(), before = JSON.stringify(c);
    const ensure = jest.fn(async () => { if (mode === 'threw') throw new Error('provider secret'); return { ok: false as const, code: 'provider secret', message: 'provider secret' }; });
    const deps = { since, ensure, attempted: new Set<string>() };
    const result = await classifyApprovedUnclassified([c, c], deps);
    await classifyApprovedUnclassified([c], deps);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(result.failed).toEqual([{ workItemId: 'A', proposalVersion: 1, reason: mode === 'threw' ? 'ensure_threw' : 'ensure_rejected' }]);
    expect(JSON.stringify(result)).not.toContain('provider secret');
    expect(JSON.stringify(c)).toBe(before);
    expect(planAutonomousBacklogTurn({ candidates: [c], now: approvedAt, hostPermitsAutonomousWork: true }).action).not.toBe('execute_next');
    await classifyApprovedUnclassified([{ ...c, item: { ...c.item, proposalVersion: 2 }, approval: { ...c.approval!, proposalVersion: 2 } }], deps);
    expect(ensure).toHaveBeenCalledTimes(2);
  });
  test('replay de corrida é sucesso e duas chamadas concorrentes escrevem uma única vez', async () => {
    let writes = 0;
    const persisted: WorkIntelligenceClassificationV1[] = [];
    const ensure = jest.fn(async () => {
      await Promise.resolve();
      if (writes) return { ok: true as const, replayed: true };
      writes++; persisted.push(classification); return { ok: true as const, replayed: false };
    });
    const results = await Promise.all([1, 2].map(() => classifyApprovedUnclassified([candidate()], { since, ensure, attempted: new Set<string>() })));
    expect(writes).toBe(1);
    expect(persisted).toHaveLength(1);
    expect(validateWorkIntelligenceClassification(persisted[0])).toBeNull();
    expect(results.map(r => [r.classified.length, r.replayed.length])).toEqual([[1, 0], [0, 1]]);
    writes = 0; persisted.length = 0;
    const [, manualRace] = await Promise.all([
      ensure(), // Mesmo primitive chamado pelo fallback work prepare-autonomous.
      classifyApprovedUnclassified([candidate()], { since, ensure, attempted: new Set<string>() }),
    ]);
    expect(manualRace.replayed).toEqual([{ workItemId: 'A', proposalVersion: 1 }]);
    expect(writes).toBe(1);
    expect(persisted).toHaveLength(1);
  });
});
