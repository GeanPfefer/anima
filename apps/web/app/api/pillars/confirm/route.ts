import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { logActivity } from '@/lib/log-activity';
import { linkPillar } from '@/lib/link-pillar';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const { pillarId, name, parentId } = await req.json() as { pillarId: string; name: string; parentId?: string };
  if (!pillarId || !name?.trim()) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }

  // Busca o pilar pendente e seus dados de atividade
  const { data: pillar } = await supabase
    .from('user_pillars')
    .select('id, pending_activity')
    .eq('id', pillarId)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .maybeSingle();

  if (!pillar) {
    return NextResponse.json({ error: 'Pilar não encontrado' }, { status: 404 });
  }

  // Ativa o pilar com o nome confirmado (pode ter sido editado pelo usuário)
  const { error: updateError } = await supabase
    .from('user_pillars')
    .update({
      is_active: true,
      status:    'active',
      name:      name.trim().slice(0, 20),
    })
    .eq('id', pillarId)
    .eq('user_id', user.id);

  if (updateError) {
    return NextResponse.json({ error: 'Erro ao ativar pilar' }, { status: 500 });
  }

  // Aplica o XP da atividade original se houver dados pendentes
  const pa = pillar.pending_activity as { durationMinutes?: number; note?: string } | null;
  if (pa && (pa.durationMinutes ?? 0) > 0) {
    await logActivity({
      pillarId:        pillarId,
      durationMinutes: pa.durationMinutes!,
      note:            pa.note ?? '',
    }).catch(() => {});
  }

  // Aninha sob o pai escolhido, se houver
  if (parentId) {
    await linkPillar({ childId: pillarId, parentId }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
