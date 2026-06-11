import { NextRequest, NextResponse } from 'next/server';
import { linkPillar } from '@/lib/link-pillar';

export async function POST(req: NextRequest) {
  const { childId, parentId, parentName } = await req.json() as {
    childId?: string; parentId?: string | null; parentName?: string | null;
  };
  if (!childId) return NextResponse.json({ error: 'childId obrigatório' }, { status: 400 });

  const result = await linkPillar({ childId, parentId, parentName });
  if (!result.ok) {
    const status = result.reason === 'cycle' || result.reason === 'self' ? 400
                 : result.reason === 'not_found' ? 404
                 : 500;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json(result);
}
