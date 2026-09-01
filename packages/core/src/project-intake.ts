// ============================================================
// PROJECT INTAKE V0 — representação durável de uma IDEIA DE PROJETO (PURO).
//
// O Anima passa a receber IDEIAS de projeto em linguagem natural e a persistir uma
// estrutura MÍNIMA delas ANTES de qualquer desenvolvimento. Uma ideia ("talvez construir
// um sistema para o estúdio da minha mãe") NÃO é um WorkItem ("implemente o CRUD de
// alunos"): o intake existe UPSTREAM do backlog executivo. A cadeia futura desejada é
//   ideia → discovery → entendimento → análise build/buy/investigate → hipótese de MVP
//   → decisão humana → bootstrap → backlog → work_items → execução.
//
// Este módulo é SÓ o CONTRATO + validação + projeção puros: sem LLM, sem persistência, sem
// criar trabalho, sem decidir nada. O domínio é GENÉRICO (não sabe de pilates, nem de
// software): representa qualquer ideia de projeto. EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ DECISÃO ≠
// EFEITO — aqui não se avança estágio nem se materializa backlog.
// ============================================================

/** Estágio de EXPLORAÇÃO da ideia — do registro cru à decisão humana. NÃO é o estado de um
 * WorkItem: descreve a maturidade do ENTENDIMENTO da ideia, não de uma execução.
 *   - `captured`  : ideia registrada, ainda crua;
 *   - `exploring` : discovery/entendimento em curso;
 *   - `shaping`   : hipótese de MVP tomando forma;
 *   - `decided`   : houve decisão humana (seguir/adiar/não seguir);
 *   - `archived`  : encerrada sem seguir. */
export const projectIdeaStatuses = ['captured', 'exploring', 'shaping', 'decided', 'archived'] as const;
export type ProjectIdeaStatus = typeof projectIdeaStatuses[number];

/** Parte interessada da ideia: papel + descrição livre. Domínio-genérico (a "dona do
 * estúdio", o "usuário final", um "sistema externo"): o intake não impõe taxonomia. */
export interface ProjectIdeaStakeholder {
  readonly role: string;
  readonly description: string;
}

/** Ideia de projeto no intake — estrutura MÍNIMA e durável. Os campos irredutíveis
 * (`title`, `summary`, `goal`) são não-vazios; os campos ESTRUTURANTES (contexto,
 * stakeholders, restrições, perguntas em aberto, riscos, integrações candidatas, hipótese
 * de MVP) podem estar vazios num registro cru e são preenchidos ao longo do discovery. */
export interface ProjectIdeaV0 {
  readonly schemaVersion: 1;
  /** Nome curto da ideia. */
  readonly title: string;
  /** Descrição/problema em uma ou duas frases (o "o quê"). */
  readonly summary: string;
  /** Contexto de fundo relevante (pode estar vazio no registro cru). */
  readonly context: string;
  /** Objetivo do projeto (o "porquê" — o resultado pretendido). */
  readonly goal: string;
  readonly stakeholders: readonly ProjectIdeaStakeholder[];
  readonly constraints: readonly string[];
  readonly openQuestions: readonly string[];
  readonly risks: readonly string[];
  /** Possíveis integrações/sistemas externos cogitados (ainda hipóteses). */
  readonly candidateIntegrations: readonly string[];
  /** Hipótese inicial de MVP; `null` até o shaping (não se força um MVP no intake cru). */
  readonly mvpHypothesis: string | null;
  readonly status: ProjectIdeaStatus;
}

/** Entrada mínima para registrar uma ideia crua: o núcleo irredutível (o que um humano/chat
 * fornece de saída). O restante do contrato nasce vazio e é preenchido no discovery. */
export interface DraftProjectIdeaInput {
  readonly title: string;
  readonly summary: string;
  readonly goal: string;
}

/**
 * Cria a estrutura MÍNIMA de uma ideia crua a partir do núcleo irredutível — PURO, sem
 * persistir. Normaliza espaços do núcleo; campos estruturantes nascem vazios e a ideia
 * entra em `captured`. Lança `RangeError` se o núcleo for vazio (o resultado seria inválido
 * por `validateProjectIdea` — a criação falha na origem, não persiste lixo).
 */
export function draftProjectIdea(input: DraftProjectIdeaInput): ProjectIdeaV0 {
  const title = input.title.trim();
  const summary = input.summary.trim();
  const goal = input.goal.trim();
  if (title.length === 0 || summary.length === 0 || goal.length === 0) {
    throw new RangeError('draftProjectIdea exige title, summary e goal não vazios.');
  }
  return {
    schemaVersion: 1, title, summary, goal, context: '',
    stakeholders: [], constraints: [], openQuestions: [], risks: [], candidateIntegrations: [],
    mvpHypothesis: null, status: 'captured',
  };
}

const projectIdeaKeys = [
  'schemaVersion', 'title', 'summary', 'context', 'goal', 'stakeholders', 'constraints',
  'openQuestions', 'risks', 'candidateIntegrations', 'mvpHypothesis', 'status',
] as const;
const stakeholderKeys = ['role', 'description'] as const;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const hasExactKeys = (value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean => {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
};
const belongsTo = <T extends string>(value: unknown, vocabulary: readonly T[]): value is T =>
  typeof value === 'string' && vocabulary.includes(value as T);
/** Lista de strings NÃO-vazias, sem duplicatas (perguntas/riscos/restrições/integrações). */
const isNonBlankStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isNonBlank) && new Set(value).size === value.length;

/**
 * Valida somente a estrutura e a semântica contratual do Project Intake V0. `unknown` NÃO é
 * aceito; ausência de campo, campos extras, tipos errados e vocabulário externo falham
 * FECHADO (mensagem). Não infere, não avança estágio, não persiste. Devolve `null` quando
 * válido — mesmo padrão de `validateWorkIntelligenceClassification`.
 */
export function validateProjectIdea(value: unknown): string | null {
  if (!isRecord(value) || !hasExactKeys(value, projectIdeaKeys)) {
    return 'A ideia de projeto exige exatamente os campos do contrato V0.';
  }
  if (value['schemaVersion'] !== 1) return 'schemaVersion deve ser 1.';
  if (!isNonBlank(value['title'])) return 'title deve ser não vazio.';
  if (!isNonBlank(value['summary'])) return 'summary deve ser não vazio.';
  if (!isNonBlank(value['goal'])) return 'goal deve ser não vazio.';
  if (!isString(value['context'])) return 'context deve ser texto (pode ser vazio).';

  const stakeholders = value['stakeholders'];
  if (!Array.isArray(stakeholders)) return 'stakeholders deve ser uma lista.';
  for (const stakeholder of stakeholders) {
    if (!isRecord(stakeholder) || !hasExactKeys(stakeholder, stakeholderKeys)) return 'Cada stakeholder exige exatamente role e description.';
    if (!isNonBlank(stakeholder['role'])) return 'stakeholder.role deve ser não vazio.';
    if (!isString(stakeholder['description'])) return 'stakeholder.description deve ser texto.';
  }

  if (!isNonBlankStringList(value['constraints'])) return 'constraints deve ser uma lista de textos não vazios e únicos.';
  if (!isNonBlankStringList(value['openQuestions'])) return 'openQuestions deve ser uma lista de textos não vazios e únicos.';
  if (!isNonBlankStringList(value['risks'])) return 'risks deve ser uma lista de textos não vazios e únicos.';
  if (!isNonBlankStringList(value['candidateIntegrations'])) return 'candidateIntegrations deve ser uma lista de textos não vazios e únicos.';

  const mvp = value['mvpHypothesis'];
  if (mvp !== null && !isNonBlank(mvp)) return 'mvpHypothesis deve ser null ou um texto não vazio.';
  if (!belongsTo(value['status'], projectIdeaStatuses)) return 'status fora do vocabulário de intake V0.';
  return null;
}

/** Campos ESTRUTURANTES da ideia (fora do núcleo irredutível title/summary/goal) — o que o
 * discovery ainda pode preencher. Ordem estável para saída determinística. */
export const projectIdeaStructuringFields = [
  'context', 'stakeholders', 'constraints', 'openQuestions', 'risks', 'candidateIntegrations', 'mvpHypothesis',
] as const;
export type ProjectIdeaStructuringField = typeof projectIdeaStructuringFields[number];

/** Projeção READ-ONLY do estado de estruturação de uma ideia: contagens + quais campos
 * estruturantes ainda estão vazios. Guia o discovery SEM decidir avançar de estágio. */
export interface ProjectIdeaIntakeSummary {
  readonly title: string;
  readonly status: ProjectIdeaStatus;
  readonly stakeholderCount: number;
  readonly constraintCount: number;
  readonly openQuestionCount: number;
  readonly riskCount: number;
  readonly candidateIntegrationCount: number;
  readonly hasMvpHypothesis: boolean;
  /** Campos estruturantes ainda vazios (ordem de `projectIdeaStructuringFields`). Vazio ⇒ a
   * ideia já acumulou estrutura em todas as frentes — não implica DECISÃO de avançar. */
  readonly openStructuringFields: readonly ProjectIdeaStructuringField[];
}

const isEmptyStructuringField = (idea: ProjectIdeaV0, field: ProjectIdeaStructuringField): boolean => {
  switch (field) {
    case 'context': return idea.context.trim().length === 0;
    case 'stakeholders': return idea.stakeholders.length === 0;
    case 'constraints': return idea.constraints.length === 0;
    case 'openQuestions': return idea.openQuestions.length === 0;
    case 'risks': return idea.risks.length === 0;
    case 'candidateIntegrations': return idea.candidateIntegrations.length === 0;
    case 'mvpHypothesis': return idea.mvpHypothesis === null;
  }
};

/**
 * Projeta o resumo de estruturação da ideia — puro e determinístico. Não valida (assume uma
 * `ProjectIdeaV0` já válida), não avança estágio, não cria trabalho. É a base para uma UI de
 * intake e para um futuro discovery saber "o que ainda falta entender".
 */
export function summarizeProjectIdeaIntake(idea: ProjectIdeaV0): ProjectIdeaIntakeSummary {
  return {
    title: idea.title,
    status: idea.status,
    stakeholderCount: idea.stakeholders.length,
    constraintCount: idea.constraints.length,
    openQuestionCount: idea.openQuestions.length,
    riskCount: idea.risks.length,
    candidateIntegrationCount: idea.candidateIntegrations.length,
    hasMvpHypothesis: idea.mvpHypothesis !== null,
    openStructuringFields: projectIdeaStructuringFields.filter(field => isEmptyStructuringField(idea, field)),
  };
}
