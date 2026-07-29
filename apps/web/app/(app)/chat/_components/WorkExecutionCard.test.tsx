import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AutonomousExecutionProjection } from '@anima/core';
import { WorkExecutionCard } from './WorkExecutionCard';

const base: AutonomousExecutionProjection = {
  attemptId: 'att-1', status: 'running', startedAt: '2026-07-29T12:00:00.000Z',
  executorId: 'local-runner-v1', providerRef: 'local-node', modelRef: 'qwen2.5-coder:14b', effort: 'standard',
  limits: { maxAttempts: 3, maxDurationMinutes: 5 },
  latestCheckpoint: { signalSequence: 2, completedSteps: 1, remainingSteps: 2, nextStep: 'editar calculator.py' },
  pendingControl: null, appliedControl: null, budgetBlock: null, canRequestControl: true,
};
const projection = (overrides: Partial<AutonomousExecutionProjection> = {}): AutonomousExecutionProjection => ({ ...base, ...overrides });
const okResponse = { ok: true, json: async () => ({ ok: true, value: { action: 'recorded', requestEventSeq: 10 } }) };

describe('WorkExecutionCard', () => {
  beforeEach(() => { global.fetch = jest.fn().mockResolvedValue(okResponse) as jest.Mock; });

  test('projeta executor, provedor, modelo, esforço, limites e checkpoint', () => {
    render(<WorkExecutionCard execution={projection()} workItemId="item-1" proposalVersion={1} onReload={jest.fn()} />);
    expect(screen.getByText('Em execução')).toBeInTheDocument();
    expect(screen.getByText('local-runner-v1')).toBeInTheDocument();
    expect(screen.getByText('local-node')).toBeInTheDocument();
    expect(screen.getByText('qwen2.5-coder:14b')).toBeInTheDocument();
    expect(screen.getByText('standard')).toBeInTheDocument();
    expect(screen.getByText('3 tentativa(s) · 5 min')).toBeInTheDocument();
    expect(screen.getByText(/Checkpoint #2: 1 concluído\(s\), 2 restante\(s\)/)).toBeInTheDocument();
  });

  test('em execução oferece pausar e cancelar', () => {
    render(<WorkExecutionCard execution={projection()} workItemId="item-1" proposalVersion={1} onReload={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  test('pausar envia o pedido com item, versão e tentativa exatos e recarrega', async () => {
    const onReload = jest.fn();
    render(<WorkExecutionCard execution={projection()} workItemId="item-1" proposalVersion={2} onReload={onReload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/work-orchestration/control', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body).toEqual({ workItemId: 'item-1', expectedProposalVersion: 2, attemptId: 'att-1', action: 'pause' });
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
  });

  test('cancelar exige confirmação antes de enviar', async () => {
    render(<WorkExecutionCard execution={projection()} workItemId="item-1" proposalVersion={1} onReload={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/work-orchestration/control', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"action":"cancel"') })));
  });

  test('pedido pendente aparece e as ações desaparecem (projeção manda)', () => {
    render(<WorkExecutionCard execution={projection({ pendingControl: { action: 'pause', requestedAt: '2026-07-29T12:05:00.000Z' }, canRequestControl: false })} workItemId="item-1" proposalVersion={1} onReload={jest.fn()} />);
    expect(screen.getByText(/Pedido de pausa registrado/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });

  test('pausa aplicada é exibida como resultado, sem ações', () => {
    render(<WorkExecutionCard execution={projection({ status: 'paused', appliedControl: { action: 'pause', reason: 'paused_by_user', appliedAt: '2026-07-29T12:06:00.000Z' }, canRequestControl: false })} workItemId="item-1" proposalVersion={1} onReload={jest.fn()} />);
    expect(screen.getByText('Pausada')).toBeInTheDocument();
    expect(screen.getByText(/Pausada por você em/)).toBeInTheDocument();
    expect(screen.getByText('2026-07-29 12:06 UTC')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
  });

  test('bloqueio por orçamento é projetado com a razão', () => {
    render(<WorkExecutionCard execution={projection({ status: 'blocked', canRequestControl: false, budgetBlock: { reason: 'interactive_reserve_protected', reachedLimit: 'resources' } })} workItemId="item-1" proposalVersion={1} onReload={jest.fn()} />);
    expect(screen.getByText(/Orçamento atingido: interactive_reserve_protected/)).toBeInTheDocument();
  });

  test('resultado em revisão não oferece pausar/cancelar', () => {
    render(<WorkExecutionCard execution={projection({ status: 'submitted_for_review', canRequestControl: false })} workItemId="item-1" proposalVersion={1} onReload={jest.fn()} />);
    expect(screen.getByText('Resultado em revisão')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
  });

  test('versão obsoleta é recusada com mensagem e força reprojeção', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false, error: { code: 'version_conflict', message: 'O item mudou desde a última leitura.' } }) });
    const onReload = jest.fn();
    render(<WorkExecutionCard execution={projection()} workItemId="item-1" proposalVersion={1} onReload={onReload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('O item mudou desde a última leitura.'));
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
  });

  test('uma tentativa autônoma sem decisão de rota ainda mostra o executor', () => {
    render(<WorkExecutionCard execution={projection({ providerRef: null, modelRef: null, effort: null })} workItemId="item-1" proposalVersion={1} onReload={jest.fn()} />);
    expect(screen.getByText('local-runner-v1')).toBeInTheDocument();
    expect(screen.queryByText('Provedor')).not.toBeInTheDocument();
  });
});
