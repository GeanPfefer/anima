import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  ANIMA_CAPABILITY_REGISTRY_V0,
  getAnimaCapabilityGraph,
  longestDependencyPath,
  summarizeByDomain,
  summarizeTargetProgress,
} from '@anima/core';
import EvolutionClient from './_components/EvolutionClient';

// Capacidade futura em foco: o norte do arco de agência. A tela abre nela para
// que o caminho presente → futuro (item 8) seja imediatamente visível.
const FEATURED_TARGET_ID = 'agency.continuous-self-development';

export default async function EvolutionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // O grafo é uma projeção do modelo explícito de capacidades (packages/core),
  // não uma tela hardcoded. Construímos no servidor e passamos dados planos e
  // serializáveis ao client (nada de Map atravessa a fronteira RSC).
  const graph = getAnimaCapabilityGraph();

  return (
    <EvolutionClient
      nodes={graph.nodes}
      domainSummaries={summarizeByDomain(ANIMA_CAPABILITY_REGISTRY_V0)}
      featuredTargetId={FEATURED_TARGET_ID}
      featuredProgress={summarizeTargetProgress(graph, FEATURED_TARGET_ID)}
      featuredPath={longestDependencyPath(graph, FEATURED_TARGET_ID) ?? []}
    />
  );
}
