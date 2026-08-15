import type { AutonomousValidationCriterion } from './eligibility';
import type { ProposalVersion, WorkItemId } from './types';
import { isAnimaWorktreeBranch, type WorktreeHandoffV1 } from './worktree-handoff';

// Verifier V0 — validação independente, pura e ADVISORY (governança
// `Supervisor → Executor → Reviewer/Verifier`, mapa de maturidade do PRD §1f.1).
//
// Este módulo NÃO integra, não aplica, não publica, não faz merge/PR/deploy, não
// altera estado de autorização, não muda o resultado do Executor e NÃO substitui
// a revisão humana nem os gates existentes. Ele apenas **confere** um resultado
// já produzido contra a evidência estruturada e persistida disponível, e emite um
// parecer verificável. É deliberadamente incapaz de autorizar qualquer efeito:
// não há `fs`, `child_process`, rede, relógio nem aleatoriedade aqui — dada a
// mesma evidência, o parecer é sempre o mesmo (determinístico, testável à
// exaustão).
//
// PRINCÍPIO. O Verifier não confia na prosa do Executor (`summary`, `validations`
// autodeclaradas). Ele re-deriva o parecer do **contrato autorizador** — a
// proposta aprovada (escopo incluído/excluído) e os critérios de validação
// declarados — cruzando-o com a evidência factual que o Executor produziu: os
// arquivos realmente alterados, os gates realmente executados (com seus códigos
// de saída) e a correlação da tentativa. A autoridade contra a qual se verifica é
// o contrato que o Executor NÃO pode redefinir, e é isso que torna a checagem
// independente.
//
// MATURIDADE. O parecer carrega contagens estruturadas (`violations`, `gaps`)
// justamente para, no futuro, sustentar uma política baseada em evidência
// (`Executor → Verifier → Humano` e, com histórico suficiente para uma classe,
// `Executor → Verifier → política automática`). V0 **não** implementa promoção
// automática nenhuma: o parecer é sempre advisory e o gate humano permanece
// obrigatório onde já é obrigatório.

/** Parecer de três valores. `verified` = evidência suficiente e coerente;
 * `inconclusive` = evidência insuficiente para concluir; `rejected` = evidência
 * que demonstra violação ou resultado incorreto. Fail-conservative: só há
 * `verified` quando tudo que é independentemente verificável passou. */
export type WorkVerificationVerdict = 'verified' | 'inconclusive' | 'rejected';

/** Severidade de cada achado, e a única entrada da derivação do veredito.
 * `violation` ⇒ rejected; senão `gap` ⇒ inconclusive; senão verified. */
export type WorkVerificationSeverity = 'ok' | 'gap' | 'violation';

export type WorkVerificationFindingCode =
  // Correlação da tentativa (INT-02).
  | 'correlation_verified'
  | 'correlation_mismatch'
  // Contenção de escopo — conferida contra a proposta aprovada, não contra o
  // relato do Executor.
  | 'scope_respected'
  | 'change_out_of_included_scope'
  | 'change_in_excluded_scope'
  // Gates realmente executados.
  | 'gates_passed'
  | 'gate_failed'
  | 'no_gates_present'
  // Cobertura dos critérios declarados por um gate factual.
  | 'criterion_covered'
  | 'criterion_without_gate_coverage'
  | 'declared_criterion_unverifiable'
  // Coerência do desfecho com os gates.
  | 'status_coherent'
  | 'status_contradicts_gates'
  | 'reported_failure'
  // Estrutura do handoff durável (INT-05).
  | 'branch_ownership_verified'
  | 'branch_not_owned'
  // Disponibilidade de evidência.
  | 'missing_result_evidence';

export interface WorkVerificationFinding {
  readonly code: WorkVerificationFindingCode;
  readonly severity: WorkVerificationSeverity;
  readonly detail: string;
  /** Fato auditável que gerou o achado (arquivo, rótulo de gate/critério), quando aplicável. */
  readonly subject?: string;
}

export interface WorkVerificationReport {
  readonly schemaVersion: 1;
  readonly verdict: WorkVerificationVerdict;
  // Correlação ESPERADA (do item/tentativa em curso), nunca inferida do handoff.
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  // Ordem estável e determinística: correlação, branch, escopo, status, gates,
  // cobertura de critérios. Auditável e reproduzível.
  readonly findings: readonly WorkVerificationFinding[];
  readonly summary: {
    readonly violations: number;
    readonly gaps: number;
    /** Total de achados (inclui os `ok`), para leitura rápida. */
    readonly checks: number;
  };
  /** Invariante do contrato: o parecer JAMAIS autoriza efeito nem dispensa o humano. */
  readonly advisory: true;
}

export interface WorkResultVerificationInput {
  /** Correlação esperada, derivada do item/tentativa — a autoridade sobre "qual"
   * resultado deveria ter sido produzido. */
  readonly expected: {
    readonly workItemId: WorkItemId;
    readonly attemptId: string;
    readonly approvedProposalVersion: ProposalVersion;
  };
  /** Contrato autorizador (proposta aprovada + execution_spec). É a autoridade
   * independente contra a qual a evidência produzida é conferida. */
  readonly authorized: {
    readonly includedScope: readonly string[];
    readonly excludedScope: readonly string[];
    readonly validationCriteria: readonly AutonomousValidationCriterion[];
  };
  /** Evidência git estruturada e durável (INT-05). `null` quando o resultado não
   * veio de uma execução de worktree: sem evidência independente, o parecer é
   * inconclusivo, nunca positivo. */
  readonly handoff: WorktreeHandoffV1 | null;
}

const norm = (path: string): string => path.replace(/\\/g, '/');
const nonBlankCommand = (criterion: AutonomousValidationCriterion): boolean =>
  typeof criterion.command === 'string' && criterion.command.trim().length > 0;

const ok = (code: WorkVerificationFindingCode, detail: string, subject?: string): WorkVerificationFinding =>
  subject === undefined ? { code, severity: 'ok', detail } : { code, severity: 'ok', detail, subject };
const gap = (code: WorkVerificationFindingCode, detail: string, subject?: string): WorkVerificationFinding =>
  subject === undefined ? { code, severity: 'gap', detail } : { code, severity: 'gap', detail, subject };
const violation = (code: WorkVerificationFindingCode, detail: string, subject?: string): WorkVerificationFinding =>
  subject === undefined ? { code, severity: 'violation', detail } : { code, severity: 'violation', detail, subject };

/**
 * Verifica, de forma pura e determinística, um resultado já produzido contra o
 * contrato que o autorizou. Devolve um parecer advisory com achados estruturados.
 *
 * Fail-conservative: qualquer violação demonstrada ⇒ `rejected`; qualquer lacuna
 * de evidência ⇒ `inconclusive`; só evidência completa e coerente ⇒ `verified`.
 * Um critério apenas declarado (sem comando) não pode ser confirmado por evidência
 * e é registrado como informativo — não bloqueia `verified`, mas fica visível para
 * o humano saber exatamente o que não foi verificado independentemente.
 */
export function verifyWorkResult(input: WorkResultVerificationInput): WorkVerificationReport {
  const { expected, authorized, handoff } = input;
  const findings: WorkVerificationFinding[] = [];

  if (handoff === null) {
    findings.push(gap('missing_result_evidence',
      'Não há handoff durável de worktree para conferir: sem evidência estruturada, o resultado não é independentemente verificável.'));
    return finalize(expected, findings);
  }

  // ---------- Correlação (INT-02) ----------
  if (handoff.workItemId !== expected.workItemId
    || handoff.attemptId !== expected.attemptId
    || handoff.approvedProposalVersion !== expected.approvedProposalVersion) {
    findings.push(violation('correlation_mismatch',
      `A evidência pertence a (${handoff.workItemId}/${handoff.attemptId}/v${handoff.approvedProposalVersion}), não à tentativa esperada (${expected.workItemId}/${expected.attemptId}/v${expected.approvedProposalVersion}).`));
  } else {
    findings.push(ok('correlation_verified', 'A evidência corresponde ao item, tentativa e versão aprovada esperados.'));
  }

  // ---------- Propriedade da branch (INT-05) ----------
  if (!isAnimaWorktreeBranch(handoff.branch)) {
    findings.push(violation('branch_not_owned',
      `A branch "${handoff.branch}" não pertence ao namespace de trabalho do Anima; a evidência não é atribuível a uma tentativa isolada.`, handoff.branch));
  } else {
    findings.push(ok('branch_ownership_verified', 'A evidência aponta uma branch descartável do namespace do Anima.', handoff.branch));
  }

  // ---------- Contenção de escopo (conferida contra a proposta aprovada) ----------
  const included = new Set(authorized.includedScope.map(norm));
  const excluded = new Set(authorized.excludedScope.map(norm));
  let scopeClean = true;
  for (const raw of handoff.changedFiles) {
    const path = norm(raw);
    if (excluded.has(path)) {
      findings.push(violation('change_in_excluded_scope',
        `O arquivo "${path}" foi alterado, mas está no escopo explicitamente excluído da proposta aprovada.`, path));
      scopeClean = false;
    } else if (!included.has(path)) {
      findings.push(violation('change_out_of_included_scope',
        `O arquivo "${path}" foi alterado, mas não pertence ao escopo incluído da proposta aprovada.`, path));
      scopeClean = false;
    }
  }
  if (scopeClean) {
    findings.push(ok('scope_respected', 'Todo arquivo alterado pertence ao escopo incluído e nenhum ao excluído.'));
  }

  // ---------- Coerência de desfecho com os gates ----------
  const failedGates = handoff.gates.filter(g => g.outcome === 'failed');
  if (handoff.status === 'failed') {
    findings.push(violation('reported_failure',
      'O próprio handoff declara desfecho de falha; um resultado que falhou não é um sucesso verificável.'));
  } else if (failedGates.length > 0) {
    // Defensivo: um WorktreeHandoffV1 válido já proíbe sucesso com gate reprovado;
    // se aparecer, é evidência adulterada/incoerente.
    findings.push(violation('status_contradicts_gates',
      'O handoff declara sucesso, mas carrega ao menos um gate reprovado — desfecho e evidência se contradizem.'));
  } else {
    findings.push(ok('status_coherent', 'O desfecho declarado é coerente com os gates registrados.'));
  }

  // ---------- Gates realmente executados ----------
  if (handoff.gates.length === 0) {
    findings.push(gap('no_gates_present',
      'Nenhum gate foi registrado: não há evidência factual de que a alteração foi validada.'));
  } else {
    for (const g of failedGates) {
      findings.push(violation('gate_failed',
        `O gate "${g.label}" (${g.command}) terminou com código ${g.exitCode}.`, g.label));
    }
    if (failedGates.length === 0) {
      findings.push(ok('gates_passed', `Todos os ${handoff.gates.length} gate(s) registrado(s) passaram.`));
    }
  }

  // ---------- Cobertura dos critérios declarados por um gate factual ----------
  // Cruzamento por RÓTULO: o Executor grava o rótulo do critério em cada gate, e
  // o rótulo não sofre normalização (diferente do comando). Um critério com
  // comando exige um gate correspondente aprovado; sem ele, a evidência é
  // insuficiente (lacuna). Um critério só declarado não é verificável por
  // evidência — informativo, não bloqueia `verified`.
  const passedByLabel = new Set(handoff.gates.filter(g => g.outcome === 'passed').map(g => g.label));
  const anyGateByLabel = new Set(handoff.gates.map(g => g.label));
  for (const criterion of authorized.validationCriteria) {
    if (!nonBlankCommand(criterion)) {
      findings.push(ok('declared_criterion_unverifiable',
        `O critério "${criterion.label}" foi apenas declarado (sem comando) e não é verificável por evidência; permanece a cargo do humano.`, criterion.label));
      continue;
    }
    if (passedByLabel.has(criterion.label)) {
      findings.push(ok('criterion_covered', `O critério "${criterion.label}" tem um gate correspondente aprovado.`, criterion.label));
    } else if (anyGateByLabel.has(criterion.label)) {
      // Existe gate com esse rótulo, mas não passou: já contabilizado como
      // `gate_failed` (violação). Não duplicamos o achado aqui.
      continue;
    } else {
      findings.push(gap('criterion_without_gate_coverage',
        `O critério "${criterion.label}" exige validação por comando, mas nenhum gate correspondente foi executado.`, criterion.label));
    }
  }

  return finalize(expected, findings);
}

const finalize = (
  expected: WorkResultVerificationInput['expected'],
  findings: readonly WorkVerificationFinding[],
): WorkVerificationReport => {
  const violations = findings.filter(f => f.severity === 'violation').length;
  const gaps = findings.filter(f => f.severity === 'gap').length;
  const verdict: WorkVerificationVerdict = violations > 0 ? 'rejected' : gaps > 0 ? 'inconclusive' : 'verified';
  return {
    schemaVersion: 1,
    verdict,
    workItemId: expected.workItemId,
    attemptId: expected.attemptId,
    approvedProposalVersion: expected.approvedProposalVersion,
    findings,
    summary: { violations, gaps, checks: findings.length },
    advisory: true,
  };
};
