import {
  CATALOG_ORDERS, CATALOG_ORDER_LABELS, CATALOG_PAGE_SIZE_DEFAULT, WORK_STATES, WORK_STATE_LABELS,
  buildCatalogHref, type CatalogQuery, type CatalogReadResult,
} from '@/lib/work-orchestration/work-catalog';
import styles from './trabalhos.module.css';

// Visão do catálogo de Trabalhos: componente PURO (sem estado, sem fetch). A página servidor lê o catálogo e
// entrega o resultado; busca, filtros e paginação são formulários/links GET (a URL é o estado). Nenhuma ação de
// governança vive aqui: cada linha leva ao detalhe, que reutiliza o WorkProposalCard e as rotas atuais.

export type CatalogViewResult = CatalogReadResult | { readonly ok: false; readonly code: 'invalid_catalog_query'; readonly message: string };

const stamp = (iso: string) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '—');

export function TrabalhosCatalog({ query, result }: { query: CatalogQuery; result: CatalogViewResult }) {
  const selectedState = query.states.length === 1 ? query.states[0]! : '';
  const filtersActive = Boolean(query.search || query.states.length || query.pendingOnly || query.order !== 'updated_desc');
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Trabalhos</h1>
        <p>Propostas, execuções e resultados do projeto. A conversa fica no Chat; aqui você encontra, filtra e decide.</p>
      </header>

      {result.ok && result.value.pendingTotal > 0 && (
        <aside className={styles.pending} role="status" aria-label="Decisões pendentes">
          <strong>{result.value.pendingTotal} {result.value.pendingTotal === 1 ? 'trabalho aguarda' : 'trabalhos aguardam'} sua decisão</strong>
          {!query.pendingOnly && <a href={buildCatalogHref(query, { pendingOnly: true, page: 1, search: '', states: [] })}>Ver pendentes</a>}
        </aside>
      )}

      <form className={styles.filters} method="get" action="/trabalhos" role="search" aria-label="Buscar trabalhos">
        <label className={styles.field}>
          <span>Buscar por código ou título</span>
          <input type="search" name="q" defaultValue={query.search} maxLength={80} placeholder="Ex.: PROOF-01 ou teto de bônus" />
        </label>
        <label className={styles.field}>
          <span>Estado</span>
          <select name="estado" defaultValue={selectedState}>
            <option value="">Todos</option>
            {WORK_STATES.map(state => <option key={state} value={state}>{WORK_STATE_LABELS[state]}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>Ordenar</span>
          <select name="ordem" defaultValue={query.order}>
            {CATALOG_ORDERS.map(order => <option key={order} value={order}>{CATALOG_ORDER_LABELS[order]}</option>)}
          </select>
        </label>
        <label className={styles.check}>
          <input type="checkbox" name="pendentes" value="1" defaultChecked={query.pendingOnly} />
          <span>Só os que precisam de mim</span>
        </label>
        {query.pageSize !== CATALOG_PAGE_SIZE_DEFAULT && <input type="hidden" name="tamanho" value={query.pageSize} />}
        <div className={styles.actions}>
          <button type="submit">Filtrar</button>
          {filtersActive && <a href="/trabalhos">Limpar</a>}
        </div>
      </form>

      {!result.ok ? (
        <div className={styles.error} role="alert">
          <strong>{result.code === 'invalid_catalog_query' ? 'Consulta inválida' : 'Não foi possível carregar os trabalhos'}</strong>
          <p>{result.message}</p>
          <a href="/trabalhos">Voltar à lista completa</a>
        </div>
      ) : result.value.total === 0 ? (
        <div className={styles.empty} role="status">
          <strong>{filtersActive ? 'Nenhum trabalho encontrado com esses filtros.' : 'Ainda não há trabalhos.'}</strong>
          {filtersActive && <a href="/trabalhos">Limpar filtros</a>}
        </div>
      ) : (
        <>
          <p className={styles.summary} aria-live="polite">
            {result.value.total} {result.value.total === 1 ? 'trabalho' : 'trabalhos'} · página {result.value.page} de {result.value.totalPages}
          </p>
          <ul className={styles.list} aria-label="Trabalhos">
            {result.value.items.map(row => (
              <li key={row.id} className={styles.row} data-needs-human={row.needsHuman ? 'true' : 'false'}>
                <a href={row.href} className={styles.rowLink}>
                  <span className={styles.rowTop}>
                    {row.reference && <code className={styles.ref}>{row.reference}</code>}
                    <span className={styles.state} data-state={row.state}>{row.stateLabel}</span>
                    <span className={styles.meta}>v{row.proposalVersion} · atualizado {stamp(row.updatedAt)}</span>
                    {row.humanAction && <span className={styles.human}>{row.humanAction}</span>}
                  </span>
                  <strong className={styles.title}>{row.title}</strong>
                  {row.title !== row.summary && <span className={styles.summaryText}>{row.summary}</span>}
                </a>
              </li>
            ))}
          </ul>
          <nav className={styles.pagination} aria-label="Paginação">
            {result.value.page > 1
              ? <a rel="prev" href={buildCatalogHref(query, { page: result.value.page - 1 })}>← Anterior</a>
              : <span aria-disabled="true">← Anterior</span>}
            <span>Página {result.value.page} de {result.value.totalPages}</span>
            {result.value.page < result.value.totalPages
              ? <a rel="next" href={buildCatalogHref(query, { page: result.value.page + 1 })}>Próxima →</a>
              : <span aria-disabled="true">Próxima →</span>}
          </nav>
        </>
      )}
    </main>
  );
}
