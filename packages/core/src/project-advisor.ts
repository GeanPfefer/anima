export const PROJECT_AUTHORITY_LEVELS = [
  'canonical',
  'observed_state',
  'evidence',
  'historical_record',
] as const;

export type ProjectAuthorityLevel = typeof PROJECT_AUTHORITY_LEVELS[number];

export type ProjectContextSource = {
  readonly id: string;
  readonly authority: ProjectAuthorityLevel;
  readonly provenance: string;
  readonly content: string;
  readonly observedAt?: string;
};

export type ProjectAdvisorContext = {
  readonly question: string;
  readonly sources: readonly ProjectContextSource[];
};

export type ProjectAdvisoryClaim = {
  readonly statement: string;
  readonly sourceIds: readonly string[];
  readonly authorityClasses: readonly ProjectAuthorityLevel[];
};

export type ProjectAdvisoryAnswer = {
  readonly facts: readonly ProjectAdvisoryClaim[];
  readonly provenCapabilities: readonly ProjectAdvisoryClaim[];
  readonly unprovenFrontiers: readonly ProjectAdvisoryClaim[];
  readonly canonicalDirections: readonly ProjectAdvisoryClaim[];
  readonly recommendation: ProjectAdvisoryClaim;
  readonly rationale: readonly ProjectAdvisoryClaim[];
  readonly insufficiencies: readonly string[];
};

export interface ProjectAdvisor {
  advise(context: ProjectAdvisorContext): Promise<ProjectAdvisoryAnswer>;
}

const PROJECT_ADVISOR_PATTERNS = [
  /como (?:est[aá]|anda|vai) (?:o )?desenvolvimento do anima/i,
  /(?:qual|quais).{0,30}pr[oó]ximo(?:s)? passo(?:s)?.{0,30}(?:anima|projeto)/i,
  /estado (?:atual|real).{0,20}(?:anima|projeto)/i,
  /(?:anima|projeto).{0,30}(?:fronteira|capacidade comprovada|dire[cç][aã]o can[oô]nica)/i,
] as const;

export function isProjectAdvisorQuestion(message: string): boolean {
  const normalized = message.trim();
  return normalized.length >= 12 && PROJECT_ADVISOR_PATTERNS.some(pattern => pattern.test(normalized));
}

export function validateProjectAdvisorContext(context: ProjectAdvisorContext): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const source of context.sources) {
    if (!PROJECT_AUTHORITY_LEVELS.includes(source.authority)) problems.push(`authority_invalid:${source.id}`);
    if (!source.id || ids.has(source.id)) problems.push(`source_id_invalid:${source.id}`);
    ids.add(source.id);
    if (!source.provenance.trim()) problems.push(`provenance_missing:${source.id}`);
    if (!source.content.trim()) problems.push(`content_missing:${source.id}`);
  }
  if (!context.sources.some(source => source.authority === 'canonical')) problems.push('canonical_source_missing');
  if (!context.sources.some(source => source.authority === 'observed_state')) problems.push('observed_state_missing');
  if (!context.sources.some(source => source.authority === 'evidence')) problems.push('evidence_source_missing');
  return problems;
}

export function validateProjectAdvisoryAnswer(
  answer: ProjectAdvisoryAnswer,
  context: ProjectAdvisorContext,
): string[] {
  const allowed = new Set(context.sources.map(source => source.id));
  const authorityById = new Map(context.sources.map(source => [source.id, source.authority]));
  const problems = new Set<string>();
  const claims = [
    ...answer.facts,
    ...answer.provenCapabilities,
    ...answer.unprovenFrontiers,
    ...answer.canonicalDirections,
    answer.recommendation,
    ...answer.rationale,
  ];
  for (const claim of claims) {
    if (!claim.statement.trim()) problems.add('empty_claim_statement');
    if (claim.sourceIds.length === 0) problems.add('claim_without_source');
    if (new Set(claim.sourceIds).size !== claim.sourceIds.length) problems.add('duplicate_source_reference');
    if (new Set(claim.authorityClasses).size !== claim.authorityClasses.length) problems.add('duplicate_authority_class');
    for (const id of claim.sourceIds) if (!allowed.has(id)) problems.add('unknown_source_reference');
    const derived = [...new Set(claim.sourceIds.flatMap(id => authorityById.get(id) ?? []))].sort();
    const declared = [...claim.authorityClasses].sort();
    if (derived.join('|') !== declared.join('|')) problems.add('authority_class_mismatch');
    if (derived.includes('canonical') && derived.includes('historical_record')) problems.add('canonical_historical_conflict');
  }
  const requireOnlyAuthority = (code: string, categoryClaims: readonly ProjectAdvisoryClaim[], accepted: readonly ProjectAuthorityLevel[]) => {
    for (const claim of categoryClaims) {
      const actual = claim.sourceIds.flatMap(id => authorityById.get(id) ?? []);
      if (actual.length === 0 || actual.some(authority => !accepted.includes(authority))) problems.add(code);
    }
  };
  requireOnlyAuthority('invalid_fact_authority', answer.facts, ['observed_state', 'evidence']);
  requireOnlyAuthority('missing_evidence_for_proven_capability', answer.provenCapabilities, ['evidence']);
  requireOnlyAuthority('invalid_open_frontier_authority', answer.unprovenFrontiers, ['observed_state', 'evidence', 'historical_record']);
  requireOnlyAuthority('invalid_canonical_direction_source', answer.canonicalDirections, ['canonical']);
  if (answer.rationale.length === 0) problems.add('missing_recommendation_rationale');
  return [...problems];
}
