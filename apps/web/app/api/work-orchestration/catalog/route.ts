import { createClient } from '@/lib/supabase/server';
import { parseCatalogQuery, readCatalogPage, type CatalogClient } from '@/lib/work-orchestration/work-catalog';

// UX-TRABALHOS — catálogo LEVE e paginado dos trabalhos do usuário autenticado (todos os estados, busca global).
// Somente leitura: não reconstrói eventos nem concede nenhuma ação (as decisões continuam nas rotas atuais).
// Isolamento: RLS do usuário + filtro explícito de user_id.
export async function GET(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const query = parseCatalogQuery(new URL(request.url).searchParams);
  if (!query.ok) return Response.json({ ok: false, error: { code: query.code, message: query.message } }, { status: 400 });
  const page = await readCatalogPage(client as unknown as CatalogClient, user.id, query.value);
  if (!page.ok) return Response.json({ ok: false, error: { code: page.code, message: page.message } }, { status: 503 });
  return Response.json({ ok: true, value: page.value });
}
