import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autorizado', { status: 401 });

  const { data } = await supabase
    .from('ai_conversations')
    .select('id, role, content')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(100);

  return Response.json(data ?? []);
}

export async function DELETE() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autorizado', { status: 401 });

  const { count } = await supabase.from('work_items').select('*', { count: 'exact', head: true });
  if ((count ?? 0) > 0) return Response.json({ error: 'Este histórico contém propostas de trabalho e não pode ser apagado. O arquivamento será disponibilizado em uma etapa futura.' }, { status: 409 });

  const { error } = await supabase.from('ai_conversations').delete().eq('user_id', user.id);
  if (error) return Response.json({ error: 'Não foi possível limpar o histórico com segurança.' }, { status: 409 });

  return new Response(null, { status: 204 });
}
