export type ArchetypeId = 'explorer' | 'focused' | 'builder' | 'visionary';

export interface Archetype {
  id: ArchetypeId;
  name: string;
  emoji: string;
  description: string;
  aiContext: string; // injetado no system prompt da IA
}

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  explorer: {
    id: 'explorer',
    name: 'O Explorador',
    emoji: '🧭',
    description: 'Você se move pelo interesse. Gosta de experimentar, muda de direção sem culpa e encontra conexões entre coisas diferentes. A variedade é o que te mantém vivo.',
    aiContext: 'Perfil Explorador: muda de interesse com facilidade, se motiva por novidade e variedade, não responde bem a pressão de consistência ou streak. Prefere sugestões amplas, nunca cobra foco excessivo em uma única área.',
  },
  focused: {
    id: 'focused',
    name: 'O Focado',
    emoji: '🎯',
    description: 'Você vai fundo. Prefere dominar uma coisa de cada vez, incomoda quando deixa algo pela metade e sente satisfação real quando conclui o que começou.',
    aiContext: 'Perfil Focado: prefere concentrar energia em poucos pilares de cada vez, sente desconforto com tarefas incompletas, se motiva por profundidade e domínio. Sugerir foco em 1-2 áreas prioritárias, valorizar conclusões.',
  },
  builder: {
    id: 'builder',
    name: 'O Construtor',
    emoji: '🧱',
    description: 'Você acredita no processo. Consistência diária, hábitos pequenos e progresso visível são o que te move. Você constrói devagar mas constrói de verdade.',
    aiContext: 'Perfil Construtor: motivado por consistência, rotinas e progresso gradual. Responde bem a streak, hábitos e métricas de sequência. Valorizar regularidade, celebrar constância.',
  },
  visionary: {
    id: 'visionary',
    name: 'O Visionário',
    emoji: '🔭',
    description: 'Você pensa grande. Cada ação precisa fazer sentido dentro de um plano maior. Você tolera o processo quando enxerga para onde está indo.',
    aiContext: 'Perfil Visionário: motivado por objetivos grandes e de longo prazo, precisa ver o propósito por trás das ações. Conectar atividades à visão de futuro, sugerir quests de longo prazo.',
  },
};

// Cada opção mapeia pesos nos 4 arquétipos
export interface QuestionOption {
  label: string;
  weights: Partial<Record<ArchetypeId, number>>;
}

export interface ArchetypeQuestion {
  id: string;
  text: string;
  options: QuestionOption[];
}

export const ARCHETYPE_QUESTIONS: ArchetypeQuestion[] = [
  {
    id: 'organizacao',
    text: 'Como você costuma se organizar no dia a dia?',
    options: [
      { label: 'Faço várias coisas ao mesmo tempo',      weights: { explorer: 3 } },
      { label: 'Foco em uma coisa até terminar',          weights: { focused: 3 } },
      { label: 'Sigo uma rotina consistente',             weights: { builder: 3 } },
      { label: 'Trabalho em direção a um plano maior',    weights: { visionary: 3 } },
    ],
  },
  {
    id: 'motivacao',
    text: 'O que mais te motiva a agir?',
    options: [
      { label: 'Descobrir algo novo',                     weights: { explorer: 3 } },
      { label: 'Dominar algo completamente',              weights: { focused: 3 } },
      { label: 'Ver progresso todo dia',                  weights: { builder: 3 } },
      { label: 'Alcançar um objetivo grande',             weights: { visionary: 3 } },
    ],
  },
  {
    id: 'pausa',
    text: 'Quando você para uma atividade por vários dias, o que sente?',
    options: [
      { label: 'Normal, logo encontro outra coisa',       weights: { explorer: 3, builder: -1 } },
      { label: 'Me incomoda, prefiro terminar o que comecei', weights: { focused: 3 } },
      { label: 'Sinto falta da rotina',                   weights: { builder: 3 } },
      { label: 'Avalio se ainda faz sentido pro meu plano', weights: { visionary: 3, focused: 1 } },
    ],
  },
  {
    id: 'frase',
    text: 'Qual dessas frases mais te representa?',
    options: [
      { label: '"Quero experimentar tudo"',               weights: { explorer: 3 } },
      { label: '"Quero ser muito bom no que faço"',       weights: { focused: 3 } },
      { label: '"Quero ser consistente todo dia"',        weights: { builder: 3 } },
      { label: '"Quero construir algo que dure"',         weights: { visionary: 3 } },
    ],
  },
  {
    id: 'metas',
    text: 'Como você lida com suas metas?',
    options: [
      { label: 'Mudo com frequência conforme o interesse', weights: { explorer: 3 } },
      { label: 'Vou fundo até alcançar',                  weights: { focused: 3 } },
      { label: 'Divido em hábitos e ações diárias',       weights: { builder: 3 } },
      { label: 'Penso em como impactam meu futuro',       weights: { visionary: 3 } },
    ],
  },
];

export type ArchetypeResult = Record<ArchetypeId, number>; // percentuais 0-100

export function calculateArchetype(answers: Record<string, string>): ArchetypeResult {
  const scores: Record<ArchetypeId, number> = {
    explorer: 0, focused: 0, builder: 0, visionary: 0,
  };

  for (const question of ARCHETYPE_QUESTIONS) {
    const selectedLabel = answers[question.id];
    if (!selectedLabel) continue;
    const option = question.options.find((o) => o.label === selectedLabel);
    if (!option) continue;
    for (const [archId, weight] of Object.entries(option.weights) as [ArchetypeId, number][]) {
      scores[archId] = Math.max(0, (scores[archId] ?? 0) + weight);
    }
  }

  const total = Object.values(scores).reduce((s, v) => s + v, 0);
  if (total === 0) {
    return { explorer: 25, focused: 25, builder: 25, visionary: 25 };
  }

  return {
    explorer:  Math.round((scores.explorer  / total) * 100),
    focused:   Math.round((scores.focused   / total) * 100),
    builder:   Math.round((scores.builder   / total) * 100),
    visionary: Math.round((scores.visionary / total) * 100),
  };
}

export function getDominantArchetype(result: ArchetypeResult): ArchetypeId {
  const sorted = (Object.entries(result) as [ArchetypeId, number][]).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? 'explorer';
}
