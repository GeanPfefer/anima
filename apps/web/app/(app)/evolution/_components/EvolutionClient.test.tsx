import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  ANIMA_CAPABILITY_REGISTRY_V0,
  getAnimaCapabilityGraph,
  longestDependencyPath,
  summarizeByDomain,
  summarizeTargetProgress,
} from '@anima/core';
import EvolutionClient, { type EvolutionClientProps, type EvolutionObjective } from './EvolutionClient';

const FEATURED = 'agency.continuous-self-development';

function buildProps(): EvolutionClientProps {
  const graph = getAnimaCapabilityGraph();
  const objectives: EvolutionObjective[] = ANIMA_CAPABILITY_REGISTRY_V0.filter((c) => c.target)
    .map((c) => ({
      id: c.id,
      name: c.name,
      progress: summarizeTargetProgress(graph, c.id),
      path: longestDependencyPath(graph, c.id) ?? [],
    }))
    .sort((a, b) => (a.id === FEATURED ? -1 : b.id === FEATURED ? 1 : 0));
  return {
    nodes: graph.nodes,
    domainSummaries: summarizeByDomain(ANIMA_CAPABILITY_REGISTRY_V0),
    objectives,
    featuredTargetId: FEATURED,
    capabilityAssessment: {
      status: 'available',
      eventCount: 0,
      projection: {
        assessments: [],
        issues: [],
      },
    },
  };
}

const stateOf = (container: HTMLElement, id: string): string | null =>
  container.querySelector(`[data-capid="${id}"]`)?.getAttribute('data-state') ?? null;

describe('EvolutionClient (Evolution UX V1)', () => {
  test('projeta o modelo: título, domínios como filtros e capacidades como nós', () => {
    render(<EvolutionClient {...buildProps()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Mapa de Evolução do Anima' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Compreensão/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agência/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chat — Operacional' })).toBeInTheDocument();
  });

  test('viewport tem controles e o zoom altera a transformação do mapa', () => {
    const { getByTestId } = render(<EvolutionClient {...buildProps()} />);
    const canvas = getByTestId('map-canvas');
    expect(canvas.getAttribute('transform')).toContain('scale(1)');
    fireEvent.click(screen.getByRole('button', { name: 'Aproximar' }));
    expect(canvas.getAttribute('transform')).toContain('scale(1.2');
    fireEvent.click(screen.getByRole('button', { name: 'Resetar visão' }));
    expect(canvas.getAttribute('transform')).toContain('scale(1)');
    expect(screen.getByRole('button', { name: 'Ajustar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Afastar' })).toBeInTheDocument();
  });

  test('selecionar uma capacidade foca sua cadeia e atenua o resto', () => {
    const { container } = render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat — Operacional' }));
    // selecionada
    expect(stateOf(container, 'interaction.chat')).toBe('selected');
    // dependência direta em destaque
    expect(stateOf(container, 'memory.persistence')).toBe('strong');
    // capacidade fora da cadeia é atenuada
    expect(stateOf(container, 'compute.cloud-self-hosted')).toBe('dim');
  });

  test('filtro por domínio destaca o domínio e atenua os demais', () => {
    const { container } = render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Compreensão/ }));
    expect(stateOf(container, 'understanding.entities')).toBe('strong');
    expect(stateOf(container, 'interaction.chat')).toBe('dim');
  });

  test('presente e futuro são distinguíveis por mais de um sinal', () => {
    const { container } = render(<EvolutionClient {...buildProps()} />);
    const future = container.querySelector('[data-capid="agency.continuous-self-development"]');
    const present = container.querySelector('[data-capid="interaction.chat"]');
    // sinal 1: atributo; sinal 2: rótulo acessível textual
    expect(future?.getAttribute('data-future')).toBe('true');
    expect(future?.getAttribute('aria-label')).toContain('(a conquistar)');
    expect(present?.getAttribute('data-future')).toBe('false');
    expect(present?.getAttribute('aria-label')).not.toContain('(a conquistar)');
  });

  test('objetivo em foco mostra distância factual e um caminho relevante (não único)', () => {
    const { container } = render(<EvolutionClient {...buildProps()} />);
    expect(screen.getByText('Objetivo em foco')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Self-development contínuo' })).toBeInTheDocument();
    expect(screen.getByText(/capacidades\s+necessárias já existem/)).toBeInTheDocument();
    expect(screen.getByText(/não de uma única sequência/)).toBeInTheDocument();
    // o alvo aparece no caminho em foco
    expect(stateOf(container, FEATURED)).toBe('path');
  });

  test('trocar o objetivo recalcula o painel a partir do grafo', () => {
    render(<EvolutionClient {...buildProps()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Escolher objetivo futuro' }), {
      target: { value: 'understanding.world-model' },
    });
    expect(screen.getByRole('heading', { name: 'World model' })).toBeInTheDocument();
  });

  test('linguagem de produto: painel usa Capacidade e Provas (não "node"/"Evidências")', () => {
    render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Self-development supervisionado — Comprovada' }));
    expect(screen.getByText(/Capacidade selecionada/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Provas' })).toBeInTheDocument();
    expect(screen.queryByText(/evidências/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bnode\b/i)).not.toBeInTheDocument();
  });

  test('provas aparecem tipadas e a auditoria corrige work_item vs attempt', () => {
    render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Self-development supervisionado — Comprovada' }));
    const provas = screen.getByRole('heading', { name: 'Provas' }).parentElement as HTMLElement;
    // 8a2515d8 é WORK ITEM (tem lineage/sucessores), não attempt.
    expect(within(provas).getByText('WORK ITEM')).toBeInTheDocument();
    expect(within(provas).getByText('8a2515d8')).toBeInTheDocument();
    expect(within(provas).queryByText('ATTEMPT')).not.toBeInTheDocument();
  });

  test('navegação por dependência troca a capacidade selecionada', () => {
    render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat — Operacional' }));
    fireEvent.click(screen.getByRole('button', { name: 'Persistência' }));
    expect(screen.getByRole('heading', { name: 'Persistência' })).toBeInTheDocument();
  });

  test('não inventa porcentagem global de conclusão', () => {
    render(<EvolutionClient {...buildProps()} />);
    expect(screen.queryByText(/\d+\s*%\s*completo/i)).not.toBeInTheDocument();
    expect(screen.getByText(/não existe base semântica/i)).toBeInTheDocument();
  });

  test('mostra declarado, base e derivado sem substituir o maturity do nó', () => {
    const props = buildProps();

    render(
      <EvolutionClient
        {...props}
        capabilityAssessment={{
          status: 'available',
          eventCount: 42,
          projection: {
            issues: [],
            assessments: [
              {
                capabilityId: 'interaction.chat',
                declaredMaturity: 'operational',
                definitionMaturity: 'implemented',
                derivedMaturity: 'proven',
                assessment: {
                  maturity: 'proven',
                  basis: 'verified_execution',
                  decisiveEvidenceId: 'evidence-1',
                  supportingEvidenceIds: ['evidence-1'],
                  contradictingEvidenceIds: [],
                },
                evidence: [
                  {
                    id: 'evidence-1',
                    capabilityId: 'interaction.chat',
                    evidenceClass: 'verified_execution',
                    outcome: 'positive',
                    observedAt: '2026-09-16T12:00:00.000Z',
                    proofRefs: [
                      {
                        kind: 'event',
                        ref: 'event-1',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Chat — Operacional',
      }),
    );

    expect(
      screen.getByText('Avaliação dinâmica'),
    ).toBeInTheDocument();

    expect(
      screen.getByText('Declarado: Operacional'),
    ).toBeInTheDocument();

    expect(
      screen.getByText('Base: Implementada'),
    ).toBeInTheDocument();

    expect(
      screen.getByText('Derivado: Comprovada'),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        'Evidências usadas: 1 · eventos lidos: 42. O derivado não substitui o estado declarado.',
      ),
    ).toBeInTheDocument();

    // A maturity canônica do node NÃO foi reescrita.
    /**
     * O assessment derivado não reescreve a maturity canônica do node:
     * o botão/nó continua Operational e o significado do badge declarado
     * continua sendo o original.
     */
    expect(
      screen.getByRole('button', {
        name: 'Chat — Operacional',
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        '— comprovada de maneira confiável',
      ),
    ).toBeInTheDocument();
  });

  test('ausência de assessment dinâmico não é apresentada como rebaixamento', () => {
    render(
      <EvolutionClient {...buildProps()} />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Chat — Operacional',
      }),
    );

    expect(
      screen.getByText(
        'Sem avaliação dinâmica para esta capacidade — ausência de telemetria não implica rebaixamento.',
      ),
    ).toBeInTheDocument();
  });

  test('histórico inválido preserva o mapa declarado e informa indisponibilidade', () => {
    const props = buildProps();

    render(
      <EvolutionClient
        {...props}
        capabilityAssessment={{
          status: 'unavailable',
          reason: 'event_history_invalid',
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Chat — Operacional',
      }),
    );

    expect(
      screen.getByText(
        'Indisponível: o histórico de evidências está inconsistente. O estado declarado continua visível sem inferência dinâmica.',
      ),
    ).toBeInTheDocument();

    /**
     * O assessment derivado não reescreve a maturity canônica do node:
     * o botão/nó continua Operational e o significado do badge declarado
     * continua sendo o original.
     */
    expect(
      screen.getByRole('button', {
        name: 'Chat — Operacional',
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        '— comprovada de maneira confiável',
      ),
    ).toBeInTheDocument();
  });
});
