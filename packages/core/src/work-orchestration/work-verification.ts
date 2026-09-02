import { readAutonomousExecutionSpec, type AutonomousValidationCriterion } from './eligibility';
import { projectHostObservedEvidence, type HostObservedGitEvidenceV1 } from './host-observed-evidence';
import { projectHostObservedGateEvidence, terminalObservedGates, type HostObservedGateEvidenceV1 } from './host-observed-gate-evidence';
import type { ProposalVersion, WorkEvent, WorkItem, WorkItemId, WorkResultValidation } from './types';
import { isAnimaWorktreeBranch, projectWorktreeHandoff, type WorktreeHandoffV1 } from './worktree-handoff';

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

/**
 * Proveniência da evidência sobre a qual um achado repousa — o eixo que separa o
 * que o Verifier estabelece de forma INDEPENDENTE do que ele apenas confere na
 * ATESTAÇÃO do Executor.
 *
 * - `independent`: repousa em fatos que o Executor não controla — o contrato
 *   aprovado (item/versão/escopo/critérios), a correlação amarrada pela
 *   persistência confiável (`begin_work_attempt` + a RPC de término que força o
 *   sinal a casar com a tentativa real), ou a ausência de evidência observada
 *   pelo próprio Verifier.
 * - `attested`: repousa em campos que o Executor colocou no sinal — arquivos
 *   alterados, diff, gates (outcome/exitCode), status, SHAs. O Verifier confere a
 *   COERÊNCIA interna e a consistência com o contrato, mas NÃO re-observa a
 *   execução. Um `verified` que repousa em evidência `attested` é
 *   "coerente e consistente com o contrato, DADO o que o Executor reportou" —
 *   nunca "provado independentemente". Ver o mapa de proveniência no registro
 *   2026-08-14-verifier-independencia.md.
 */
export type WorkVerificationProvenance = 'independent' | 'attested';

export type WorkVerificationFindingCode =
  // Correlação da tentativa (INT-02).
  | 'correlation_verified'
  | 'correlation_mismatch'
  // Contenção de escopo — conferida contra a proposta aprovada, não contra o
  // relato do Executor.
  | 'scope_respected'
  | 'change_out_of_included_scope'
  | 'change_in_excluded_scope'
  // Escopo conferido contra a evidência OBSERVADA pelo host (git), não a atestada.
  | 'scope_independently_observed'
  | 'attested_contradicts_observed'
  | 'observed_correlation_mismatch'
  // Gates realmente executados.
  | 'gates_passed'
  | 'gate_failed'
  | 'no_gates_present'
  // Contradição interna do gate: outcome vs código de saída observado.
  | 'gate_exit_code_incoherent'
  // Gates conferidos contra a evidência OBSERVADA pelo host (execução real), não a atestada.
  | 'gates_independently_observed'
  | 'attested_gate_contradicts_observed'
  | 'observed_gate_correlation_mismatch'
  // Cobertura dos critérios declarados por um gate factual.
  | 'criterion_covered'
  | 'criterion_without_gate_coverage'
  | 'acceptance_criterion_covered'
  | 'acceptance_criterion_without_evidence'
  | 'criterion_covers_unknown_acceptance'
  | 'declared_criterion_unverifiable'
  // Coerência do desfecho com os gates.
  | 'status_coherent'
  | 'status_contradicts_gates'
  | 'reported_failure'
  // Cross-check das validações autodeclaradas do resultado contra os gates.
  | 'validation_consistent_with_gates'
  | 'contradictory_validation_claim'
  // Estrutura do handoff durável (INT-05).
  | 'branch_ownership_verified'
  | 'branch_not_owned'
  // Disponibilidade de evidência.
  | 'missing_result_evidence';

export interface WorkVerificationFinding {
  readonly code: WorkVerificationFindingCode;
  readonly severity: WorkVerificationSeverity;
  readonly provenance: WorkVerificationProvenance;
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
    /** Achados que repousam em evidência atestada pelo Executor. */
    readonly attested: number;
    /** Achados que repousam em evidência independente do Executor. */
    readonly independent: number;
  };
  /**
   * Honestidade de independência: verdadeiro quando o veredito repousa, em algum
   * ponto necessário, sobre evidência ATESTADA pelo Executor (gates, arquivos,
   * status). Para um handoff de worktree, um `verified` é SEMPRE assim —
   * `gates_passed`/`scope_respected` são atestados. Um consumidor (política de
   * maturidade, humano) NUNCA deve tratar um `verified` com esta marca como prova
   * independente de que o resultado está correto; ela apenas atesta coerência e
   * consistência com o contrato, DADO o que o Executor reportou.
   */
  readonly restsOnAttestedEvidence: boolean;
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
    /** Critérios aprovados pelo humano (`proposal.data.expectedEffects`). */
    readonly acceptanceCriteria?: readonly string[];
  };
  /** Evidência git estruturada e durável (INT-05). `null` quando o resultado não
   * veio de uma execução de worktree: sem evidência independente, o parecer é
   * inconclusivo, nunca positivo. */
  readonly handoff: WorktreeHandoffV1 | null;
  /**
   * Validações AUTODECLARADAS pelo sinal `result` do Executor (opcional). Ambas
   * as fontes — estas e os gates do handoff — são atestadas pelo Executor, então
   * este cross-check pega inconsistência (Executor buggy ou adversário desleixado
   * que reporta validações discordantes dos próprios gates), NÃO um adversário
   * cuidadoso que as mantém consistentes. É defesa em profundidade, não prova de
   * independência. Ausente ⇒ o cross-check é omitido.
   */
  readonly declaredValidations?: readonly WorkResultValidation[];
  /**
   * Evidência OBSERVADA pelo host (git), independente do sinal do executor. Quando
   * presente e correlacionada, é a AUTORIDADE sobre quais arquivos foram alterados
   * (o git não mente): o escopo passa a ser conferido contra ela (proveniência
   * `independent`), e uma divergência entre o que o executor atestou e o que o host
   * observou é uma mentira detectada (`attested_contradicts_observed`). Ausente ⇒
   * o escopo recai na atestação (comportamento anterior), marcado como tal.
   */
  readonly observed?: HostObservedGitEvidenceV1 | null;
  /**
   * Evidência de GATE observada pelo host (desfechos reais que o host mediu ao
   * executar cada gate), independente do `worktreeHandoff.gates` atestado. Quando
   * presente e correlacionada, é a AUTORIDADE sobre o desfecho dos gates: um gate que
   * o host observou falhar reprova (proveniência `independent`), e uma divergência
   * entre o atestado e o observado é `attested_gate_contradicts_observed`. Ausente ⇒
   * os gates recaem na atestação (comportamento anterior). Malformada/de outra
   * tentativa ⇒ tratada como ausente/mismatch, nunca vira autoridade (fail-closed).
   */
  readonly observedGates?: HostObservedGateEvidenceV1 | null;
}

const norm = (path: string): string => path.replace(/\\/g, '/');
const nonBlankCommand = (criterion: AutonomousValidationCriterion): boolean =>
  typeof criterion.command === 'string' && criterion.command.trim().length > 0;

// Proveniência default = `attested` (conservador): tudo que descreve o que
// ACONTECEU repousa na atestação do Executor, salvo o que é marcado `independent`
// explicitamente (contrato aprovado, correlação amarrada, ausência observada).
const make = (severity: WorkVerificationSeverity) =>
  (code: WorkVerificationFindingCode, detail: string, subject?: string, provenance: WorkVerificationProvenance = 'attested'): WorkVerificationFinding =>
    subject === undefined ? { code, severity, provenance, detail } : { code, severity, provenance, detail, subject };
const ok = make('ok');
const gap = make('gap');
const violation = make('violation');

/**
 * Verifica, de forma pura e determinística, um resultado já produzido contra o
 * contrato que o autorizou. Devolve um parecer advisory com achados estruturados.
 *
 * Fail-conservative: qualquer violação demonstrada ⇒ `rejected`; qualquer lacuna
 * de evidência ⇒ `inconclusive`; só evidência completa e coerente ⇒ `verified`.
 * Cada critério aprovado precisa estar explicitamente associado a ao menos um gate
 * que passou. Ausência de associação é lacuna e impede `verified`.
 */
export function verifyWorkResult(input: WorkResultVerificationInput): WorkVerificationReport {
  const { expected, authorized, handoff } = input;
  const findings: WorkVerificationFinding[] = [];

  if (handoff === null) {
    findings.push(gap('missing_result_evidence',
      'Não há handoff durável de worktree para conferir: sem evidência estruturada, o resultado não é independentemente verificável.',
      undefined, 'independent'));
    return finalize(expected, findings);
  }

  // ---------- Correlação (INT-02) — independente: amarrada pela persistência ----------
  if (handoff.workItemId !== expected.workItemId
    || handoff.attemptId !== expected.attemptId
    || handoff.approvedProposalVersion !== expected.approvedProposalVersion) {
    findings.push(violation('correlation_mismatch',
      `A evidência pertence a (${handoff.workItemId}/${handoff.attemptId}/v${handoff.approvedProposalVersion}), não à tentativa esperada (${expected.workItemId}/${expected.attemptId}/v${expected.approvedProposalVersion}).`,
      undefined, 'independent'));
  } else {
    findings.push(ok('correlation_verified', 'A evidência corresponde ao item, tentativa e versão aprovada esperados.', undefined, 'independent'));
  }

  // ---------- Propriedade da branch (INT-05) ----------
  if (!isAnimaWorktreeBranch(handoff.branch)) {
    findings.push(violation('branch_not_owned',
      `A branch "${handoff.branch}" não pertence ao namespace de trabalho do Anima; a evidência não é atribuível a uma tentativa isolada.`, handoff.branch));
  } else {
    findings.push(ok('branch_ownership_verified', 'A evidência aponta uma branch descartável do namespace do Anima.', handoff.branch));
  }

  // ---------- Contenção de escopo ----------
  // Autoridade sobre "quais arquivos foram alterados": a evidência OBSERVADA pelo
  // host (git), quando presente e correlacionada — o executor não a controla. Sem
  // ela, recai na UNIÃO changedFiles∪diffSummary ATESTADA (comportamento anterior).
  const included = new Set(authorized.includedScope.map(norm));
  const excluded = new Set(authorized.excludedScope.map(norm));
  const attestedPaths = new Set<string>([
    ...handoff.changedFiles.map(norm),
    ...handoff.diffSummary.files.map(file => norm(file.path)),
  ]);
  const { observed } = input;
  const observedUsable = observed !== null && observed !== undefined
    && observed.workItemId === expected.workItemId
    && observed.attemptId === expected.attemptId
    && observed.approvedProposalVersion === expected.approvedProposalVersion;
  if (observed !== null && observed !== undefined && !observedUsable) {
    findings.push(violation('observed_correlation_mismatch',
      'A evidência observada pelo host não corresponde à tentativa esperada; o escopo recai na atestação.', undefined, 'independent'));
  }
  let scopePaths = attestedPaths;
  let scopeProvenance: WorkVerificationProvenance = 'attested';
  if (observedUsable) {
    scopeProvenance = 'independent';
    const observedFullPaths = new Set<string>([
      ...observed!.observedChangedFiles.map(norm),
      ...observed!.observedDiffSummary.files.map(file => norm(file.path)),
    ]);
    scopePaths = observed!.observedChangedFilesSinceStart
      ? new Set(observed!.observedChangedFilesSinceStart.map(norm))
      : observedFullPaths;
    // Mentira detectada: o executor atestou um conjunto diferente do observado, ou
    // um commit/base diferente. O git é a verdade — a divergência é violação.
    const same = attestedPaths.size === observedFullPaths.size && [...attestedPaths].every(p => observedFullPaths.has(p));
    if (!same || handoff.commitSha !== observed!.observedCommitSha || handoff.baseSha !== observed!.baseSha) {
      findings.push(violation('attested_contradicts_observed',
        'O que o executor atestou (arquivos/commit) diverge do que o host observou no git; a observação prevalece.', undefined, 'independent'));
    } else {
      findings.push(ok('scope_independently_observed',
        'Os arquivos alterados foram confirmados por observação independente do host no git.', undefined, 'independent'));
    }
  }
  let scopeClean = true;
  for (const path of scopePaths) {
    if (excluded.has(path)) {
      findings.push(violation('change_in_excluded_scope',
        `O arquivo "${path}" foi alterado, mas está no escopo explicitamente excluído da proposta aprovada.`, path, scopeProvenance));
      scopeClean = false;
    } else if (!included.has(path)) {
      findings.push(violation('change_out_of_included_scope',
        `O arquivo "${path}" foi alterado, mas não pertence ao escopo incluído da proposta aprovada.`, path, scopeProvenance));
      scopeClean = false;
    }
  }
  if (scopeClean) {
    findings.push(ok('scope_respected', 'Todo arquivo alterado pertence ao escopo incluído e nenhum ao excluído.', undefined, scopeProvenance));
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
  // Autoridade sobre o desfecho dos gates: a evidência OBSERVADA pelo host (execução
  // real), quando presente e correlacionada — o executor não a controla. Sem ela,
  // recai nos gates ATESTADOS do handoff (comportamento anterior).
  const observedGates = input.observedGates;
  const observedGatesUsable = observedGates !== null && observedGates !== undefined
    && observedGates.workItemId === expected.workItemId
    && observedGates.attemptId === expected.attemptId
    && observedGates.approvedProposalVersion === expected.approvedProposalVersion;
  if (observedGates !== null && observedGates !== undefined && !observedGatesUsable) {
    findings.push(violation('observed_gate_correlation_mismatch',
      'A evidência de gate observada pelo host não corresponde à tentativa esperada; os gates recaem na atestação.', undefined, 'independent'));
  }
  // Projeção TERMINAL: com retry INTERNO do MESMO attempt, a evidência bruta pode
  // conter FAIL→PASS do mesmo gate lógico (label+command). A EVIDÊNCIA persistida
  // preserva os dois (append-only, auditável); a CLASSIFICAÇÃO do estado ATUAL de
  // cada gate usa a ÚLTIMA observação. Sem isso, um FAIL histórico legítimo geraria
  // `gate_failed` para sempre mesmo após a correção aceita pelo host.
  const terminalGates = observedGatesUsable ? terminalObservedGates(observedGates!.gates) : [];
  if (observedGatesUsable) {
    // O host mediu os gates de primeira parte. O estado TERMINAL de cada gate lógico
    // reprova se falho; uma divergência por RÓTULO entre o atestado (handoff terminal)
    // e o observado terminal é a mentira detectada. A comparação é por `label` (não
    // label+command) porque o handoff atestado e a evidência observada podem gravar
    // formas ligeiramente diferentes do MESMO comando (ex.: `npm test` declarado vs a
    // forma normalizada executada); a identidade label+command é para a PROJEÇÃO
    // terminal (deduplicar turns do mesmo gate), não para casar as duas fontes.
    const attestedByLabel = new Map(handoff.gates.map(g => [g.label, g.outcome]));
    let anyGateProblem = false;
    for (const g of terminalGates) {
      if (g.outcome === 'failed') {
        const why = g.timedOut ? ' (timeout)' : g.cancelled ? ' (cancelado)' : '';
        findings.push(violation('gate_failed',
          `O host observou o gate "${g.label}" (${g.command}) terminar com código ${g.exitCode}${why}.`, g.label, 'independent'));
        anyGateProblem = true;
      }
      const attested = attestedByLabel.get(g.label);
      if (attested !== undefined && attested !== g.outcome) {
        findings.push(violation('attested_gate_contradicts_observed',
          `O executor atestou o gate "${g.label}" como "${attested}", mas o host observou "${g.outcome}"; a observação prevalece.`, g.label, 'independent'));
        anyGateProblem = true;
      }
    }
    if (!anyGateProblem) {
      findings.push(ok('gates_independently_observed',
        `Todos os ${terminalGates.length} gate(s) foram confirmados por observação independente do host (estado terminal).`, undefined, 'independent'));
    }
  } else {
    // Contradição interna adversarial: um gate "passed" com código de saída não-zero
    // é incoerente — passar significa código 0 (o inverso NÃO vale: um gate pode
    // falhar por timeout/cancelamento com código 0, então só checamos passed⟹0).
    // O contrato INT-05 (`buildWorktreeHandoff`) não força isso; o Verifier não
    // confia na coerência do handoff, ele a re-deriva.
    const incoherentGates = handoff.gates.filter(g => g.outcome === 'passed' && g.exitCode !== 0);
    for (const g of incoherentGates) {
      findings.push(violation('gate_exit_code_incoherent',
        `O gate "${g.label}" declara "passed", mas o código de saída observado é ${g.exitCode}; passar exige código 0.`, g.label));
    }
    if (handoff.gates.length === 0) {
      findings.push(gap('no_gates_present',
        'Nenhum gate foi registrado: não há evidência factual de que a alteração foi validada.'));
    } else {
      for (const g of failedGates) {
        findings.push(violation('gate_failed',
          `O gate "${g.label}" (${g.command}) terminou com código ${g.exitCode}.`, g.label));
      }
      if (failedGates.length === 0 && incoherentGates.length === 0) {
        findings.push(ok('gates_passed', `Todos os ${handoff.gates.length} gate(s) registrado(s) passaram com código 0.`));
      }
    }
  }

  // ---------- Cobertura dos critérios declarados por um gate factual ----------
  // Cruzamento por RÓTULO: um critério com comando exige um gate correspondente
  // aprovado; sem ele, a evidência é insuficiente (lacuna). Um critério só declarado
  // não é verificável por evidência — informativo, não bloqueia `verified`. A fonte
  // do desfecho é a observada quando usável, senão a atestada.
  const gateOutcomeSource: readonly { readonly label: string; readonly outcome: 'passed' | 'failed' }[] =
    observedGatesUsable ? terminalGates : handoff.gates;
  const passedByLabel = new Set(gateOutcomeSource.filter(g => g.outcome === 'passed').map(g => g.label));
  const anyGateByLabel = new Set(gateOutcomeSource.map(g => g.label));
  for (const criterion of authorized.validationCriteria) {
    if (!nonBlankCommand(criterion)) {
      findings.push(ok('declared_criterion_unverifiable',
        `O critério "${criterion.label}" foi apenas declarado (sem comando) e não é verificável por evidência; permanece a cargo do humano.`, criterion.label, 'independent'));
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

  // ---------- Cobertura do ACEITE aprovado ----------
  // `validationCriteria` diz quais gates existem; `acceptanceCriteria` diz o que o
  // humano aprovou. Sem esta segunda dimensão, gates podem cobrir perfeitamente a
  // si mesmos enquanto parte da intenção desaparece no planejamento (PIN-02).
  const acceptance = authorized.acceptanceCriteria ?? [];
  const acceptanceSet = new Set(acceptance);
  const coveredAcceptance = new Set<string>();
  for (const criterion of authorized.validationCriteria) {
    for (const covered of criterion.covers ?? []) {
      if (!acceptanceSet.has(covered)) {
        findings.push(violation('criterion_covers_unknown_acceptance',
          `O gate "${criterion.label}" declara cobrir um critério que não pertence ao aceite aprovado.`, covered, 'independent'));
      } else if (passedByLabel.has(criterion.label)) {
        coveredAcceptance.add(covered);
      }
    }
  }
  for (const approved of acceptance) {
    if (coveredAcceptance.has(approved)) {
      findings.push(ok('acceptance_criterion_covered',
        `O critério aprovado possui associação explícita com um gate executado e aprovado.`, approved));
    } else {
      findings.push(gap('acceptance_criterion_without_evidence',
        `O critério aprovado não possui associação com evidência de gate aprovada.`, approved, 'independent'));
    }
  }

  // ---------- Cross-check das validações autodeclaradas do resultado × gates ----------
  // Ambas as fontes são atestadas pelo Executor: isto pega inconsistência interna
  // (uma validação que discorda do próprio gate de mesmo rótulo), não fabrica
  // independência. Um `passed`/`failed` declarado que contradiz o outcome do gate
  // correspondente é evidência contraditória ⇒ violação.
  if (input.declaredValidations !== undefined) {
    const gateOutcomeByLabel = new Map(handoff.gates.map(g => [g.label, g.outcome]));
    let anyCrossChecked = false;
    for (const declared of input.declaredValidations) {
      const gateOutcome = gateOutcomeByLabel.get(declared.label);
      if (gateOutcome === undefined || declared.outcome === 'declared') continue;
      anyCrossChecked = true;
      if (declared.outcome !== gateOutcome) {
        findings.push(violation('contradictory_validation_claim',
          `O resultado declara "${declared.label} — ${declared.outcome}", mas o gate correspondente registrou "${gateOutcome}".`, declared.label));
      }
    }
    if (anyCrossChecked && !findings.some(f => f.code === 'contradictory_validation_claim')) {
      findings.push(ok('validation_consistent_with_gates', 'As validações autodeclaradas do resultado concordam com os gates registrados.'));
    }
  }

  return finalize(expected, findings);
}

/**
 * Composição a partir de fatos persistidos: deriva a entrada do Verifier de um
 * `WorkItem` + o log de `WorkEvent`, sem I/O nem estado externo, e produz o
 * parecer advisory.
 *
 * A AUTORIDADE independente vem do item: `workItemId` e `approvedProposalVersion`
 * são os do item (e não os do handoff), então uma evidência produzida sobre uma
 * versão de proposta obsoleta é detectada como `correlation_mismatch`. O escopo
 * autorizado vem da proposta aprovada; os critérios, do `execution_spec` lido de
 * forma independente do estado. A evidência ATESTADA vem de `projectWorktreeHandoff`
 * (o último `result_submitted` com handoff durável, já cruzado com o envelope do
 * evento). Ausência de handoff ⇒ inconclusivo, nunca positivo.
 *
 * A evidência OBSERVADA pelo host (git) vem de `projectHostObservedEvidence` (o
 * último `host_observed_evidence_recorded`, `author='system'`/`origin='host'`, que
 * o executor não produz). Quando presente e correlacionada, é a AUTORIDADE sobre
 * quais arquivos foram alterados: o escopo passa a ser conferido contra ela
 * (proveniência `independent`) e uma divergência entre atestado e observado vira a
 * mentira detectada `attested_contradicts_observed`. É assim que a cadeia fecha —
 * a composição viva (presentation) compara observed + attested sem I/O.
 */
export function verifyPersistedWorkResult(item: WorkItem, events: readonly WorkEvent[]): WorkVerificationReport {
  const handoff = projectWorktreeHandoff(events);
  const observed = projectHostObservedEvidence(events);
  const observedGates = projectHostObservedGateEvidence(events);
  const spec = readAutonomousExecutionSpec(item.intent);
  return verifyWorkResult({
    expected: {
      workItemId: item.id,
      // O handoff já foi cruzado com o envelope do evento por projectWorktreeHandoff;
      // quando ausente, a tentativa é irrelevante (o parecer já é inconclusivo).
      attemptId: handoff?.attemptId ?? '',
      approvedProposalVersion: item.proposalVersion,
    },
    authorized: {
      includedScope: item.proposal.data.includedScope,
      excludedScope: item.proposal.data.excludedScope,
      validationCriteria: spec?.validationCriteria ?? [],
      acceptanceCriteria: item.proposal.data.expectedEffects,
    },
    handoff,
    observed,
    observedGates,
  });
}

const finalize = (
  expected: WorkResultVerificationInput['expected'],
  findings: readonly WorkVerificationFinding[],
): WorkVerificationReport => {
  const violations = findings.filter(f => f.severity === 'violation').length;
  const gaps = findings.filter(f => f.severity === 'gap').length;
  const attested = findings.filter(f => f.provenance === 'attested').length;
  const verdict: WorkVerificationVerdict = violations > 0 ? 'rejected' : gaps > 0 ? 'inconclusive' : 'verified';
  // O veredito repousa em atestação quando algum achado NECESSÁRIO a ele é
  // atestado: para `verified`, os `ok` atestados (gates/escopo); para `rejected`,
  // a(s) violação(ões) atestada(s); para `inconclusive`, a(s) lacuna(s) atestada(s).
  const decisive: WorkVerificationSeverity = verdict === 'verified' ? 'ok' : verdict === 'rejected' ? 'violation' : 'gap';
  const restsOnAttestedEvidence = findings.some(f => f.severity === decisive && f.provenance === 'attested');
  return {
    schemaVersion: 1,
    verdict,
    workItemId: expected.workItemId,
    attemptId: expected.attemptId,
    approvedProposalVersion: expected.approvedProposalVersion,
    findings,
    summary: { violations, gaps, checks: findings.length, attested, independent: findings.length - attested },
    restsOnAttestedEvidence,
    advisory: true,
  };
};
