import {
  PROJECT_AUTHORITY_LEVELS,
  validateProjectAdvisoryAnswer,
  validateProjectAdvisorContext,
  type ProjectAdvisor,
  type ProjectAdvisorContext,
  type ProjectAdvisoryAnswer,
} from '@anima/core';
import { streamChatProvider, type ChatProviderId } from './chat-provider';

const SYSTEM = `Você é a capacidade interna Project Advisor do Anima. Produza SOMENTE JSON válido conforme o schema.
Você recebe fontes governadas, cada uma com classe de autoridade e proveniência.
Não use memória própria sobre o projeto. Não invente. Não transforme histórico em decisão vigente.
EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ ADVISORY ≠ DECISÃO ≠ AÇÃO.
Você recomenda, mas não decide nem propõe executar qualquer mutação.
Formato exato: {"facts":[claim],"provenCapabilities":[claim],"unprovenFrontiers":[claim],"canonicalDirections":[claim],"recommendation":claim,"rationale":[claim],"insufficiencies":[string]}.
claim = {"statement":string,"sourceIds":[string],"authorityClasses":[authority]}.
authorityClasses deve ser exatamente o conjunto das classes dos sourceIds citados, sem duplicatas.
Regras: facts usa somente observed_state/evidence; provenCapabilities somente evidence; unprovenFrontiers somente observed_state/evidence/historical_record; canonicalDirections somente canonical. Recommendation e rationale podem combinar fontes válidas, mas nunca misture canonical e historical_record no mesmo claim. Rationale deve conter ao menos um claim. Toda afirmação cita IDs recebidos, sem duplicatas. Se as fontes forem insuficientes ou conflitantes, registre isso em insufficiencies e seja conservador.`;

const claimSchema = (sourceIds: readonly string[], authorityClasses: readonly string[]) => ({
  type: 'object',
  properties: {
    statement: { type: 'string', minLength: 1 },
    sourceIds: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: sourceIds } },
    authorityClasses: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: authorityClasses } },
  },
  required: ['statement', 'sourceIds', 'authorityClasses'],
  additionalProperties: false,
});

export function projectAdvisoryAnswerSchema(context: ProjectAdvisorContext): Record<string, unknown> {
  const ids = (authorities: readonly ProjectAdvisorContext['sources'][number]['authority'][]) =>
    context.sources.filter(source => authorities.includes(source.authority)).map(source => source.id);
  const authorityValues = (authorities: readonly ProjectAdvisorContext['sources'][number]['authority'][]) => [...authorities];
  const withoutAuthority = (authority: ProjectAdvisorContext['sources'][number]['authority']) =>
    context.sources.filter(source => source.authority !== authority).map(source => source.id);
  const recommendationClaim = {
    anyOf: [
      claimSchema(withoutAuthority('historical_record'), authorityValues(['canonical', 'observed_state', 'evidence'])),
      claimSchema(withoutAuthority('canonical'), authorityValues(['observed_state', 'evidence', 'historical_record'])),
    ],
  };
  return {
    type: 'object',
    properties: {
      facts: { type: 'array', items: claimSchema(ids(['observed_state', 'evidence']), authorityValues(['observed_state', 'evidence'])) },
      provenCapabilities: { type: 'array', items: claimSchema(ids(['evidence']), authorityValues(['evidence'])) },
      unprovenFrontiers: { type: 'array', items: claimSchema(ids(['observed_state', 'evidence', 'historical_record']), authorityValues(['observed_state', 'evidence', 'historical_record'])) },
      canonicalDirections: { type: 'array', items: claimSchema(ids(['canonical']), authorityValues(['canonical'])) },
      recommendation: recommendationClaim,
      rationale: { type: 'array', minItems: 1, items: recommendationClaim },
      insufficiencies: { type: 'array', items: { type: 'string' } },
    },
    required: ['facts', 'provenCapabilities', 'unprovenFrontiers', 'canonicalDirections', 'recommendation', 'rationale', 'insufficiencies'],
    additionalProperties: false,
  };
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let value = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    value += decoder.decode(chunk.value, { stream: true });
  }
  return value + decoder.decode();
}

function parseAnswer(text: string): ProjectAdvisoryAnswer {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const parsed = JSON.parse(candidate) as unknown;
  const isClaim = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const claim = value as Record<string, unknown>;
    return typeof claim.statement === 'string' && claim.statement.length > 0
      && Array.isArray(claim.sourceIds) && claim.sourceIds.length > 0 && claim.sourceIds.every(id => typeof id === 'string')
      && Array.isArray(claim.authorityClasses) && claim.authorityClasses.length > 0
      && claim.authorityClasses.every(authority => PROJECT_AUTHORITY_LEVELS.includes(authority as typeof PROJECT_AUTHORITY_LEVELS[number]));
  };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('project_advisor_structure_invalid');
  const answer = parsed as Record<string, unknown>;
  const claimArrays = ['facts', 'provenCapabilities', 'unprovenFrontiers', 'canonicalDirections', 'rationale'] as const;
  if (!claimArrays.every(key => Array.isArray(answer[key]) && (answer[key] as unknown[]).every(isClaim))
    || !isClaim(answer.recommendation)
    || !Array.isArray(answer.insufficiencies)
    || !(answer.insufficiencies as unknown[]).every(item => typeof item === 'string')) {
    throw new Error('project_advisor_structure_invalid');
  }
  return parsed as ProjectAdvisoryAnswer;
}

export type ProjectAdvisorModel = (context: ProjectAdvisorContext) => Promise<string>;

export function createProjectAdvisorFromModel(model: ProjectAdvisorModel): ProjectAdvisor {
  return {
    async advise(context: ProjectAdvisorContext): Promise<ProjectAdvisoryAnswer> {
      const contextProblems = validateProjectAdvisorContext(context);
      if (contextProblems.length > 0) throw new Error(`project_advisor_context_invalid:${contextProblems.join(',')}`);
      const answer = parseAnswer(await model(context));
      const answerProblems = validateProjectAdvisoryAnswer(answer, context);
      if (answerProblems.length > 0) {
        console.warn('[project-advisor] semantic validation rejected', { problems: answerProblems });
        throw new Error(`project_advisor_answer_invalid:${answerProblems.join(',')}`);
      }
      console.info('[project-advisor] structured answer validated', {
        sources: context.sources.length,
        claims: answer.facts.length + answer.provenCapabilities.length + answer.unprovenFrontiers.length
          + answer.canonicalDirections.length + answer.rationale.length + 1,
      });
      return answer;
    },
  };
}

export function createProjectAdvisor(provider: ChatProviderId): ProjectAdvisor {
  return createProjectAdvisorFromModel(async context => {
      console.info('[project-advisor] provider request started', { provider, structured: true });
      const result = await streamChatProvider({
        provider,
        systemPrompt: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(context) }],
        developmentMode: false,
        structuredOutput: { name: 'project_advisory_answer', schema: projectAdvisoryAnswerSchema(context) },
      });
      const response = await readStream(result.stream);
      console.info('[project-advisor] provider response received', { provider: result.provider, model: result.model, characters: response.length });
      return response;
  });
}

const section = (title: string, claims: readonly { statement: string; sourceIds: readonly string[] }[]) =>
  `**${title}**\n${claims.map(claim => `- ${claim.statement} _[${claim.sourceIds.join(', ')}]_`).join('\n')}`;

export function renderProjectAdvisory(answer: ProjectAdvisoryAnswer): string {
  const parts = [
    section('Estado observado', answer.facts),
    section('Capacidades comprovadas', answer.provenCapabilities),
    section('Fronteiras ainda não comprovadas', answer.unprovenFrontiers),
    section('Direções canônicas', answer.canonicalDirections),
    section('Recomendação', [answer.recommendation]),
    section('Por quê', answer.rationale),
  ];
  if (answer.insufficiencies.length > 0) parts.push(`**Limites desta leitura**\n${answer.insufficiencies.map(item => `- ${item}`).join('\n')}`);
  return parts.join('\n\n');
}
