import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  ANIMA_CAPABILITY_REGISTRY_V0,
  EVOLUTION_BASELINE,
  getAnimaCapabilityGraph,
  listRecentEvolution,
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
    recentEvolution: listRecentEvolution(ANIMA_CAPABILITY_REGISTRY_V0, EVOLUTION_BASELINE.date),
    evolutionBaseline: { ...EVOLUTION_BASELINE },
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

  test('avaliação dinâmica explica o porquê e mostra as provas decisivas', () => {
    const props = buildProps();

    render(
      <EvolutionClient
        {...props}
        capabilityAssessment={{
          status: 'available',
          eventCount: 7,
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
                    occasionId: 'attempt-xyz',
                    proofRefs: [
                      { kind: 'attempt', ref: 'attempt-xyz' },
                      { kind: 'verifier', ref: 'verifier-1' },
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

    // O "por quê" derivado da prova, em linguagem humana.
    expect(
      screen.getByText(/Comprovada por execução verificada/),
    ).toBeInTheDocument();

    // Provas decisivas tipadas — o "POR CAUSA DESTAS provas".
    expect(screen.getByText('Provas que sustentam este nível')).toBeInTheDocument();
    expect(screen.getByText('ATTEMPT')).toBeInTheDocument();
    expect(screen.getByText('attempt-xyz')).toBeInTheDocument();
    expect(screen.getByText('VERIFIER')).toBeInTheDocument();

    // Próxima prova derivada: reprodução para operacional.
    expect(
      screen.getByText(/Falta reproduzir a execução verificada/),
    ).toBeInTheDocument();
  });

  test('reprodução derivada é apresentada como operacional com contagem de ocasiões', () => {
    const props = buildProps();

    render(
      <EvolutionClient
        {...props}
        capabilityAssessment={{
          status: 'available',
          eventCount: 12,
          projection: {
            issues: [],
            assessments: [
              {
                capabilityId: 'interaction.chat',
                declaredMaturity: 'operational',
                definitionMaturity: 'implemented',
                derivedMaturity: 'operational',
                assessment: {
                  maturity: 'operational',
                  basis: 'reproduced_operation',
                  decisiveEvidenceId: 'evidence-2',
                  supportingEvidenceIds: ['evidence-1', 'evidence-2'],
                  contradictingEvidenceIds: [],
                },
                evidence: [
                  {
                    id: 'evidence-1',
                    capabilityId: 'interaction.chat',
                    evidenceClass: 'verified_execution',
                    outcome: 'positive',
                    observedAt: '2026-09-16T12:00:00.000Z',
                    occasionId: 'attempt-1',
                    proofRefs: [{ kind: 'attempt', ref: 'attempt-1' }],
                  },
                  {
                    id: 'evidence-2',
                    capabilityId: 'interaction.chat',
                    evidenceClass: 'verified_execution',
                    outcome: 'positive',
                    observedAt: '2026-09-16T13:00:00.000Z',
                    occasionId: 'attempt-2',
                    proofRefs: [{ kind: 'attempt', ref: 'attempt-2' }],
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
      screen.getByText('Derivado: Operacional'),
    ).toBeInTheDocument();

    expect(
      screen.getByText(/reproduzida em 2 ocasiões/),
    ).toBeInTheDocument();
  });

  test('capability recém-conectada (self-development supervisionado) mostra linguagem de domínio derivada', () => {
    const props = buildProps();

    render(
      <EvolutionClient
        {...props}
        capabilityAssessment={{
          status: 'available',
          eventCount: 20,
          projection: {
            issues: [],
            assessments: [
              {
                capabilityId: 'agency.supervised-self-development',
                declaredMaturity: 'proven',
                definitionMaturity: 'implemented',
                derivedMaturity: 'operational',
                assessment: {
                  maturity: 'operational',
                  basis: 'reproduced_operation',
                  decisiveEvidenceId: 'sup-2',
                  supportingEvidenceIds: ['sup-1', 'sup-2'],
                  contradictingEvidenceIds: [],
                },
                evidence: [
                  {
                    id: 'sup-1',
                    capabilityId: 'agency.supervised-self-development',
                    evidenceClass: 'verified_execution',
                    outcome: 'positive',
                    observedAt: '2026-09-16T12:00:00.000Z',
                    occasionId: 'attempt-1',
                    proofRefs: [{ kind: 'attempt', ref: 'attempt-1' }],
                  },
                  {
                    id: 'sup-2',
                    capabilityId: 'agency.supervised-self-development',
                    evidenceClass: 'verified_execution',
                    outcome: 'positive',
                    observedAt: '2026-09-16T13:00:00.000Z',
                    occasionId: 'attempt-2',
                    proofRefs: [{ kind: 'attempt', ref: 'attempt-2' }],
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
        name: 'Self-development supervisionado — Comprovada',
      }),
    );

    expect(screen.getByText('Derivado: Operacional')).toBeInTheDocument();
    expect(
      screen.getByText(/self-development supervisionado válido reproduzida em 2 ocasiões/),
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

describe('EvolutionClient (Evolution V2 — reconciliação)', () => {
  test('domínio Pesquisa externa aparece com as capacidades reais do Research Web', () => {
    const { container } = render(<EvolutionClient {...buildProps()} />);
    expect(screen.getByRole('button', { name: /Pesquisa externa/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Busca web — Comprovada · reuso integrado WRAP (SearXNG)' })).toBeInTheDocument();
    expect(container.querySelector('[data-capid="research.web.search"]')?.getAttribute('data-origin')).toBe('integrated');
    expect(container.querySelector('[data-capid="research.web.navigate"]')?.getAttribute('data-future')).toBe('false');
  });

  test('futuro nunca aparece como operacional; candidatas externas ficam no futuro e marcadas', () => {
    const { container } = render(<EvolutionClient {...buildProps()} />);
    for (const id of ['research.web.cite', 'research.web.compare', 'research.web.persist-findings', 'agency.reuse-discovery', 'memory.evolution-history']) {
      const el = container.querySelector(`[data-capid="${id}"]`);
      expect(el?.getAttribute('data-future')).toBe('true');
      expect(el?.getAttribute('aria-label')).not.toMatch(/Operacional/);
    }
    const candidates = container.querySelectorAll('[data-origin="candidate"]');
    expect(candidates.length).toBe(5);
    candidates.forEach((el) => expect(el.getAttribute('data-future')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Continuidade entre harnesses — Projetada (a conquistar) · candidata externa (ai-memory)' })).toBeInTheDocument();
  });

  test('lente Evolução recente destaca só o que foi registrado desde a baseline e lista no painel', () => {
    const { container } = render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Evolução recente/ }));
    expect(stateOf(container, 'research.web.search')).toBe('strong');
    expect(stateOf(container, 'agency.run-tests')).toBe('strong');
    expect(stateOf(container, 'interaction.chat')).toBe('dim');
    const panel = screen.getByText(/Desde Evolution UX V1/).closest('div') as HTMLElement;
    expect(within(panel).getByText(/Baseline 7f276d8/)).toBeInTheDocument();
    // clicar numa entrada seleciona a capacidade
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Executar testes e comandos governados' })[0]!);
    expect(stateOf(container, 'agency.run-tests')).toBe('selected');
  });

  test('lente Reuso externo separa temos × integrado × candidatas', () => {
    const { container } = render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Reuso externo/ }));
    expect(stateOf(container, 'research.web.open')).toBe('strong');
    expect(stateOf(container, 'memory.cross-harness')).toBe('strong');
    expect(stateOf(container, 'governance.review')).toBe('dim');
    expect(screen.getByRole('heading', { name: /Reuso já integrado/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Candidatas externas (5)' })).toBeInTheDocument();
    expect(screen.getByText(/POC externo que funcionou ≠ capacidade do Anima/)).toBeInTheDocument();
  });

  test('painel mostra origem e história tipada da capacidade', () => {
    render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Executar testes e comandos governados — / }));
    expect(screen.getByRole('heading', { name: 'Origem' })).toBeInTheDocument();
    expect(screen.getByText(/Implementação interna registrada; estratégia de reuso não declarada/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'História' })).toBeInTheDocument();
    expect(screen.getAllByText('Maturidade').length).toBeGreaterThan(0);
    expect(screen.getByText(/ATTEMPT 515c4d83/)).toBeInTheDocument();
  });

  test('candidata externa explica que a evidência externa não é prova do Anima', () => {
    render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Disponibilidade de quota de assinatura — / }));
    expect(screen.getByText(/Ainda não é/)).toBeInTheDocument();
    expect(screen.getByText(/Evidência externa .não conta como prova do Anima./)).toBeInTheDocument();
    expect(screen.getByText(/Sem prova declarada/)).toBeInTheDocument();
  });

  test('lente combina com filtro de domínio sem perder o foco por relações', () => {
    const { container } = render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Reuso externo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Pesquisa externa/ }));
    expect(stateOf(container, 'research.web.search')).toBe('strong');
    expect(stateOf(container, 'research.query-privacy')).toBe('dim'); // interna
    fireEvent.click(screen.getByRole('button', { name: /^Busca web — / }));
    expect(stateOf(container, 'research.web.search')).toBe('selected');
    expect(stateOf(container, 'research.query-privacy')).toBe('strong'); // dependência direta
  });
});

// ─── Proof Evaluation V0: declarado × derivado ──────────────────────────────────

describe('EvolutionClient — Proof Evaluation V0 (declarado × derivado)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const core = require('@anima/core') as typeof import('@anima/core');

  const panel = (): HTMLElement => screen.getByTestId('proof-evaluation');

  test('prova registrada: alinhada, fonte híbrida e provas que sustentam', () => {
    render(<EvolutionClient {...buildProps()} proofEvaluations={core.evaluateCapabilityProofsFromHistory({ events: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: /^Busca web — Comprovada/ }));

    expect(panel().getAttribute('data-status')).toBe('aligned');
    expect(within(panel()).getByText('Declarado: Comprovada · Derivado: Comprovada')).toBeInTheDocument();
    expect(within(panel()).getByText(/híbrida/)).toBeInTheDocument();
    // Provas que sustentam o nível derivado (decisivas) vêm da prova registrada.
    expect(screen.getAllByText('docs/registros/2026-09-27b-research-web-v1.md').length).toBeGreaterThan(0);
    expect(screen.getByText('Provas que sustentam este nível')).toBeInTheDocument();
  });

  test('durabilidade: evidência insuficiente, dimensões preservadas e o que falta', () => {
    render(<EvolutionClient {...buildProps()} proofEvaluations={core.evaluateCapabilityProofsFromHistory({ events: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: /^Durabilidade do progresso — Projetada/ }));

    expect(panel().getAttribute('data-status')).toBe('insufficient_evidence');
    expect(within(panel()).getByText('Declarado: Projetada · Derivado: —')).toBeInTheDocument();
    expect(within(panel()).getAllByText('procedimento')).toHaveLength(3);
    expect(within(panel()).getByText(/Durable State/)).toBeInTheDocument();
  });

  test('divergência é exibida sem alterar o estado declarado do nó', () => {
    const evidence = ['a1', 'a2'].map((attempt, i) => ({
      id: `ev-${attempt}`,
      capabilityId: 'compute.external-provider',
      evidenceClass: 'verified_execution' as const,
      outcome: 'positive' as const,
      observedAt: `2026-09-2${i}T10:00:00Z`,
      occasionId: attempt,
      proofRefs: [{ kind: 'attempt' as const, ref: attempt }],
    }));
    render(<EvolutionClient {...buildProps()} proofEvaluations={core.evaluateCapabilityProofs({ evidence })} />);
    // O derivado nunca reescreve o declarado: o nó continua "Comprovada".
    fireEvent.click(screen.getByRole('button', { name: 'Provider externo — Comprovada' }));

    // V0.1: reprodução observada não satisfaz operacional para o provider —
    // alinhada, nunca "subdeclarada".
    expect(panel().getAttribute('data-status')).toBe('aligned');
    expect(within(panel()).queryByText(/evidência sustenta mais que o declarado/)).not.toBeInTheDocument();
    expect(within(panel()).getByText('Declarado: Comprovada · Derivado: Comprovada')).toBeInTheDocument();
    expect(screen.getByTestId('proof-reproduction').textContent).toBe(
      'Reprodução: observada (2 ocasiões) · Critérios de operacional: pendentes',
    );
  });

  test('divergência real continua exibida (declarado acima da evidência)', () => {
    const evidence = [
      {
        id: 'impl',
        capabilityId: 'compute.external-provider',
        evidenceClass: 'implementation' as const,
        outcome: 'positive' as const,
        observedAt: '2026-09-20T10:00:00Z',
        proofRefs: [{ kind: 'commit' as const, ref: 'abc' }],
      },
    ];
    render(<EvolutionClient {...buildProps()} proofEvaluations={core.evaluateCapabilityProofs({ evidence })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Provider externo — Comprovada' }));

    expect(panel().getAttribute('data-status')).toBe('overclaimed');
    expect(within(panel()).getByText(/declarado acima da evidência/)).toBeInTheDocument();
    expect(screen.queryByTestId('proof-reproduction')).not.toBeInTheDocument();
  });

  test('reprodução que satisfaz operacional (run-tests) aparece como satisfeita', () => {
    const evidence = ['a1', 'a2'].map((attempt, i) => ({
      id: `rt-${attempt}`,
      capabilityId: 'agency.run-tests',
      evidenceClass: 'verified_execution' as const,
      outcome: 'positive' as const,
      observedAt: `2026-09-2${i}T10:00:00Z`,
      occasionId: attempt,
      proofRefs: [{ kind: 'attempt' as const, ref: attempt }],
    }));
    render(<EvolutionClient {...buildProps()} proofEvaluations={core.evaluateCapabilityProofs({ evidence })} />);
    fireEvent.click(screen.getByRole('button', { name: /^Executar testes e comandos governados — / }));

    expect(panel().getAttribute('data-status')).toBe('aligned');
    expect(screen.getByTestId('proof-reproduction').textContent).toMatch(/satisfeitos$/);
  });

  test('capacidade sem regra: não avaliada, maturidade manual', () => {
    render(<EvolutionClient {...buildProps()} proofEvaluations={core.evaluateCapabilityProofsFromHistory({ events: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat — Operacional' }));

    expect(panel().getAttribute('data-status')).toBe('not_evaluated');
    expect(within(panel()).getByText('Não avaliada pelo motor')).toBeInTheDocument();
    expect(within(panel()).getByText(/manual \(registry\)/)).toBeInTheDocument();
  });
});

describe('EvolutionClient — Autonomy Readiness V0 (maturidade ≠ readiness ≠ authority)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const core = require('@anima/core') as typeof import('@anima/core');

  const evidenceFor = (capabilityId: string) =>
    ['a1', 'a2', 'a3'].map((attempt, i) => ({
      id: `${capabilityId}-${attempt}`,
      capabilityId,
      evidenceClass: 'verified_execution' as const,
      outcome: 'positive' as const,
      observedAt: `2026-09-2${i}T10:00:00Z`,
      occasionId: attempt,
      proofRefs: [{ kind: 'attempt' as const, ref: attempt }],
    }));

  const renderWith = (capabilityIds: string[]) => {
    const evaluations = core.evaluateCapabilityProofs({ evidence: capabilityIds.flatMap(evidenceFor) });
    render(
      <EvolutionClient
        {...buildProps()}
        proofEvaluations={evaluations}
        autonomyReadiness={core.evaluateReferenceAutonomyReadiness(evaluations)}
      />,
    );
  };

  test('run-tests operacional: sob mandato, authority não concedida, autonomia bloqueada', () => {
    renderWith(['agency.run-tests']);
    fireEvent.click(screen.getByRole('button', { name: /^Executar testes e comandos governados — / }));

    const panel = screen.getByTestId('autonomy-readiness');
    expect(panel.getAttribute('data-level')).toBe('mandated');
    expect(within(panel).getByText('Prontidão para delegar: Sob mandato')).toBeInTheDocument();
    expect(screen.getByTestId('autonomy-authority').textContent).toMatch(/tratada como Manual/);
    expect(within(panel).getByText('boundary de rede não provado')).toBeInTheDocument();
  });

  test('produce-change comprovada: supervisionada, mandato bloqueado por critério operacional', () => {
    renderWith(['agency.produce-change']);
    fireEvent.click(screen.getByRole('button', { name: /^Produzir alteração de código — / }));

    const panel = screen.getByTestId('autonomy-readiness');
    expect(panel.getAttribute('data-level')).toBe('supervised');
    expect(within(panel).getByText('critérios de operacional pendentes')).toBeInTheDocument();
  });

  test('capacidade fora do recorte não mostra bloco de readiness', () => {
    renderWith([]);
    fireEvent.click(screen.getByRole('button', { name: 'Chat — Operacional' }));
    expect(screen.queryByTestId('autonomy-readiness')).not.toBeInTheDocument();
  });
});

describe('Evolution UX V2 — Akita e reuso', () => {
  test('baseline é objetivo selecionável e sequência clicável derivada do registry', () => {
    render(<EvolutionClient {...buildProps()} featuredTargetId="agency.akita-baseline-v1" />);
    expect(screen.getByRole('combobox', { name: 'Escolher objetivo futuro' })).toHaveValue('agency.akita-baseline-v1');
    expect(screen.getByRole('list', { name: 'Sequência planejada do objetivo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Codex CLI executor ANIMA/ }));
    expect(screen.getByRole('heading', { name: 'Codex CLI executor' })).toBeInTheDocument();
    expect(screen.getByText(/Maturidade: Projetada · Estratégia: WRAP/)).toBeInTheDocument();
    expect(screen.getAllByText(/primeira prova viva técnica PASS/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/governed proof not yet demonstrated/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Reuso integrado/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/external candidate exists/)).not.toBeInTheDocument();
    expect(screen.getByText(/Decisão arquitetural ≠ integração ≠ prova ≠ maturidade/)).toBeInTheDocument();
  });
  test('lentes separam responsabilidade e direção sem recolorir maturidade', () => {
    const { container } = render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Baseline reutilizado' }));
    expect(stateOf(container, 'agency.codex-cli')).toBe('strong');
    expect(stateOf(container, 'governance.authority')).toBe('dim');
    fireEvent.click(screen.getByRole('button', { name: 'Anima control plane' }));
    expect(stateOf(container, 'governance.authority')).toBe('strong');
    expect(stateOf(container, 'agency.codex-cli')).toBe('dim');
    fireEvent.click(screen.getByRole('button', { name: 'Direção atual' }));
    const experimental = container.querySelector('[data-capid="agency.deepseek-harness"]');
    expect(experimental).toHaveAttribute('data-direction', 'experimental');
    expect(experimental).toHaveAttribute('data-future', 'false');
    expect(experimental).toHaveAttribute('aria-label', expect.stringContaining('Comprovada'));
    expect(container.querySelector('[data-capid="agency.codex-cli"]')).toHaveAttribute('data-future', 'true');
  });
});

test.each(['adopt', 'wrap', 'fork', 'build', 'undecided'] as const)('painel expõe estratégia %s do domínio sem inferir maturidade', (strategy) => {
  const props = buildProps();
  props.nodes = props.nodes.map((node) => node.capability.id === 'agency.codex-cli' ? { ...node, capability: { ...node.capability, reuse: { ...node.capability.reuse!, strategy } } } : node);
  const { container } = render(<EvolutionClient {...props} />);
  fireEvent.click(container.querySelector('[data-capid="agency.codex-cli"]')!);
  const panel = screen.getByRole('region', { name: 'Direção e estratégia' });
  expect(within(panel).getByText(new RegExp(`Maturidade: Projetada · Estratégia: ${strategy === 'undecided' ? 'A DECIDIR' : strategy.toUpperCase()}`))).toBeInTheDocument();
  if (strategy === 'build') expect(within(panel).getByText(/BUILD escolhido/)).toBeInTheDocument();
  if (strategy === 'undecided') expect(within(panel).getByText(/reuse decision missing/)).toBeInTheDocument();
});

test('baseline exibe PASS técnico com integração enquanto Claude e memória permanecem NEXT', () => {
  const { container } = render(<EvolutionClient {...buildProps()} />);
  const path = screen.getByRole('region', { name: 'Current development path' });
  expect(within(path).getByRole('button', { name: /Codex CLI executor.*adapter integrado.*prova técnica viva PASS.*não governada/ })).toBeInTheDocument();
  expect(within(path).getByRole('button', { name: /Claude Code executor.*NEXT.*candidata/ })).toBeInTheDocument();
  expect(within(path).getByRole('button', { name: /Continuidade entre harnesses.*após os executores.*NEXT/ })).toBeInTheDocument();
  const codex = container.querySelector('[data-capid="agency.codex-cli"]');
  expect(codex).toHaveAttribute('data-origin', 'integrated');
  expect(codex).toHaveAttribute('data-future', 'true');
  fireEvent.click(codex!);
  expect(screen.getByRole('region', { name: 'Evidência registrada de escopo limitado' })).toBeInTheDocument();
  expect(screen.getByText(/sem prova de maturidade creditada pelo motor/)).toBeInTheDocument();
  expect(screen.getByText(/Prova governada ainda não demonstrada/)).toBeInTheDocument();
});
