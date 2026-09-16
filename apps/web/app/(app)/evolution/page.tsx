import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readCapabilityAssessments } from '@/lib/evolution/capability-assessment-read';
import {
  ANIMA_CAPABILITY_REGISTRY_V0,
  getAnimaCapabilityGraph,
  longestDependencyPath,
  summarizeByDomain,
  summarizeTargetProgress,
} from '@anima/core';
import EvolutionClient, { type EvolutionCapabilityAssessmentState, type EvolutionObjective } from './_components/EvolutionClient';

// Objetivo padrão em foco: o norte do arco de agência.
const FEATURED_TARGET_ID = 'agency.continuous-self-development';

export default async function EvolutionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  /**
   * A leitura dinâmica é advisory/read-only.
   *
   * O mapa declarado continua existindo mesmo quando o histórico não pode ser
   * reconstruído. Falha de telemetria nunca vira rebaixamento implícito.
   */
  const assessmentRead =
    await readCapabilityAssessments(supabase);

  const capabilityAssessment: EvolutionCapabilityAssessmentState =
    assessmentRead.ok
      ? {
          status: 'available',
          eventCount: assessmentRead.eventCount,
          projection: assessmentRead.projection,
        }
      : {
          status: 'unavailable',
          reason: assessmentRead.reason,
        };

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
      capabilityAssessment={capabilityAssessment}
    />
  );
}
