import { fireEvent, render, screen } from '@testing-library/react';
import {
  ANIMA_CAPABILITY_REGISTRY_V0,
  getAnimaCapabilityGraph,
  longestDependencyPath,
  summarizeByDomain,
  summarizeTargetProgress,
} from '@anima/core';
import EvolutionClient, { type EvolutionClientProps } from './EvolutionClient';

const FEATURED = 'agency.continuous-self-development';

function buildProps(): EvolutionClientProps {
  const graph = getAnimaCapabilityGraph();
  return {
    nodes: graph.nodes,
    domainSummaries: summarizeByDomain(ANIMA_CAPABILITY_REGISTRY_V0),
    featuredTargetId: FEATURED,
    featuredProgress: summarizeTargetProgress(graph, FEATURED),
    featuredPath: longestDependencyPath(graph, FEATURED) ?? [],
  };
}

describe('EvolutionClient', () => {
  test('projeta o modelo: título, domínios e uma capacidade por nó (não é hardcoded)', () => {
    render(<EvolutionClient {...buildProps()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Evolução do Anima' })).toBeInTheDocument();
    // Os seis domínios aparecem (resumo + faixa do mapa).
    expect(screen.getAllByText('Compreensão').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Agência').length).toBeGreaterThan(0);
    // Cada capacidade vira um nó clicável com nome + maturidade no rótulo acessível.
    expect(screen.getByRole('button', { name: 'Chat — Operacional' })).toBeInTheDocument();
  });

  test('diferencia futuro de presente: capacidade projetada aparece como projetada', () => {
    render(<EvolutionClient {...buildProps()} />);
    // O self-development contínuo é futuro — nunca marcado como já existente.
    expect(
      screen.getByRole('button', { name: 'Self-development contínuo — Projetada' }),
    ).toBeInTheDocument();
  });

  test('sem seleção, mostra o objetivo em foco e um caminho do presente até o futuro', () => {
    render(<EvolutionClient {...buildProps()} />);
    expect(screen.getByText('Objetivo em foco')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Self-development contínuo' })).toBeInTheDocument();
    expect(screen.getByText('Um caminho do presente até o futuro')).toBeInTheDocument();
    // Distância estrutural derivada do grafo (contagens factuais).
    expect(screen.getByText(/capacidades necessárias já existem/)).toBeInTheDocument();
  });

  test('clicar numa capacidade abre o detalhe com estado, dependências e evidências', () => {
    render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat — Operacional' }));
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByText('Depende de')).toBeInTheDocument();
    expect(screen.getByText('Evidências conhecidas')).toBeInTheDocument();
    expect(screen.getByText('O que falta para o próximo estágio')).toBeInTheDocument();
    // Uma dependência real é navegável.
    expect(screen.getByRole('button', { name: 'Persistência' })).toBeInTheDocument();
  });

  test('navegação por dependência troca a capacidade selecionada', () => {
    render(<EvolutionClient {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat — Operacional' }));
    fireEvent.click(screen.getByRole('button', { name: 'Persistência' }));
    expect(screen.getByRole('heading', { name: 'Persistência' })).toBeInTheDocument();
  });

  test('não inventa porcentagem global de conclusão', () => {
    render(<EvolutionClient {...buildProps()} />);
    // Nenhuma alegação numérica de conclusão (ex.: "63% completo"). O rodapé cita
    // "X% completo" só para explicar por que NÃO existe — X é letra, não dígito.
    expect(screen.queryByText(/\d+\s*%\s*completo/i)).not.toBeInTheDocument();
    expect(screen.getByText(/não existe base semântica/i)).toBeInTheDocument();
  });
});
