import { NextRequest, NextResponse } from 'next/server';
import { unlinkPillar } from '@/lib/link-pillar';

export async function POST(req: NextRequest) {
  const { childId } = await req.json() as { childId?: string };
  if (!childId) return NextResponse.json({ error: 'childId obrigatório' }, { status: 400 });

  const ok = await unlinkPillar(childId);
  if (!ok) return NextResponse.json({ error: 'Erro ao remover vínculo' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
