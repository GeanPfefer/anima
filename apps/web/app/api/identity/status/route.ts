import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const VALID = new Set(['pending', 'confirmed', 'rejected']);

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'não autorizado' }, { status: 401 });

  const { id, status } = await req.json() as { id?: string; status?: string };
  if (!id || !status || !VALID.has(status)) {
    return NextResponse.json({ error: 'parâmetros inválidos' }, { status: 400 });
  }

  const { error } = await supabase
    .from('identity_hypotheses')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: 'erro ao atualizar' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
