import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  ANIMA_CAPABILITY_REGISTRY_V0,
  getAnimaCapabilityGraph,
  longestDependencyPath,
  summarizeByDomain,
  summarizeTargetProgress,
} from '@anima/core';
import EvolutionClient, { type EvolutionObjective } from './_components/EvolutionClient';

// Objetivo padrão em foco: o norte do arco de agência.
const FEATURED_TARGET_ID = 'agency.continuous-self-development';

export default async function EvolutionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // O grafo é uma projeção do modelo explícito de capacidades (packages/core),
  // não uma tela hardcoded. Tudo é construído no servidor e passado como dados
  // planos e serializáveis ao client (nenhum Map atravessa a fronteira RSC).
  const graph = getAnimaCapabilityGraph();

  // Objetivos = capacidades que declaram um alvo futuro. Data-driven: nada é
  // inventado só para preencher o seletor. Para cada uma, a distância estrutural
  // factual e um caminho relevante (não "a única sequência").
  const objectives: EvolutionObjective[] = ANIMA_CAPABILITY_REGISTRY_V0.filter((c) => c.target)
    .map((c) => ({
      id: c.id,
      name: c.name,
      progress: summarizeTargetProgress(graph, c.id),
      path: longestDependencyPath(graph, c.id) ?? [],
    }))
    .sort((a, b) => {
      if (a.id === FEATURED_TARGET_ID) return -1;
      if (b.id === FEATURED_TARGET_ID) return 1;
      return a.progress.specified + a.progress.projected - (b.progress.specified + b.progress.projected);
    });

  return (
    <EvolutionClient
      nodes={graph.nodes}
      domainSummaries={summarizeByDomain(ANIMA_CAPABILITY_REGISTRY_V0)}
      objectives={objectives}
      featuredTargetId={FEATURED_TARGET_ID}
    />
  );
}
