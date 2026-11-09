import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExecutoresPanel, type ExecutorDiscoveryView } from './ExecutoresPanel';

const view = (over: Partial<ExecutorDiscoveryView> = {}): ExecutorDiscoveryView => ({
  workItemId: 'u1', state: 'approved', proposalVersion: 1, observedAt: '2026-11-09T22:00:00.000Z', contractBackend: null,
  candidates: [{ provider: 'codex-cli', backendId: 'codex-cli:gpt', displayName: 'Codex CLI', availability: 'ready', eligibility: 'eligible', reasonUnavailable: null, reasonIneligible: null, model: 'gpt', costClass: 'subscription' }],
  recommendation: { backendId: 'codex-cli:gpt', rule: 'local_first', reason: 'primeiro elegível pronto' }, noRecommendation: null,
  governedCommand: 'npm run anima -- work execute-one PROOF-03 --version 1', ...over,
});
const fetcherOf = (value: ExecutorDiscoveryView | null, ok = true) =>
  jest.fn(async () => ({ ok, json: async () => ({ ok, value }) }) as unknown as Response) as unknown as typeof fetch;

describe('ExecutoresPanel', () => {
  test('não consulta nada até o clique e mostra executor, prontidão e comando humano', async () => {
    const fetcher = fetcherOf(view());
    render(<ExecutoresPanel workItemId="u1" fetcher={fetcher} />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Verificar executores' }));
    await waitFor(() => expect(screen.getByText('Codex CLI')).toBeInTheDocument());
    expect(fetcher).toHaveBeenCalledWith('/api/work-orchestration/items/u1/executors');
    expect(screen.getByText(/pronto, elegível/)).toBeInTheDocument();
    expect(screen.getByText('npm run anima -- work execute-one PROOF-03 --version 1')).toBeInTheDocument();
  });

  test('fora de approved não oferece comando de execução', async () => {
    render(<ExecutoresPanel workItemId="u1" fetcher={fetcherOf(view({ state: 'proposed' }))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar executores' }));
    await waitFor(() => expect(screen.getByText(/exige proposta aprovada/)).toBeInTheDocument());
    expect(screen.queryByText(/execute-one/)).toBeNull();
  });

  test('falha da rota vira alerta compreensível', async () => {
    render(<ExecutoresPanel workItemId="u1" fetcher={fetcherOf(null, false)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar executores' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível verificar'));
  });

  test('com nextSteps lista os atos por responsavel, sem executar nada', async () => {
    const fetcher = fetcherOf(view({ state: 'proposed', nextSteps: [{ label: 'Aprovar a proposta', actor: 'human', command: 'npm run anima -- work approve u1' }] }));
    render(<ExecutoresPanel workItemId="u1" fetcher={fetcher} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar executores' }));
    await waitFor(() => expect(screen.getByText('npm run anima -- work approve u1')).toBeInTheDocument());
    expect(screen.getByText(/Humano — Aprovar a proposta/)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
