import { isWaitingForUserWorkState, type WorkState } from '@anima/core';

// ============================================================
// Catálogo de Trabalhos (UX-TRABALHOS, incremento 1) — leitura LEVE, paginada e global.
//
// Autoridade: nenhuma. Só lê `work_items` do usuário autenticado (RLS + filtro explícito de user_id) e
// projeta uma linha por item SEM reconstruir eventos/contexto (o detalhe completo continua sendo a
// apresentação reconstruída de items/[id]). "Precisa de você" usa o critério de governança que já existe
// (`isWaitingForUserWorkState`: proposed, review, changes_requested); aprovar/aceitar/executar continuam
// sendo feitos pelas rotas e pelo WorkProposalCard existentes.
// ============================================================

export const WORK_STATE_LABELS: Record<WorkState, string> = {
  proposed: 'Proposta', approved: 'Aprovado', in_progress: 'Em execução', blocked: 'Bloqueado',
  review: 'Em revisão', changes_requested: 'Mudanças pedidas', completed: 'Concluído',
  failed: 'Falhou', rejected: 'Rejeitado', cancelled: 'Cancelado',
};
export const WORK_STATES = Object.keys(WORK_STATE_LABELS) as readonly WorkState[];
export const HUMAN_ATTENTION_STATES: readonly WorkState[] = WORK_STATES.filter(isWaitingForUserWorkState);

const HUMAN_ACTION_LABELS: Partial<Record<WorkState, string>> = {
  proposed: 'Decidir proposta', review: 'Revisar resultado', changes_requested: 'Tratar mudanças pedidas',
};

export const CATALOG_PAGE_SIZE_DEFAULT = 25;
export const CATALOG_PAGE_SIZE_MAX = 50;
export const CATALOG_SEARCH_MAX_LENGTH = 80;

export const CATALOG_ORDERS = ['updated_desc', 'updated_asc', 'created_desc', 'created_asc'] as const;
export type CatalogOrder = (typeof CATALOG_ORDERS)[number];
export const CATALOG_ORDER_LABELS: Record<CatalogOrder, string> = {
  updated_desc: 'Atualizados recentemente', updated_asc: 'Atualizados há mais tempo',
  created_desc: 'Criados recentemente', created_asc: 'Criados há mais tempo',
};

export interface CatalogQuery {
  readonly search: string;
  readonly states: readonly WorkState[];
  readonly pendingOnly: boolean;
  readonly order: CatalogOrder;
  readonly page: number;
  readonly pageSize: number;
}

export type CatalogQueryResult =
  | { readonly ok: true; readonly value: CatalogQuery }
  | { readonly ok: false; readonly code: 'invalid_catalog_query'; readonly message: string };

type ParamSource = URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

function paramValues(source: ParamSource, name: string): string[] {
  if (source instanceof URLSearchParams) return source.getAll(name);
  const value = source[name];
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : [...value];
}

const invalid = (message: string): CatalogQueryResult => ({ ok: false, code: 'invalid_catalog_query', message });
const positiveInt = /^[1-9][0-9]{0,6}$/;

/** Parâmetros públicos (português, na URL): q, estado (repetível ou separado por vírgula), pendentes=1, ordem, pagina, tamanho. */
export function parseCatalogQuery(source: ParamSource): CatalogQueryResult {
  // eslint-disable-next-line no-control-regex
  const rawSearch = (paramValues(source, 'q')[0] ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (rawSearch.length > CATALOG_SEARCH_MAX_LENGTH) return invalid(`A busca aceita até ${CATALOG_SEARCH_MAX_LENGTH} caracteres.`);

  const stateTokens = paramValues(source, 'estado').flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
  const states: WorkState[] = [];
  for (const token of stateTokens) {
    if (!(WORK_STATES as readonly string[]).includes(token)) return invalid(`Estado desconhecido: ${token.slice(0, 40)}.`);
    if (!states.includes(token as WorkState)) states.push(token as WorkState);
  }

  const pending = paramValues(source, 'pendentes')[0];
  if (pending !== undefined && pending !== '' && pending !== '0' && pending !== '1') return invalid('O filtro "pendentes" aceita apenas 1.');

  const order = paramValues(source, 'ordem')[0] ?? 'updated_desc';
  if (!(CATALOG_ORDERS as readonly string[]).includes(order)) return invalid('Ordenação desconhecida.');

  const pageRaw = paramValues(source, 'pagina')[0];
  if (pageRaw !== undefined && !positiveInt.test(pageRaw)) return invalid('A página deve ser um inteiro positivo.');
  const sizeRaw = paramValues(source, 'tamanho')[0];
  if (sizeRaw !== undefined && !positiveInt.test(sizeRaw)) return invalid('O tamanho da página deve ser um inteiro positivo.');
  const pageSize = sizeRaw === undefined ? CATALOG_PAGE_SIZE_DEFAULT : Number(sizeRaw);
  if (pageSize > CATALOG_PAGE_SIZE_MAX) return invalid(`O tamanho máximo da página é ${CATALOG_PAGE_SIZE_MAX}.`);

  return { ok: true, value: {
    search: rawSearch, states, pendingOnly: pending === '1', order: order as CatalogOrder,
    page: pageRaw === undefined ? 1 : Number(pageRaw), pageSize,
  } };
}

/** Monta a URL pública de uma consulta (somente parâmetros diferentes do padrão). */
export function buildCatalogHref(query: CatalogQuery, overrides: Partial<CatalogQuery> = {}): string {
  const next = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (next.search) params.set('q', next.search);
  if (next.states.length) params.set('estado', next.states.join(','));
  if (next.pendingOnly) params.set('pendentes', '1');
  if (next.order !== 'updated_desc') params.set('ordem', next.order);
  if (next.page > 1) params.set('pagina', String(next.page));
  if (next.pageSize !== CATALOG_PAGE_SIZE_DEFAULT) params.set('tamanho', String(next.pageSize));
  const text = params.toString();
  return text ? `/trabalhos?${text}` : '/trabalhos';
}

export interface CatalogRow {
  readonly id: string;
  /** Código legível (ex.: PROOF-01) quando o item tem proveniência canônica ou de investigação. */
  readonly reference: string | null;
  readonly title: string;
  readonly summary: string;
  readonly state: WorkState;
  readonly stateLabel: string;
  readonly proposalVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly needsHuman: boolean;
  readonly humanAction: string | null;
  /** Referência legível + `item` desambigua sucessores que partilham o código; sem código, o UUID. */
  readonly href: string;
}

export interface CatalogPage {
  readonly items: readonly CatalogRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  /** Total GLOBAL (todos os estados e buscas) de itens que aguardam decisão humana. */
  readonly pendingTotal: number;
}

export type CatalogReadResult =
  | { readonly ok: true; readonly value: CatalogPage }
  | { readonly ok: false; readonly code: 'catalog_unavailable'; readonly message: string };

// Interface estrutural mínima do cliente Supabase (permite teste determinístico; o cliente real a satisfaz).
interface CatalogResponse { readonly data: unknown[] | null; readonly count: number | null; readonly error: { readonly message: string; readonly code?: string } | null }
export interface CatalogBuilder extends PromiseLike<CatalogResponse> {
  eq(column: string, value: string): CatalogBuilder;
  in(column: string, values: readonly string[]): CatalogBuilder;
  or(filters: string): CatalogBuilder;
  order(column: string, options: { ascending: boolean }): CatalogBuilder;
  range(from: number, to: number): CatalogBuilder;
}
export interface CatalogClient {
  from(table: 'work_items'): { select(columns: string, options?: { count?: 'exact'; head?: boolean }): CatalogBuilder };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Remove os caracteres que mudam a sintaxe do filtro PostgREST e escapa o curinga `_` do LIKE. `null` quando nada sobra. */
export function sanitizeSearchTerm(search: string): string | null {
  const term = search.replace(/[,()"\\*%:]/g, ' ').replace(/\s+/g, ' ').trim();
  return term ? term.replace(/_/g, '\\_') : null;
}

/** Filtro `or` da busca global: código (canônico ou de investigação), título (objetivo canônico, pergunta, resumo) e UUID exato. */
export function buildSearchFilter(search: string): string | null {
  const term = sanitizeSearchTerm(search);
  if (!term) return null;
  const like = `ilike.*${term}*`;
  const parts = [
    `intent->canonical_provenance->>sourceId.${like}`,
    `intent->canonical_provenance->>canonicalObjective.${like}`,
    `intent->investigation_provenance->>reference.${like}`,
    `intent->>investigation_question.${like}`,
    `proposal->data->>summary.${like}`,
  ];
  if (UUID.test(search.trim())) parts.push(`id.eq.${search.trim().toLowerCase()}`);
  return parts.join(',');
}

const SELECT_COLUMNS = [
  'id', 'state', 'proposal_version', 'created_at', 'updated_at',
  'ref:intent->canonical_provenance->>sourceId',
  'inv_ref:intent->investigation_provenance->>reference',
  'canonical_title:intent->canonical_provenance->>canonicalObjective',
  'question:intent->>investigation_question',
  'summary:proposal->data->>summary',
].join(',');

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

export function mapCatalogRow(raw: unknown): CatalogRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  const state = text(row.state) as WorkState | null;
  if (!id || !state || !(WORK_STATES as readonly string[]).includes(state)) return null;
  const reference = text(row.ref) ?? text(row.inv_ref);
  const summary = text(row.summary) ?? '(sem resumo)';
  const title = text(row.canonical_title) ?? (text(row.question) ? text(row.question)!.slice(0, 160) : summary);
  const needsHuman = isWaitingForUserWorkState(state);
  return {
    id, reference, title, summary, state, stateLabel: WORK_STATE_LABELS[state],
    proposalVersion: typeof row.proposal_version === 'number' ? row.proposal_version : 1,
    createdAt: text(row.created_at) ?? '', updatedAt: text(row.updated_at) ?? '',
    needsHuman, humanAction: needsHuman ? HUMAN_ACTION_LABELS[state] ?? 'Decidir' : null,
    href: reference ? `/trabalhos/${encodeURIComponent(reference)}?item=${id}` : `/trabalhos/${id}`,
  };
}

const unavailable = (message: string): CatalogReadResult => ({ ok: false, code: 'catalog_unavailable', message });

/**
 * Lê UMA página do catálogo. Busca, estado e "pendentes" são filtros do BANCO (globais, nunca só da página).
 * Ordenação estável: coluna temporal escolhida + `id` na mesma direção. A página pedida é limitada ao intervalo real.
 */
export async function readCatalogPage(client: CatalogClient, userId: string, query: CatalogQuery): Promise<CatalogReadResult> {
  const empty = (pendingTotal: number): CatalogReadResult => ({ ok: true, value: { items: [], page: 1, pageSize: query.pageSize, total: 0, totalPages: 0, pendingTotal } });

  const pendingResponse = await client.from('work_items').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).in('state', HUMAN_ATTENTION_STATES);
  if (pendingResponse.error) return unavailable('Não foi possível contar as decisões pendentes.');
  const pendingTotal = pendingResponse.count ?? 0;

  const allowed = query.states.length ? query.states : WORK_STATES;
  const states = query.pendingOnly ? allowed.filter(isWaitingForUserWorkState) : allowed;
  if (states.length === 0) return empty(pendingTotal);

  let searchFilter: string | null = null;
  if (query.search) {
    searchFilter = buildSearchFilter(query.search);
    if (!searchFilter) return empty(pendingTotal);
  }
  const filtered = <T extends CatalogBuilder>(builder: T): CatalogBuilder => {
    const scoped = builder.eq('user_id', userId).in('state', states);
    return searchFilter ? scoped.or(searchFilter) : scoped;
  };

  const countResponse = await filtered(client.from('work_items').select('id', { count: 'exact', head: true }));
  if (countResponse.error) return unavailable('Não foi possível contar os trabalhos.');
  const total = countResponse.count ?? 0;
  if (total === 0) return empty(pendingTotal);

  const totalPages = Math.ceil(total / query.pageSize);
  const page = Math.min(query.page, totalPages);
  const from = (page - 1) * query.pageSize;
  const ascending = query.order.endsWith('_asc');
  const column = query.order.startsWith('created') ? 'created_at' : 'updated_at';
  const rowsResponse = await filtered(client.from('work_items').select(SELECT_COLUMNS))
    .order(column, { ascending }).order('id', { ascending }).range(from, from + query.pageSize - 1);
  if (rowsResponse.error) return unavailable('Não foi possível ler os trabalhos.');

  const items = (rowsResponse.data ?? []).map(mapCatalogRow).filter((row): row is CatalogRow => row !== null);
  return { ok: true, value: { items, page, pageSize: query.pageSize, total, totalPages, pendingTotal } };
}
