/** @jest-environment jsdom */
import { readFileSync } from 'fs';
import { join } from 'path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  computeAutonomyEvidence,
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

function evidence() {
  const summary = computeAutonomyEvidence({ events: [], items: [], leases: [], now: new Date('2026-10-14T00:00:00Z') });
  summary.limitations = [];
  summary.verdict = 'unknown';
  return summary;
}

function show(summary = evidence()) {
  return render(<EvolutionClient {...buildProps()} autonomyEvidence={{ status: 'available', summary }} />);
}

const panel = () => screen.getByTestId('autonomy-evidence');
const explanation = () => screen.getByTestId('autonomy-evidence-explanation');
const figures = () => screen.getByTestId('autonomy-evidence-figures');

describe('Resumo da dependência humana', () => {
  test('exibe manchete exata com zero em destaque', () => {
    show();
    expect(screen.getByTestId('autonomy-evidence-headline').textContent).toBe('Ciclos sem intervenção humana comprovados: 0.');
    expect(within(screen.getByTestId('autonomy-evidence-headline')).getByText('0').tagName).toBe('STRONG');
  });

  test('explica ausência de prova e acrescenta motivo do modo ausente', () => {
    const summary = evidence();
    const { rerender } = show(summary);
    const base = 'Sem evidência positiva de execução autônoma. Isso não significa que nenhum ciclo ocorreu.';
    expect(explanation().textContent).toBe(base);
    summary.limitations = ['execution_mode_fact_absent'];
    rerender(<EvolutionClient {...buildProps()} autonomyEvidence={{ status: 'available', summary }} />);
    expect(explanation().textContent).toBe(base + ' Motivo: o host ainda não registra o modo de execução.');
  });

  test('preserva a negação sem alegar operação autônoma', () => {
    show();
    const text = panel().textContent ?? '';
    expect(text.replace('Isso não significa que nenhum ciclo ocorreu.', '')).not.toContain('nenhum ciclo ocorreu');
    expect(text).not.toMatch(/\bautônomo\b|operação autônoma|é autônoma/i);
  });

  test('mostra prova positiva até revisão mantendo aceite humano', () => {
    const summary = evidence();
    summary.unattendedVerifiedUntilReview = 3;
    show(summary);
    expect(explanation().textContent).toBe('Há evidência positiva de execução sem humano até review em 3 ciclo(s); o aceite continua humano.');
  });

  test('avisa quando o histórico é insuficiente', () => {
    const summary = evidence();
    summary.verdict = 'insufficient_evidence';
    show(summary);
    expect(explanation()).toHaveTextContent('Evidência insuficiente para avaliar (histórico ou leases indisponíveis).');
  });

  test('ocupa o primeiro elemento do painel padrão', () => {
    const { container } = show();
    expect(container.querySelector('aside')?.firstElementChild).toBe(panel());
    expect(screen.getAllByTestId('autonomy-evidence')).toHaveLength(1);
  });

  test('permanece no topo nas três lentes auxiliares', () => {
    const { container } = show();
    for (const name of ['Evolução recente', 'Reuso externo', 'Fronteira e humano']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
      expect(container.querySelector('aside')?.firstElementChild).toBe(panel());
      expect(screen.getAllByTestId('autonomy-evidence')).toHaveLength(1);
    }
  });

  test('mantém capacidade selecionada ao expandir os detalhes', () => {
    const { container } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Chat — Operacional' }));
    const node = container.querySelector('[data-capid="interaction.chat"]');
    expect(node).toHaveAttribute('data-state', 'selected');
    expect(container.querySelector('aside')?.firstElementChild).toBe(panel());
    fireEvent.click(screen.getByText('Ver detalhes (14 dias e histórico completo)'));
    expect(screen.getByTestId('autonomy-evidence-details')).toHaveAttribute('open');
    expect(node).toHaveAttribute('data-state', 'selected');
    expect(screen.getByText(/Capacidade selecionada/)).toBeInTheDocument();
  });

  test('formata média histórica com vírgula e inteiros sem casas', () => {
    const summary = evidence();
    summary.windows[0].humanActsPerCompleted = { mean: 9.99, min: 1, max: 10, total: 20 };
    summary.windows[1].humanActsPerCompleted = { mean: 2.78, min: 1, max: 4, total: 25 };
    summary.windows[1].completedItems = 9;
    summary.windows[1].completedWithLease = 4;
    show(summary);
    expect(figures().textContent).toBe('2,78 atos humanos por item concluído (histórico) · 9 concluídos · 4 com lease E0');
    expect(panel()).not.toHaveTextContent('2.78');
    expect(within(figures()).getByText('9').tagName).toBe('STRONG');
  });

  test('apresenta sem dados para média histórica ausente', () => {
    show();
    expect(figures()).toHaveTextContent('sem dados atos humanos por item concluído');
  });

  test('traduz classes e tentativas para português', () => {
    show();
    expect(panel().textContent).not.toMatch(/unattended|Attempts/);
    expect(panel()).toHaveTextContent('sem humano comprovado');
    expect(panel()).toHaveTextContent('humano observado');
    expect(panel()).toHaveTextContent('desconhecido');
    expect(panel()).toHaveTextContent('evidência insuficiente');
    expect(panel()).toHaveTextContent('Tentativas:');
  });

  test('inicia detalhes fechados com ambas as janelas e limitações', () => {
    const summary = evidence();
    summary.limitations = ['execution_mode_fact_absent'];
    show(summary);
    const details = screen.getByTestId('autonomy-evidence-details');
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByTestId('autonomy-evidence-window-last_14_days')).toBeInTheDocument();
    expect(within(details).getByTestId('autonomy-evidence-window-all_time')).toBeInTheDocument();
    expect(within(details).getByText('Nenhum fato de modo de execução registrado.')).toBeInTheDocument();
  });

  test('resume indisponibilidade em um único parágrafo', () => {
    const { rerender } = render(<EvolutionClient {...buildProps()} autonomyEvidence={{ status: 'unavailable', reason: 'items_read_failed' }} />);
    expect(panel().textContent).toBe('Evidência de autonomia indisponível — falha na leitura de itens');
    expect(panel().children).toHaveLength(1);
    expect(panel().firstElementChild?.tagName).toBe('P');
    rerender(<EvolutionClient {...buildProps()} autonomyEvidence={{ status: 'unavailable', reason: 'event_history_unavailable' }} />);
    expect(panel().textContent).toBe('Evidência de autonomia indisponível — histórico de eventos indisponível');
  });

  test('omite resumo quando a propriedade está ausente', () => {
    render(<EvolutionClient {...buildProps()} />);
    expect(screen.queryByTestId('autonomy-evidence')).not.toBeInTheDocument();
  });

  test('reserva folga local no mobile e área de toque nos detalhes', () => {
    const css = readFileSync(join(__dirname, 'EvolutionClient.module.css'), 'utf8');
    const mobile = css.slice(css.indexOf('@media (max-width: 900px)'));
    const page = mobile.match(/\.page\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(Number(page.match(/padding-bottom:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(96);
    expect(css).toMatch(/\.autonomyDetails > summary\s*\{[^}]*min-height:\s*44px/);
  });
});
