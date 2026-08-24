import type { ProjectBacklogProposalDraft } from '@anima/core';
import { processProjectBacklogGovernance, type ProjectBacklogGovernanceDeps } from './project-backlog-governance';

const draft: ProjectBacklogProposalDraft = { objective: 'Aplicar preferência local-first', rationale: 'Decomposição causal', exclusions: ['auto-provisioning'], uncertainties: [], slices: [{ sliceKey: 'capacity-inventory', summary: 'Representar capacidade disponível', objective: 'Modelar nós sem provisionar', impactLevel: 'structural', capability: 'programming', dependencies: [], intent: {}, proposal: { schemaVersion: 1, data: { summary: 'Representar capacidade', objective: 'Modelar nós', includedScope: ['packages/core/src'], excludedScope: ['infra'], expectedEffects: ['Inventário'], risks: ['Modelo prematuro'] } } }] };
const dependencies = (): ProjectBacklogGovernanceDeps & { [K in keyof ProjectBacklogGovernanceDeps]: jest.Mock } => ({
  formulate: jest.fn(async () => draft), persistHumanMessage: jest.fn(async () => 'message-1'),
  createProposal: jest.fn(async () => ({ id: 'backlog-1', version: 1 })), requestChanges: jest.fn(async () => undefined),
  materialize: jest.fn(async () => ['work-1']),
});

describe('boundary conversacional do Backlog Proposal V0', () => {
  test('decisão ratificada no host pode originar proposta, sem materializar', async () => {
    const deps = dependencies();
    const result = await processProjectBacklogGovernance({ message: 'Sim.', pending: [], ratifiedDecisionThisTurn: { id: 'decision-1', version: 1, statement: 'Local primeiro.' } }, deps);
    expect(result).toMatchObject({ kind: 'proposal', proposalId: 'backlog-1' });
    expect(deps.createProposal).toHaveBeenCalledWith(expect.objectContaining({ provenance: { source: 'system_derivation', sourceDecisionId: 'decision-1', sourceDecisionVersion: 1 } }));
    expect(deps.materialize).not.toHaveBeenCalled(); expect(deps.persistHumanMessage).not.toHaveBeenCalled();
  });
  test('sem ratificação autoritativa do host, modelo/planner não cria proposal', async () => {
    const deps = dependencies();
    expect(await processProjectBacklogGovernance({ message: 'O modelo sugeriu criar tarefas.', pending: [] }, deps)).toEqual({ kind: 'conversation' });
    expect(deps.formulate).not.toHaveBeenCalled(); expect(deps.createProposal).not.toHaveBeenCalled();
  });
  test('legal não confirma', async () => {
    const deps = dependencies();
    expect(await processProjectBacklogGovernance({ message: 'Legal.', pending: [{ id: 'b', version: 1 }] }, deps)).toEqual({ kind: 'conversation' });
    expect(deps.materialize).not.toHaveBeenCalled();
  });
  test('confirmação explícita materializa e não aprova', async () => {
    const deps = dependencies();
    const result = await processProjectBacklogGovernance({ message: 'Pode registrar isso no backlog.', pending: [{ id: 'b', version: 2 }] }, deps);
    expect(result).toMatchObject({ kind: 'materialized', workItemIds: ['work-1'] });
    expect(deps.materialize).toHaveBeenCalledWith({ proposal: { id: 'b', version: 2 }, confirmationMessageId: 'message-1', provenance: { source: 'human_confirmation', actor: 'user' } });
    expect(result.kind === 'materialized' && result.text).toContain('Nenhum foi aprovado ou iniciado');
  });
  test('revisão encerra versão atual sem materializar', async () => {
    const deps = dependencies();
    const result = await processProjectBacklogGovernance({ message: 'Não quero cloud provisioning ainda.', pending: [{ id: 'b', version: 1 }] }, deps);
    expect(result.kind).toBe('changes_requested'); expect(deps.requestChanges).toHaveBeenCalled(); expect(deps.materialize).not.toHaveBeenCalled();
  });
  test('duas propostas pendentes falham fechadas em conversa', async () => {
    const deps = dependencies();
    expect(await processProjectBacklogGovernance({ message: 'Pode registrar.', pending: [{ id: 'a', version: 1 }, { id: 'b', version: 1 }] }, deps)).toEqual({ kind: 'conversation' });
    expect(deps.materialize).not.toHaveBeenCalled();
  });
  test('draft inválido do planner é recusado pelo host', async () => {
    const deps = dependencies(); deps.formulate.mockResolvedValue({ ...draft, slices: [] });
    await expect(processProjectBacklogGovernance({ message: 'Sim.', pending: [], ratifiedDecisionThisTurn: { id: 'd', version: 1, statement: 'Direção.' } }, deps)).rejects.toThrow('project_backlog_proposal_invalid:slice_count_invalid');
    expect(deps.createProposal).not.toHaveBeenCalled();
  });
  test('zero trabalho necessário termina honestamente sem proposal', async () => {
    const deps = dependencies(); deps.formulate.mockResolvedValue({ noWorkRequired: true, rationale: 'A direção já é satisfeita pelo estado atual.' });
    const result = await processProjectBacklogGovernance({ message: 'Sim.', pending: [], ratifiedDecisionThisTurn: { id: 'd', version: 1, statement: 'Manter o comportamento atual.' } }, deps);
    expect(result).toMatchObject({ kind: 'no_work_required' }); expect(deps.createProposal).not.toHaveBeenCalled();
  });
});
