import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

type DisplayMode = 'game' | 'analytical' | 'minimal';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const { mode } = await req.json() as { mode: DisplayMode };
  if (!['game', 'analytical', 'minimal'].includes(mode)) {
    return NextResponse.json({ error: 'Modo inválido' }, { status: 400 });
  }

  const { error } = await supabase
    .from('profiles')
    .update({ display_mode: mode })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: 'Erro ao salvar' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
