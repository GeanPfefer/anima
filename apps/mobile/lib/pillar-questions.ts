export interface PillarQuestion {
  id: string;
  text: string;
  options: string[];
}

export interface PillarQuestionSet {
  pillarId: string;
  questions: PillarQuestion[];
}

// Perguntas para os 7 pilares padrão
const PILLAR_QUESTIONS: Record<string, PillarQuestion[]> = {
  mente: [
    {
      id: 'foco',
      text: 'O que você quer desenvolver em Mente?',
      options: ['Foco e concentração', 'Aprender coisas novas', 'Clareza mental', 'Reduzir ansiedade'],
    },
    {
      id: 'estado_atual',
      text: 'Como você descreveria seu estado mental hoje?',
      options: ['Me sinto sobrecarregado frequentemente', 'Equilibrado, mas quero melhorar', 'Focado e quero ir mais fundo'],
    },
  ],
  proposito: [
    {
      id: 'motivacao',
      text: 'O que te move nesse pilar?',
      options: ['Encontrar minha missão de vida', 'Alinhar trabalho e valores', 'Deixar um legado', 'Viver com mais intenção'],
    },
    {
      id: 'clareza',
      text: 'Você tem clareza do seu propósito hoje?',
      options: ['Sim, mas não estou vivendo ele', 'Tenho pistas mas não está definido', 'Ainda estou descobrindo'],
    },
  ],
  trabalho: [
    {
      id: 'foco',
      text: 'Qual é seu foco principal em Trabalho?',
      options: ['Crescer na carreira atual', 'Mudar de área', 'Empreender', 'Melhorar produtividade'],
    },
    {
      id: 'estado_atual',
      text: 'Como você se sente no trabalho hoje?',
      options: ['Realizado, mas quero crescer', 'Estagnado', 'Sobrecarregado', 'Querendo mudar completamente'],
    },
  ],
  saude: [
    {
      id: 'foco',
      text: 'Qual é seu foco principal em Saúde?',
      options: ['Perder peso', 'Ganhar massa', 'Mais energia e disposição', 'Dormir melhor', 'Exames e prevenção'],
    },
    {
      id: 'estilo_de_vida',
      text: 'Como você descreveria seu estilo de vida atual?',
      options: ['Sedentário', 'Ativo às vezes', 'Pratico exercício regularmente'],
    },
  ],
  relacoes: [
    {
      id: 'area',
      text: 'Qual área de Relações quer fortalecer?',
      options: ['Família', 'Amizades', 'Relacionamento amoroso', 'Rede profissional'],
    },
    {
      id: 'estado_atual',
      text: 'Como estão suas relações hoje?',
      options: ['Preciso investir mais tempo', 'Boas relações, quero aprofundar', 'Passando por um momento difícil'],
    },
  ],
  financas: [
    {
      id: 'objetivo',
      text: 'Qual é seu objetivo financeiro principal?',
      options: ['Sair das dívidas', 'Criar reserva de emergência', 'Investir e multiplicar', 'Aumentar minha renda'],
    },
    {
      id: 'situacao_atual',
      text: 'Como está sua situação financeira hoje?',
      options: ['Endividado', 'No zero, sem reservas', 'Tenho reservas, quero crescer', 'Já invisto, quero otimizar'],
    },
  ],
  lazer: [
    {
      id: 'foco',
      text: 'O que você quer no seu tempo de lazer?',
      options: ['Explorar novos hobbies', 'Voltar a algo que abandonei', 'Descanso de qualidade', 'Aventura e novas experiências'],
    },
    {
      id: 'equilibrio',
      text: 'Como está seu equilíbrio hoje?',
      options: ['Trabalho demais, pouco lazer', 'Tenho tempo mas não sei o que fazer', 'Equilibrado, quero intensificar'],
    },
  ],
};

// Para pilares customizados, retorna perguntas genéricas
const GENERIC_QUESTIONS: PillarQuestion[] = [
  {
    id: 'objetivo',
    text: 'O que você quer alcançar nesse pilar?',
    options: ['Começar do zero', 'Retomar algo que parei', 'Evoluir além do básico', 'Alcançar um objetivo específico'],
  },
  {
    id: 'nivel_atual',
    text: 'Qual é sua experiência aqui hoje?',
    options: ['Nenhuma experiência', 'Conhecimento básico', 'Intermediário', 'Avançado, quero ir além'],
  },
];

export function getQuestionsForPillar(pillarId: string): PillarQuestion[] {
  return PILLAR_QUESTIONS[pillarId] ?? GENERIC_QUESTIONS;
}
