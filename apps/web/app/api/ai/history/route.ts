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

  const { data: session } = await supabase
    .from('conversation_sessions')
    .select('id')
    .eq('user_id', user.id)
    .is('archived_at', null)
    .maybeSingle();
  if (!session) return Response.json([]);

  const { data } = await supabase
    .from('ai_conversations')
    .select('id, role, content')
    .eq('session_id', session.id)
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

  const { error } = await supabase.rpc('archive_current_conversation');
  if (error) return Response.json({ error: 'Não foi possível arquivar a conversa com segurança.' }, { status: 409 });

  return new Response(null, { status: 204 });
}

export async function POST() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autorizado', { status: 401 });
  const { error } = await supabase.rpc('reopen_latest_conversation');
  if (error) return Response.json({ error: error.code === 'P0002' ? 'Nenhuma conversa arquivada para retomar.' : 'Não foi possível retomar a conversa com segurança.' }, { status: error.code === 'P0002' ? 404 : 409 });
  return new Response(null, { status: 204 });
}
