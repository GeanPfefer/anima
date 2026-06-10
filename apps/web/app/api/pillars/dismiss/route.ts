import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const { pillarId } = await req.json() as { pillarId: string };
  if (!pillarId) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });

  const { error } = await supabase
    .from('user_pillars')
    .delete()
    .eq('id', pillarId)
    .eq('user_id', user.id)
    .eq('status', 'pending');

  if (error) return NextResponse.json({ error: 'Erro ao remover pilar' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
