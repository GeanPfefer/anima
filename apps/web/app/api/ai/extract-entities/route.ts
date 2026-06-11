// Camada 3 — extração de entidades semânticas (wrapper HTTP).
// A lógica vive em lib/extract-entities; o chat chama o lib direto.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { extractEntities } from '@/lib/extract-entities';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autorizado', { status: 401 });

  const { note, recordId } = await req.json() as { note?: string; recordId?: string };
  if (!note || !recordId) return new Response('OK', { status: 200 });

  await extractEntities(supabase, user.id, note, recordId).catch(() => {});
  return new Response('OK', { status: 200 });
}
