import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkFocusChoice } from './WorkFocusChoice';

const candidates = [
  { id: 'item-a', summary: 'Planejar tela de login' },
  { id: 'item-b', summary: 'Investigar bug do chat' },
];

describe('WorkFocusChoice', () => {
  test('exibe todos os candidatos e a saída explícita', () => {
    render(<WorkFocusChoice sourceMessageId="msg" candidates={candidates} onResolved={jest.fn()} onDismiss={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Planejar tela de login' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Investigar bug do chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nenhum destes' })).toBeInTheDocument();
  });
  test('fixa o foco e vincula a mensagem antes de confirmar', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, value: { id: 'item-b', proposalVersion: 3 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, value: { id: 'ctx' } }) }) as jest.Mock;
    const onResolved = jest.fn();
    render(<WorkFocusChoice sourceMessageId="msg-1" candidates={candidates} onResolved={onResolved} onDismiss={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Investigar bug do chat' }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('item-b', 'Investigar bug do chat'));
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/work-orchestration/focus', expect.objectContaining({ body: JSON.stringify({ workItemId: 'item-b' }) }));
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/work-orchestration/contexts', expect.objectContaining({ body: expect.stringContaining('"expectedProposalVersion":3') }));
    expect((global.fetch as jest.Mock).mock.calls[1][1].body).toContain('"id":"msg-1"');
  });
  test('falha mantém as opções e exibe erro com retry', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: { message: 'Foco indisponível.' } }) }) as jest.Mock;
    const onResolved = jest.fn();
    render(<WorkFocusChoice sourceMessageId="msg" candidates={candidates} onResolved={onResolved} onDismiss={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Planejar tela de login' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Foco indisponível.'));
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Planejar tela de login' })).toBeEnabled();
  });
});
