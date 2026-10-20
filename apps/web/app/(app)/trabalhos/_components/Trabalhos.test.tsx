import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CatalogPage, CatalogQuery, CatalogRow } from '@/lib/work-orchestration/work-catalog';
import { TrabalhosCatalog } from './TrabalhosCatalog';
import { TrabalhoAmbiguo, TrabalhoIndisponivel } from './TrabalhoStatus';
import { TrabalhoDetalhe } from './TrabalhoDetalhe';
import type { WorkPresentationView } from '@/app/(app)/chat/_components/WorkProposalCard';

jest.mock('@/app/(app)/chat/_components/WorkProposalCard', () => ({
  WorkProposalCard: (props: { presentation: { item: { id: string; state: string } }; focused: boolean; onFocus: () => void; onChange: (value: unknown) => void; autonomousExecutionAllowed?: boolean }) => (
    <div data-testid="card" data-focused={String(props.focused)} data-eligible={String(props.autonomousExecutionAllowed)}>
      <span>{props.presentation.item.state}</span>
      <button onClick={props.onFocus}>focar</button>
      <button onClick={() => props.onChange({ ...props.presentation, item: { ...props.presentation.item, state: 'completed' } })}>mudar</button>
    </div>
  ),
}));

const query: CatalogQuery = { search: '', states: [], pendingOnly: false, order: 'updated_desc', page: 1, pageSize: 25 };
const row = (overrides: Partial<CatalogRow> = {}): CatalogRow => ({
  id: '11111111-1111-4111-8111-111111111111', reference: 'PROOF-01', title: 'Teto de bônus', summary: 'Resumo longo', state: 'completed', stateLabel: 'Concluído',
  proposalVersion: 1, createdAt: '2026-10-20T19:43:39+00:00', updatedAt: '2026-10-20T20:44:25+00:00', needsHuman: false, humanAction: null,
  href: '/trabalhos/PROOF-01?item=11111111-1111-4111-8111-111111111111', ...overrides,
});
const page = (overrides: Partial<CatalogPage> = {}): CatalogPage => ({ items: [row()], page: 1, pageSize: 25, total: 1, totalPages: 1, pendingTotal: 0, ...overrides });

describe('TrabalhosCatalog', () => {
  test('lista com código, estado, versão, data e link para o detalhe por referência', () => {
    render(<TrabalhosCatalog query={query} result={{ ok: true, value: page() }} />);
    expect(screen.getByRole('heading', { name: 'Trabalhos' })).toBeInTheDocument();
    const item = within(screen.getByRole('list', { name: 'Trabalhos' })).getAllByRole('listitem')[0]!;
    expect(within(item).getByText('PROOF-01')).toBeInTheDocument();
    expect(within(item).getByText('Concluído')).toBeInTheDocument();
    expect(within(item).getByText(/v1 · atualizado 2026-10-20 20:44 UTC/)).toBeInTheDocument();
    expect(within(item).getByRole('link')).toHaveAttribute('href', '/trabalhos/PROOF-01?item=11111111-1111-4111-8111-111111111111');
    expect(screen.getByText('1 trabalho · página 1 de 1')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Decisões pendentes' })).toBeNull();
  });

  test('destaca decisões humanas pendentes e leva direto ao filtro de pendentes', () => {
    const items = [row({ id: 'a', state: 'review', stateLabel: 'Em revisão', needsHuman: true, humanAction: 'Revisar resultado' }), row({ id: 'b', reference: null, href: '/trabalhos/b' })];
    render(<TrabalhosCatalog query={{ ...query, search: 'xp' }} result={{ ok: true, value: page({ items, total: 2, pendingTotal: 3 }) }} />);
    const banner = screen.getByRole('status', { name: 'Decisões pendentes' });
    expect(within(banner).getByText('3 trabalhos aguardam sua decisão')).toBeInTheDocument();
    expect(within(banner).getByRole('link', { name: 'Ver pendentes' })).toHaveAttribute('href', '/trabalhos?pendentes=1');
    const [pending, normal] = screen.getAllByRole('listitem');
    expect(pending).toHaveAttribute('data-needs-human', 'true');
    expect(within(pending!).getByText('Revisar resultado')).toBeInTheDocument();
    expect(normal).toHaveAttribute('data-needs-human', 'false');
  });

  test('singular e sem o atalho quando já filtrado por pendentes', () => {
    render(<TrabalhosCatalog query={{ ...query, pendingOnly: true }} result={{ ok: true, value: page({ pendingTotal: 1 }) }} />);
    expect(screen.getByText('1 trabalho aguarda sua decisão')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ver pendentes' })).toBeNull();
  });

  test('formulário GET preserva busca, estado, ordem e pendentes; Limpar só aparece com filtros', () => {
    const active: CatalogQuery = { ...query, search: 'PROOF-01', states: ['review'], pendingOnly: true, order: 'created_asc' };
    render(<TrabalhosCatalog query={active} result={{ ok: true, value: page() }} />);
    const form = screen.getByRole('search', { name: 'Buscar trabalhos' });
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/trabalhos');
    expect(within(form).getByRole('searchbox')).toHaveValue('PROOF-01');
    expect(within(form).getByLabelText('Estado')).toHaveValue('review');
    expect(within(form).getByLabelText('Ordenar')).toHaveValue('created_asc');
    expect(within(form).getByRole('checkbox')).toBeChecked();
    expect(within(form).getByRole('link', { name: 'Limpar' })).toHaveAttribute('href', '/trabalhos');
  });

  test('sem filtros não mostra Limpar e oferece todos os estados e ordenações', () => {
    render(<TrabalhosCatalog query={query} result={{ ok: true, value: page() }} />);
    expect(screen.queryByRole('link', { name: 'Limpar' })).toBeNull();
    expect(within(screen.getByLabelText('Estado')).getAllByRole('option')).toHaveLength(11);
    expect(within(screen.getByLabelText('Ordenar')).getAllByRole('option')).toHaveLength(4);
  });

  test('paginação preserva os filtros e desabilita os extremos', () => {
    const q: CatalogQuery = { ...query, search: 'xp', states: ['failed'], page: 2 };
    render(<TrabalhosCatalog query={q} result={{ ok: true, value: page({ page: 2, total: 80, totalPages: 4 }) }} />);
    const nav = screen.getByRole('navigation', { name: 'Paginação' });
    expect(within(nav).getByRole('link', { name: '← Anterior' })).toHaveAttribute('href', '/trabalhos?q=xp&estado=failed');
    expect(within(nav).getByRole('link', { name: 'Próxima →' })).toHaveAttribute('href', '/trabalhos?q=xp&estado=failed&pagina=3');
    expect(within(nav).getByText('Página 2 de 4')).toBeInTheDocument();
  });

  test('primeira e última página não têm link para fora do intervalo', () => {
    const { rerender } = render(<TrabalhosCatalog query={query} result={{ ok: true, value: page({ total: 80, totalPages: 4 }) }} />);
    expect(screen.queryByRole('link', { name: '← Anterior' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Próxima →' })).toBeInTheDocument();
    rerender(<TrabalhosCatalog query={{ ...query, page: 4 }} result={{ ok: true, value: page({ page: 4, total: 80, totalPages: 4 }) }} />);
    expect(screen.queryByRole('link', { name: 'Próxima →' })).toBeNull();
    expect(screen.getByRole('link', { name: '← Anterior' })).toBeInTheDocument();
  });

  test('lista vazia: sem filtros e com filtros', () => {
    const empty = page({ items: [], total: 0, totalPages: 0 });
    const { rerender } = render(<TrabalhosCatalog query={query} result={{ ok: true, value: empty }} />);
    expect(screen.getByText('Ainda não há trabalhos.')).toBeInTheDocument();
    rerender(<TrabalhosCatalog query={{ ...query, search: 'zzz' }} result={{ ok: true, value: empty }} />);
    expect(screen.getByText('Nenhum trabalho encontrado com esses filtros.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Limpar filtros' })).toHaveAttribute('href', '/trabalhos');
  });

  test('erros: consulta inválida e catálogo indisponível, sempre com caminho de volta', () => {
    const { rerender } = render(<TrabalhosCatalog query={query} result={{ ok: false, code: 'invalid_catalog_query', message: 'Estado desconhecido: x.' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Consulta inválida');
    expect(screen.getByRole('alert')).toHaveTextContent('Estado desconhecido: x.');
    rerender(<TrabalhosCatalog query={query} result={{ ok: false, code: 'catalog_unavailable', message: 'Não foi possível ler os trabalhos.' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar os trabalhos');
    expect(screen.getByRole('link', { name: 'Voltar à lista completa' })).toHaveAttribute('href', '/trabalhos');
  });

  test('título igual ao resumo não duplica o texto', () => {
    render(<TrabalhosCatalog query={query} result={{ ok: true, value: page({ items: [row({ title: 'Mesmo', summary: 'Mesmo' })] }) }} />);
    expect(screen.getAllByText('Mesmo')).toHaveLength(1);
  });
});

describe('TrabalhoStatus', () => {
  test('ambíguo lista os candidatos por UUID, sem abrir nenhum', () => {
    render(<TrabalhoAmbiguo reference="SDC-02" candidates={[
      { workItemId: '11111111-1111-4111-8111-111111111111', state: 'failed', proposalVersion: 1, createdAt: '2026-10-01T10:00:00+00:00', document: 'd' },
      { workItemId: '22222222-2222-4222-8222-222222222222', state: 'completed', proposalVersion: 2, createdAt: '2026-10-02T10:00:00+00:00', document: 'd' },
    ]} />);
    expect(screen.getByRole('heading')).toHaveTextContent('SDC-02 corresponde a mais de um trabalho');
    const links = within(screen.getByRole('list', { name: 'Candidatos' })).getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/trabalhos/SDC-02?item=11111111-1111-4111-8111-111111111111', '/trabalhos/SDC-02?item=22222222-2222-4222-8222-222222222222',
    ]);
  });
  test.each([['not_found', 'Trabalho não encontrado'], ['invalid', 'Referência inválida'], ['error', 'Não foi possível carregar o trabalho']] as const)('%s', (kind, title) => {
    render(<TrabalhoIndisponivel kind={kind} />);
    expect(screen.getByRole('alert')).toHaveTextContent(title);
    expect(screen.getByRole('link', { name: '← Todos os trabalhos' })).toHaveAttribute('href', '/trabalhos');
  });
});

describe('TrabalhoDetalhe', () => {
  const presentation = (state = 'review') => ({
    item: { id: '11111111-1111-4111-8111-111111111111', state, proposalVersion: 1, intent: {}, proposal: { data: { summary: 's' } } },
    autonomousReadiness: { eligible: true, blockingDependencyIds: [], reason: 'eligible' },
  } as unknown as WorkPresentationView);

  test('hospeda o WorkProposalCard existente, mostra código/título/estado e atualiza com onChange', () => {
    render(<TrabalhoDetalhe initial={presentation()} reference="PROOF-01" title="Teto de bônus" />);
    expect(screen.getByRole('heading')).toHaveTextContent('PROOF-01 Teto de bônus');
    expect(screen.getByText(/review · v1 · id 11111111/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Todos os trabalhos' })).toHaveAttribute('href', '/trabalhos');
    expect(screen.getByTestId('card')).toHaveAttribute('data-eligible', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'mudar' }));
    expect(screen.getByText(/completed · v1/)).toBeInTheDocument();
  });

  test('foco usa a rota existente e só marca o foco quando a rota aceita', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<TrabalhoDetalhe initial={presentation()} reference={null} title="Sem código" />);
    fireEvent.click(screen.getByRole('button', { name: 'focar' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível alterar o trabalho em foco.'));
    expect(screen.getByTestId('card')).toHaveAttribute('data-focused', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'focar' }));
    await waitFor(() => expect(screen.getByTestId('card')).toHaveAttribute('data-focused', 'true'));
    expect(fetchMock).toHaveBeenCalledWith('/api/work-orchestration/focus', expect.objectContaining({ method: 'POST', body: JSON.stringify({ workItemId: '11111111-1111-4111-8111-111111111111' }) }));
  });
});
