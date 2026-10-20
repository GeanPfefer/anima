import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadWorkDetail } from '@/lib/work-orchestration/work-detail';
import type { WorkPresentationView } from '@/app/(app)/chat/_components/WorkProposalCard';
import { TrabalhoDetalhe } from '../_components/TrabalhoDetalhe';
import { TrabalhoAmbiguo, TrabalhoIndisponivel } from '../_components/TrabalhoStatus';

// /trabalhos/[referencia] — detalhe por código legível (ou UUID). `?item=<uuid>` desambigua sucessores que partilham
// o código. Reutiliza a reconstrução persistida de items/[id] e o WorkProposalCard (mesmas rotas de ação).
export default async function TrabalhoPage({ params, searchParams }: {
  params: Promise<{ referencia: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { referencia } = await params;
  const item = (await searchParams).item;
  const detail = await loadWorkDetail(supabase, decodeURIComponent(referencia), typeof item === 'string' ? item : undefined);

  switch (detail.kind) {
    case 'ok': return <TrabalhoDetalhe initial={detail.presentation as WorkPresentationView} reference={detail.reference} title={detail.title} />;
    case 'ambiguous': return <TrabalhoAmbiguo reference={detail.reference} candidates={detail.candidates} />;
    default: return <TrabalhoIndisponivel kind={detail.kind} />;
  }
}
