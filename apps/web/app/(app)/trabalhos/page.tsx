import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { parseCatalogQuery, readCatalogPage, type CatalogClient, type CatalogQuery } from '@/lib/work-orchestration/work-catalog';
import { TrabalhosCatalog, type CatalogViewResult } from './_components/TrabalhosCatalog';

const DEFAULT_QUERY: CatalogQuery = { search: '', states: [], pendingOnly: false, order: 'updated_desc', page: 1, pageSize: 25 };

// /trabalhos — gestão de trabalhos fora da conversa. A URL é o estado (busca, filtros, ordem, página); a leitura é
// leve e global (banco), isolada por RLS + user_id. Somente leitura: as decisões acontecem no detalhe.
export default async function TrabalhosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const parsed = parseCatalogQuery(await searchParams);
  const query = parsed.ok ? parsed.value : DEFAULT_QUERY;
  const result: CatalogViewResult = parsed.ok
    ? await readCatalogPage(supabase as unknown as CatalogClient, user.id, parsed.value)
    : parsed;
  return <TrabalhosCatalog query={query} result={result} />;
}
