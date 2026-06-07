import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autorizado', { status: 401 });

  const { insightId } = await req.json() as { insightId?: string };
  if (!insightId) return new Response('ID obrigatório', { status: 400 });

  await supabase
    .from('insights')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', insightId)
    .eq('user_id', user.id);

  return new Response('OK', { status: 200 });
}
