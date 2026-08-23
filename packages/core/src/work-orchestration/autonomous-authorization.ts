import { readCanonicalProvenanceFromIntent } from './canonical-materialization';

// ============================================================
// Envelope de AUTORIZAÇÃO AUTÔNOMA V1 — evaluator PURO (autonomia progressiva).
//
// Decisão humana ratificada: o Anima pode AUTO-APROVAR uma CLASSE ESTREITA de trabalho
// local canônico — o próximo degrau da autonomia progressiva. Este módulo é a AUTORIDADE
// determinística que decide se um work_item `proposed`, já materializado pelo materializer
// canônico ratificado, está DENTRO do envelope estreito autorizado.
//
// Fronteiras não-negociáveis (por que isto é seguro):
//   - O planner NÃO concede autoridade: ele só propõe um `execution_spec`. Esta policy
//     determinística decide se esse spec está autorizado. (O evaluator nunca chama o LLM.)
//   - Materialização ≠ aprovação ≠ execução: este módulo só decide a APROVAÇÃO; a execução
//     continua sendo do Supervisor/worktree/Verifier existentes (teto `review`).
//   - Fail-closed por construção: QUALQUER condição não satisfeita, ambígua ou fora do
//     envelope → `authorized:false` com razão tipada → requer decisão HUMANA. Nunca "na
//     dúvida, aprova".
//   - Honestidade de autoria: quem PERSISTE a decisão (o driver + RPC) grava a aprovação sob
//     a autoridade `system`/`autonomous_policy`, NUNCA forjando `author='user'`. Este
//     evaluator não persiste nada — só decide.
//
// O evaluator lê os SHAPES PERSISTIDOS (defesa em profundidade sobre o que está no banco):
// `intent.execution_spec` é snake_case; `intent.canonical_provenance` é camelCase (lido por
// `readCanonicalProvenanceFromIntent`); `proposal.data.included_scope` é snake_case. Assim a
// autoridade decide exatamente sobre o item que será executado, não sobre uma reconstrução.
// ============================================================

/** Versão do contrato do envelope. Gravada na decisão persistida (auditabilidade). */
export const AUTONOMOUS_AUTHORIZATION_ENVELOPE_VERSION = 1 as const;

/** A razão canônica pela qual um item materializado é elegível — o materializer ratificado
 * grava exatamente esta razão na proveniência. Auto-aprovação exige esta origem. */
export const RATIFIED_MATERIALIZATION_REASON = 'selected_ready' as const;

/** Backends de código LOCAIS autorizados para auto-aprovação (classe estreita). `openai` é
 * EXTERNO e nunca entra aqui. Default conservador: só `ollama` (modelo local puro). */
export const DEFAULT_AUTHORIZED_LOCAL_CODER_BACKENDS: readonly string[] = ['ollama'];

/** Permissões máximas de um slice auto-aprovável: leitura + escrita CONFINADA à worktree
 * isolada. Qualquer permissão fora deste conjunto = filesystem/efeito arbitrário = fora do
 * envelope. */
export const ISOLATED_WORKSPACE_PERMISSIONS: readonly string[] = ['workspace_read', 'workspace_write_isolated'];

/** Prefixos de caminho SENSÍVEIS À SEGURANÇA que um slice auto-aprovado NUNCA pode tocar —
 * inclui a própria policy (o item não pode reescrever o que o autoriza), a superfície de
 * política do banco (migrations: RLS/allowlist/RPCs) e a config do harness. "sem
 * security-policy mutation" + defesa em profundidade. Extensível pelo chamador. */
export const DEFAULT_SECURITY_SENSITIVE_PATH_PREFIXES: readonly string[] = [
  'supabase/migrations',
  '.claude',
  'packages/core/src/work-orchestration/autonomous-authorization',
  'apps/web/lib/work-orchestration/auto-approval',
];

/** Entrada NORMALIZADA do evaluator. O driver preenche a partir do work_item persistido;
 * `intent`/`proposal` são os jsonb crus (o evaluator os lê com o casing correto). */
export interface AutonomousAuthorizationInput {
  /** Estado atual do work_item. Auto-aprovação só faz sentido em `proposed`. */
  readonly state: string;
  /** Nível de impacto persistido. A classe estreita exige impacto `low`. */
  readonly impactLevel: string;
  /** Capacidade persistida. A classe estreita exige `programming`. */
  readonly capability: string;
  /** `intent` cru do work_item (execution_spec snake, canonical_provenance camel). */
  readonly intent: unknown;
  /** `proposal` cru do work_item (`{schema_version,data:{included_scope,...}}`). */
  readonly proposal: unknown;
  /** Veredito atual do Resource Governor. Só `permit` autoriza; qualquer outro adia. */
  readonly governorVerdict: 'permit' | 'defer' | 'fail_closed';
  /** Override dos backends locais autorizados (default = só `ollama`). */
  readonly allowedLocalCoderBackends?: readonly string[];
  /** Override dos prefixos sensíveis à segurança bloqueados no included_scope. */
  readonly securitySensitivePathPrefixes?: readonly string[];
}

/** Decisão determinística do envelope. `authorized:true` NÃO aprova nada — apenas declara
 * que o item cabe no envelope estreito e pode ser persistido como aprovação `system`. */
export type AutonomousAuthorizationDecision =
  | {
      readonly authorized: true;
      readonly envelopeVersion: typeof AUTONOMOUS_AUTHORIZATION_ENVELOPE_VERSION;
      readonly sourceId: string;
      /** Nomes das condições satisfeitas — gravado na decisão persistida (auditoria). */
      readonly checks: readonly string[];
    }
  | { readonly authorized: false; readonly failClosedReason: string };

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const isNonBlankString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

const isNonBlankStringArray = (v: unknown, min: number): v is string[] =>
  Array.isArray(v) && v.length >= min && v.every(isNonBlankString);

const fail = (reason: string): AutonomousAuthorizationDecision => ({ authorized: false, failClosedReason: reason });

/** Normaliza um caminho para comparação de prefixo: barras `/`, sem `./` inicial. */
const normalizePath = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').trim();

/**
 * Decide, deterministicamente e fail-closed, se um work_item `proposed` cabe no ENVELOPE V1
 * de auto-aprovação. Puro: sem I/O, sem LLM, sem relógio. Qualquer condição não satisfeita,
 * ausente ou ambígua → `authorized:false` (requer humano). A ordem das checagens é estável e
 * cada uma tem uma razão tipada, para auditoria e teste.
 */
export function evaluateAutonomousApprovalEnvelope(
  input: AutonomousAuthorizationInput,
): AutonomousAuthorizationDecision {
  const checks: string[] = [];

  // 1. Só `proposed` é auto-aprovável (materialização ≠ aprovação; nada já aprovado/executado).
  if (input.state !== 'proposed') return fail('state_not_proposed');
  checks.push('state_proposed');

  // 2. Proveniência canônica válida + origem pelo materializer RATIFICADO. Sem isto, não é
  //    trabalho local canônico e a autoridade não se aplica.
  const provenance = readCanonicalProvenanceFromIntent(input.intent);
  if (!provenance) return fail('provenance_missing_or_invalid');
  if (provenance.kind !== 'canonical_backlog') return fail('provenance_not_canonical');
  if (provenance.materializationReason !== RATIFIED_MATERIALIZATION_REASON) return fail('provenance_reason_not_ratified');
  if (!isPositiveInt(provenance.planningGeneration)) return fail('provenance_generation_invalid');
  if (!isNonBlankString(provenance.sourceId)) return fail('provenance_source_id_missing');
  checks.push('provenance_canonical_ratified');

  // 3. Impacto estreito: `low`. Exclui external/irreversible/structural/strategic/financial/
  //    significant — ou seja, sem efeitos externos/irreversíveis/estratégicos.
  if (input.impactLevel !== 'low') return fail('impact_not_low');
  checks.push('impact_low');

  // 4. Capacidade estreita: `programming` (o materializer canônico grava exatamente isto).
  if (input.capability !== 'programming') return fail('capability_not_programming');
  checks.push('capability_programming');

  // 5. execution_spec presente e coerente com a classe estreita.
  const intentObj = asObject(input.intent);
  const spec = intentObj ? asObject(intentObj.execution_spec) : null;
  if (!spec) return fail('execution_spec_missing');
  if (spec.schema_version !== 1) return fail('execution_spec_schema_unsupported');
  checks.push('execution_spec_present');

  // 5a. target = project:anima (sem deploy/integration/recurso externo).
  const target = asObject(spec.target);
  if (!target || target.kind !== 'project' || target.reference !== 'anima') return fail('target_not_project_anima');
  checks.push('target_project_anima');

  // 5b. executor = worktree isolada (teto de execução `review`; sem PR/merge/deploy/push por
  //     construção do executor ratificado).
  if (spec.executor !== 'worktree') return fail('executor_not_worktree');
  checks.push('executor_worktree');

  // 5c. coder/backend LOCAL autorizado (nunca `openai`, que é externo).
  const allowedBackends = input.allowedLocalCoderBackends ?? DEFAULT_AUTHORIZED_LOCAL_CODER_BACKENDS;
  if (!isNonBlankString(spec.coder_backend) || !allowedBackends.includes(spec.coder_backend)) {
    return fail('coder_backend_not_local_authorized');
  }
  checks.push('coder_backend_local');

  // 5d. base_sha autorizado presente (a worktree nasce deste SHA, não do HEAD futuro).
  if (!isNonBlankString(spec.base_sha)) return fail('base_sha_missing');
  checks.push('base_sha_present');

  // 5e. permissões: presentes e SUBCONJUNTO estrito de {workspace_read, workspace_write_isolated}
  //     → writes só no workspace isolado; sem filesystem arbitrário; sem credenciais; sem
  //     computer/browser; sem efeito externo (essas exigiriam permissões fora do conjunto).
  if (!isNonBlankStringArray(spec.permissions, 1)) return fail('permissions_missing');
  if (!spec.permissions.every((p) => ISOLATED_WORKSPACE_PERMISSIONS.includes(p))) {
    return fail('permissions_exceed_isolated_workspace');
  }
  checks.push('permissions_isolated_workspace');

  // 5f. validation/gates presentes e bem-formados (o resultado será verificável).
  const criteria = spec.validation_criteria;
  if (!Array.isArray(criteria) || criteria.length === 0) return fail('validation_criteria_missing');
  for (const c of criteria) {
    const co = asObject(c);
    if (!co || !isNonBlankString(co.label) || !isNonBlankString(co.command)) return fail('validation_criteria_malformed');
  }
  checks.push('validation_criteria_present');

  // 5g. limites de execução coerentes (defesa em profundidade contra loop ilimitado).
  const limits = asObject(spec.limits);
  if (!limits || !isPositiveInt(limits.max_attempts) || !isPositiveInt(limits.max_duration_minutes)) {
    return fail('limits_invalid');
  }
  checks.push('limits_valid');

  // 6. proposal.data.included_scope: presente, não-vazio, sem caminho inseguro/sensível.
  const proposalObj = asObject(input.proposal);
  const data = proposalObj ? asObject(proposalObj.data) : null;
  const includedScope = data ? data.included_scope : undefined;
  if (!isNonBlankStringArray(includedScope, 1)) return fail('included_scope_missing');

  const sensitivePrefixes = (input.securitySensitivePathPrefixes ?? DEFAULT_SECURITY_SENSITIVE_PATH_PREFIXES).map(normalizePath);
  for (const raw of includedScope) {
    const path = normalizePath(raw);
    // Sem escape de caminho / absoluto (defesa em profundidade além das guardas do worktree).
    if (path.includes('..') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return fail('unsafe_scope_path');
    // Sem mutação de política de segurança (a própria policy, migrations, harness).
    if (sensitivePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(prefix))) {
      return fail('security_sensitive_scope');
    }
  }
  checks.push('included_scope_safe');

  // 7. Resource Governor permite (mesma autoridade do laço; só `permit` autoriza trabalho novo).
  if (input.governorVerdict !== 'permit') return fail('governor_not_permit');
  checks.push('governor_permit');

  return {
    authorized: true,
    envelopeVersion: AUTONOMOUS_AUTHORIZATION_ENVELOPE_VERSION,
    sourceId: provenance.sourceId,
    checks,
  };
}
