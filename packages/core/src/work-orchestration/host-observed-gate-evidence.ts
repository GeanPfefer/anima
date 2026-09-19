import { containsSensitiveData } from './execution-attempt';
import type { ProposalVersion, WorkEvent, WorkItemId } from './types';
import type { Json } from '@anima/types';
import { evaluateDifferentialEvidencePolicy, type DifferentialEvidencePolicyDecisionV0 } from './differential-evidence-policy';
import { evaluateEnforcementReadiness, type EnforcementReadinessDecisionV0 } from './enforcement-readiness-policy';
import { classifyChangeAuthorization, type ChangeAuthorizationEvidenceV1, type ChangeAuthorizationFactsV1 } from './change-authorization-evidence';
import type { WorkClaimKind } from './eligibility';

// Evidência de GATE OBSERVADA PELO HOST (independência de primeira parte, sem
// reexecução — decisão humana de 2026-08-16).
//
// O eixo: "o agente que executa não deve ser a única autoridade sobre o desfecho
// dos gates que validam seu próprio trabalho". Diferente do `WorktreeHandoffV1`
// (INT-05), onde o desfecho dos gates é ATESTADO — o executor coloca `gates` no
// sinal `result` —, esta evidência registra o que o HOST observou DIRETAMENTE no
// momento em que executou cada gate (`runGate` → `runProcess` → `spawn`, código de
// host, jamais o `CoderBackend`/LLM). O host não reexecuta nada: preserva como
// fato de primeira parte o `exitCode`/timeout/cancelamento/duração reais que já
// observou. Um executor que minta no seu `worktreeHandoff.gates` sobre um gate que
// falhou é contraditado por estes fatos.
//
// Independência honesta: isto só é produzível quando o HOST de fato executa o gate
// (caminho worktree in-process). Um executor futuro que rode seus próprios gates
// num processo separado não gera esta evidência — e aí `coverage.gates` seria
// honestamente falso para aquele executor. A presença desta evidência é o sinal de
// que os gates FORAM observados independentemente.

const MAX_GATES = 200;
const MAX_LABEL = 400;
const MAX_COMMAND = 2000;

export type ObservedGateResult = 'passed' | 'failed';

export interface DifferentialGateTargetFactV1 {
  readonly path: string;
  readonly existedAtBase: boolean;
  readonly changed: boolean;
  readonly kindAtBase?: 'file' | 'directory' | 'other' | 'missing';
}

export type GateTargetScopeVerificationV1 =
  | { readonly status: 'verified'; readonly verifiedTargetPaths: readonly string[] }
  | { readonly status: 'mismatch'; readonly verifiedTargetPaths: readonly string[]; readonly reason: 'declared_scope_differs_from_gate' }
  | { readonly status: 'unverified'; readonly verifiedTargetPaths: readonly []; readonly reason: 'gate_scope_not_concrete' | 'declared_target_not_exact_file' };

/**
 * Observação DIFERENCIAL de UM gate: o desfecho do MESMO gate (mesma identidade
 * label+command) medido pelo host contra o `base_sha` — o estado ANTES da mudança
 * —, mais os fatos ESTRUTURAIS que dizem se esse diferencial é interpretável com
 * confiança. É OPCIONAL e ADITIVO: evidência sem baseline continua idêntica.
 *
 * Contém SÓ fatos observados/estruturais; nenhuma interpretação de texto (stdout,
 * label, nome de teste). `baseOutcome` é DERIVADO (nunca aceito), como no gate.
 * `targetExistedAtBase`/`changeTouchedGateTargets` são medidos pelo host via git
 * (ex.: `git cat-file -e base:path`, `changedFiles ∩ alvo do gate`), nunca por regex.
 */
export interface DifferentialGateBaselineV1 {
  readonly baseExitCode: number;
  readonly baseTimedOut: boolean;
  readonly baseCancelled: boolean;
  /** DERIVADO de baseExitCode/timedOut/cancelled (nunca fornecido). */
  readonly baseOutcome: ObservedGateResult;
  /** O alvo exercitado pelo gate já existia no `base_sha`? (git, não heurística) */
  readonly targetExistedAtBase: boolean;
  /** A mudança tocou algum arquivo que o gate exercita/alveja? (changedFiles ∩ alvo) */
  readonly changeTouchedGateTargets: boolean;
  /** Fatos host-observados por path EXATO; nunca significam prefixo/diretório/glob. */
  readonly targets?: readonly DifferentialGateTargetFactV1[];
  readonly changedFiles?: readonly string[];
  readonly changedFilesWithinTargetScope?: readonly string[];
  readonly changedFilesOutsideTargetScope?: readonly string[];
  /** Relação independente comando↔targets. Ausente em evidência legada. */
  readonly scopeVerification?: GateTargetScopeVerificationV1;
}

/**
 * Status diferencial de um gate — o QUE o diferencial base×resultado permite afirmar
 * estruturalmente. NÃO é prova de correção do comportamento; no máximo demonstra
 * DISCRIMINAÇÃO estrutural do gate em relação à mudança.
 *
 * - `discriminating`  : base FAIL → result PASS, alvo pré-existia no base e a mudança
 *   NÃO tocou o alvo do gate (o gate flipou por causa da mudança, não por editar o teste);
 * - `confounded`      : alvo novo/modificado, ou outra condição estrutural que impede
 *   interpretar o diferencial com confiança (inclui result não-PASS);
 * - `non_discriminating`: o gate já passava no base (verde independente da mudança);
 * - `inconclusive`    : sem baseline (ou baseline insuficiente).
 */
export type DifferentialGateStatus =
  | 'discriminating'
  | 'confounded'
  | 'non_discriminating'
  | 'inconclusive';

export interface ObservedGateOutcomeV1 {
  readonly label: string;
  readonly command: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  // DERIVADO dos fatos observados (nunca fornecido): passou ⟺ código 0 sem timeout
  // nem cancelamento. Assim o desfecho não pode discordar do exitCode observado.
  readonly outcome: ObservedGateResult;
  /** Classe declarada do critério; metadado estrutural, nunca inferido do texto. */
  readonly claimKind?: WorkClaimKind;
  /**
   * Evidência diferencial OPCIONAL (mesmo gate no base_sha). Ausente ⇒ comportamento
   * idêntico ao anterior. Um baseline MALFORMADO é OMITIDO (nunca invalida o outcome
   * do resultado): o gate continua válido e a classificação cai em `inconclusive`.
   */
  readonly baseline?: DifferentialGateBaselineV1;
}

export interface HostObservedGateEvidenceV1 {
  readonly schemaVersion: 1;
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  // Na ordem de execução observada (determinística para a mesma tentativa).
  readonly gates: readonly ObservedGateOutcomeV1[];
  /** Telemetria somente: Policy V0 não é consumida por execução nem Verifier. */
  readonly shadowPolicyDecisions: readonly DifferentialEvidencePolicyDecisionV0[];
  /** Telemetria somente: Readiness V0 (shadow) — candidatura a enforcement autônomo
   * futuro, NUNCA consumida por execução/state machine. `changeAuthorization` fica
   * `unavailable` aqui: o gate não carrega o Change Authorization Scope. */
  readonly shadowReadinessDecisions: readonly EnforcementReadinessDecisionV0[];
  /** Change Authorization Evidence host-observada da attempt (OPCIONAL/aditivo).
   * Ausente ⇒ retrocompatível. RECOMPUTADA dos fatos brutos pelo parser. */
  readonly changeAuthorization?: ChangeAuthorizationEvidenceV1;
  readonly observedAt: string;
  readonly coverage: { readonly gates: true };
}

/** Baseline diferencial fornecido ao build (host). `baseOutcome` é DERIVADO no
 * build, nunca aceito aqui. Ausente ⇒ gate sem diferencial. */
export interface DifferentialGateBaselineInput {
  readonly baseExitCode: number;
  readonly baseTimedOut: boolean;
  readonly baseCancelled: boolean;
  readonly targetExistedAtBase?: boolean;
  readonly changeTouchedGateTargets?: boolean;
  readonly targets?: readonly DifferentialGateTargetFactV1[];
  readonly changedFiles?: readonly string[];
  readonly changedFilesWithinTargetScope?: readonly string[];
  readonly changedFilesOutsideTargetScope?: readonly string[];
  readonly scopeVerification?: GateTargetScopeVerificationV1;
}

export interface ObservedGateInput {
  readonly label: string;
  readonly command: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly claimKind?: WorkClaimKind;
  /** Baseline diferencial OPCIONAL do MESMO gate no base_sha. Malformado ⇒ omitido
   * (o gate permanece válido; nunca falha a evidência do resultado). */
  readonly baseline?: DifferentialGateBaselineInput;
}

export interface BuildHostObservedGateEvidenceInput {
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  readonly gates: readonly ObservedGateInput[];
  /** Fatos brutos de autorização de mudança (OPCIONAL). Classificados na build. */
  readonly changeAuthorization?: ChangeAuthorizationFactsV1;
  readonly observedAt: string;
}

export type HostObservedGateEvidenceDefect =
  | 'invalid_correlation'
  | 'invalid_gates'
  | 'invalid_timestamp'
  | 'payload_too_large'
  | 'sensitive_data';

export type HostObservedGateEvidenceResult =
  | { readonly ok: true; readonly value: HostObservedGateEvidenceV1 }
  | { readonly ok: false; readonly defect: HostObservedGateEvidenceDefect; readonly explanation: string };

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const positiveVersion = (value: unknown): value is number => isInt(value) && (value as number) > 0;
const exactRelativePath = (value: unknown): value is string => {
  if (!nonBlank(value) || value.includes('*') || value.includes('?')) return false;
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.endsWith('/') || /^[A-Za-z]:/.test(normalized)) return false;
  const segments = normalized.split('/');
  const lower = segments.map(segment => segment.toLowerCase());
  return !segments.includes('..') && !segments.includes('.') && segments.every(Boolean)
    && !lower.includes('.git') && !lower.includes('node_modules') && !lower.includes('.next') && !lower.includes('.worktrees')
    && !lower.some(segment => segment === '.env' || segment.startsWith('.env.'))
    && !/\.(?:pem|key|p12|pfx)$/i.test(normalized);
};
const exactPathList = (value: unknown): value is string[] => Array.isArray(value)
  && value.length <= 200 && value.every(exactRelativePath) && new Set(value).size === value.length;

/** Desfecho derivado dos fatos observados — a única fonte de `outcome`. */
export const deriveObservedGateOutcome = (gate: { exitCode: number; timedOut: boolean; cancelled: boolean }): ObservedGateResult =>
  gate.exitCode === 0 && !gate.timedOut && !gate.cancelled ? 'passed' : 'failed';

/**
 * Valida e normaliza UM baseline diferencial a partir de fatos crus (input do build
 * OU JSON persistido), DERIVANDO `baseOutcome`. Fail-closed: qualquer campo ausente/
 * malformado ⇒ `null` (o chamador OMITE o baseline, sem invalidar o gate). Nunca lê
 * texto — só inteiros/booleanos estruturais.
 */
export function deriveDifferentialBaseline(value: unknown): DifferentialGateBaselineV1 | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const b = value as Record<string, unknown>;
  if (!isInt(b.baseExitCode)
    || typeof b.baseTimedOut !== 'boolean' || typeof b.baseCancelled !== 'boolean') {
    return null;
  }
  let targets: DifferentialGateTargetFactV1[] | undefined;
  if (b.targets !== undefined) {
    if (!Array.isArray(b.targets) || b.targets.length === 0 || b.targets.length > 200) return null;
    targets = [];
    for (const raw of b.targets) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
      const target = raw as Record<string, unknown>;
      const kindAtBase = target.kindAtBase;
      if (!exactRelativePath(target.path) || typeof target.existedAtBase !== 'boolean' || typeof target.changed !== 'boolean'
        || (kindAtBase !== undefined && !['file', 'directory', 'other', 'missing'].includes(kindAtBase as string))) return null;
      targets.push({ path: target.path, existedAtBase: target.existedAtBase, changed: target.changed,
        ...(kindAtBase === undefined ? {} : { kindAtBase: kindAtBase as DifferentialGateTargetFactV1['kindAtBase'] }) });
    }
    if (new Set(targets.map(target => target.path)).size !== targets.length) return null;
  }
  const targetExistedAtBase = targets ? targets.every(target => target.existedAtBase) : b.targetExistedAtBase;
  const changeTouchedGateTargets = targets ? targets.some(target => target.changed) : b.changeTouchedGateTargets;
  if (typeof targetExistedAtBase !== 'boolean' || typeof changeTouchedGateTargets !== 'boolean') return null;

  const changedFiles = b.changedFiles;
  const within = b.changedFilesWithinTargetScope;
  const outside = b.changedFilesOutsideTargetScope;
  if ((changedFiles !== undefined || within !== undefined || outside !== undefined)
    && (!exactPathList(changedFiles) || !exactPathList(within) || !exactPathList(outside)
      || changedFiles.length !== within.length + outside.length
      || [...within, ...outside].some(path => !changedFiles.includes(path)))) return null;
  if (targets && changedFiles !== undefined) {
    const declared = new Set(targets.map(target => target.path));
    const derivedWithin = changedFiles.filter(path => declared.has(path));
    const derivedOutside = changedFiles.filter(path => !declared.has(path));
    if (JSON.stringify(within) !== JSON.stringify(derivedWithin) || JSON.stringify(outside) !== JSON.stringify(derivedOutside)) return null;
  }

  let scopeVerification: GateTargetScopeVerificationV1 | undefined;
  if (b.scopeVerification !== undefined) {
    if (typeof b.scopeVerification !== 'object' || b.scopeVerification === null || Array.isArray(b.scopeVerification)) return null;
    const verification = b.scopeVerification as Record<string, unknown>;
    if (!exactPathList(verification.verifiedTargetPaths)) return null;
    if (verification.status === 'verified') {
      if (verification.verifiedTargetPaths.length === 0) return null;
      scopeVerification = { status: 'verified', verifiedTargetPaths: verification.verifiedTargetPaths };
    } else if (verification.status === 'mismatch' && verification.reason === 'declared_scope_differs_from_gate') {
      scopeVerification = { status: 'mismatch', verifiedTargetPaths: verification.verifiedTargetPaths, reason: 'declared_scope_differs_from_gate' };
    } else if (verification.status === 'unverified'
      && (verification.reason === 'gate_scope_not_concrete' || verification.reason === 'declared_target_not_exact_file')
      && verification.verifiedTargetPaths.length === 0) {
      scopeVerification = { status: 'unverified', verifiedTargetPaths: [], reason: verification.reason };
    } else return null;
  }
  if (scopeVerification && targets) {
    const declared = targets.map(target => target.path).sort();
    const verified = [...scopeVerification.verifiedTargetPaths].sort();
    const equal = declared.length === verified.length && declared.every((path, index) => path === verified[index]);
    if ((scopeVerification.status === 'verified' && !equal) || (scopeVerification.status === 'mismatch' && equal)) return null;
  } else if (scopeVerification && !targets) return null;
  return {
    baseExitCode: b.baseExitCode,
    baseTimedOut: b.baseTimedOut,
    baseCancelled: b.baseCancelled,
    baseOutcome: deriveObservedGateOutcome({ exitCode: b.baseExitCode, timedOut: b.baseTimedOut, cancelled: b.baseCancelled }),
    targetExistedAtBase,
    changeTouchedGateTargets,
    ...(targets ? { targets } : {}),
    ...(changedFiles !== undefined ? {
      changedFiles, changedFilesWithinTargetScope: within as string[], changedFilesOutsideTargetScope: outside as string[],
    } : {}),
    ...(scopeVerification ? { scopeVerification } : {}),
  };
}

/**
 * Classifica o status DIFERENCIAL de um gate a partir SÓ de fatos estruturais
 * (outcome base, outcome resultado, existência/toque do alvo). Puro, determinístico,
 * sem heurística de texto. NÃO promove nada a "comportamento substantivo provado"
 * nem a `covered` — é telemetria de confiança, lida por política futura.
 *
 * Ordem de decisão (fail-closed conservador):
 *  1. sem baseline               → inconclusive;
 *  2. alvo novo OU tocado         → confounded (o RED do base pode ser trivial:
 *     ex. "no tests found" de um teste novo, ou o próprio teste foi editado);
 *  3. base já PASS                → non_discriminating (verde independente da mudança);
 *  4. base FAIL ∧ result PASS     → discriminating (flip limpo atribuível à mudança);
 *  5. caso restante (result não-PASS) → confounded (sem PASS a creditar).
 */
export function classifyDifferentialGate(gate: ObservedGateOutcomeV1): DifferentialGateStatus {
  const b = gate.baseline;
  if (!b) return 'inconclusive';
  // Planner-declared targetPaths sozinho não é prova de cobertura. Evidência legada,
  // gate amplo ou divergência comando↔declaração permanecem inconclusivos.
  if (b.scopeVerification?.status !== 'verified') return 'inconclusive';
  if (!b.targetExistedAtBase || b.changeTouchedGateTargets) return 'confounded';
  if (b.baseOutcome === 'passed') return 'non_discriminating';
  if (b.baseOutcome === 'failed' && gate.outcome === 'passed') return 'discriminating';
  return 'confounded';
}

/**
 * Projeção TERMINAL dos gates observados: para gates com a MESMA identidade lógica
 * (`label` + `command`), mantém a ÚLTIMA observação — o estado terminal depois de
 * eventuais retries INTERNOS do MESMO attempt (FAIL→PASS). Preserva a ordem de
 * PRIMEIRA aparição de cada identidade, para leitura determinística.
 *
 * É SÓ uma projeção de leitura para a CLASSIFICAÇÃO terminal (Verifier): a
 * EVIDÊNCIA persistida permanece append-only e intacta — o histórico bruto
 * (o FAIL que precedeu o PASS) NÃO é apagado nem colapsado na fonte. EVIDÊNCIA ≠
 * CLASSIFICAÇÃO: quem quer o custo real (Resource Governor) continua lendo os gates
 * brutos; quem quer o estado terminal de um gate lógico usa esta projeção.
 */
export function terminalObservedGates(gates: readonly ObservedGateOutcomeV1[]): readonly ObservedGateOutcomeV1[] {
  const byIdentity = new Map<string, ObservedGateOutcomeV1>();
  const order: string[] = [];
  for (const gate of gates) {
    const key = `${gate.label} ${gate.command}`;
    if (!byIdentity.has(key)) order.push(key);
    byIdentity.set(key, gate); // a observação posterior (terminal) substitui a anterior
  }
  return order.map(key => byIdentity.get(key)!);
}

const fail = (defect: HostObservedGateEvidenceDefect, explanation: string): HostObservedGateEvidenceResult => ({ ok: false, defect, explanation });

/**
 * Constrói e valida a evidência de gate observada. Fail-closed: correlação
 * incompleta, nenhum gate, gate malformado (label/command em branco, exitCode/
 * duração não inteiros, flags não booleanas), timestamp inválido, tamanho acima do
 * teto ou dado sensível no comando/label. O `outcome` é DERIVADO, nunca aceito.
 */
export function buildHostObservedGateEvidence(input: BuildHostObservedGateEvidenceInput): HostObservedGateEvidenceResult {
  if (!nonBlank(input.workItemId) || !nonBlank(input.attemptId) || !positiveVersion(input.approvedProposalVersion)) {
    return fail('invalid_correlation', 'A evidência de gate exige item, tentativa e versão aprovada válidos.');
  }
  if (!Array.isArray(input.gates) || input.gates.length === 0) {
    return fail('invalid_gates', 'A evidência de gate precisa listar ao menos um gate observado.');
  }
  if (input.gates.length > MAX_GATES) {
    return fail('payload_too_large', 'A evidência de gate excede o número máximo de gates permitido.');
  }
  if (!nonBlank(input.observedAt) || Number.isNaN(Date.parse(input.observedAt))) {
    return fail('invalid_timestamp', 'observedAt precisa ser um instante ISO-8601 válido.');
  }
  const gates: ObservedGateOutcomeV1[] = [];
  for (const gate of input.gates) {
    if (typeof gate !== 'object' || gate === null
      || !nonBlank(gate.label) || !nonBlank(gate.command)
      || !isInt(gate.exitCode) || !isInt(gate.durationMs) || gate.durationMs < 0
      || typeof gate.timedOut !== 'boolean' || typeof gate.cancelled !== 'boolean') {
      return fail('invalid_gates', 'Cada gate observado precisa de label, command, exitCode/duração inteiros e flags booleanas.');
    }
    if (gate.label.length > MAX_LABEL || gate.command.length > MAX_COMMAND) {
      return fail('payload_too_large', 'Um campo da evidência de gate excede o limite de tamanho permitido.');
    }
    // Baseline OPCIONAL e ADITIVO: malformado ⇒ omitido (nunca falha o outcome do resultado).
    const baseline = gate.baseline === undefined ? null : deriveDifferentialBaseline(gate.baseline);
    gates.push({
      label: gate.label, command: gate.command, exitCode: gate.exitCode,
      durationMs: gate.durationMs, timedOut: gate.timedOut, cancelled: gate.cancelled,
      outcome: deriveObservedGateOutcome(gate),
      ...(gate.claimKind === undefined ? {} : { claimKind: gate.claimKind }),
      ...(baseline === null ? {} : { baseline }),
    });
  }
  if (gates.some(gate => containsSensitiveData(gate.command) || containsSensitiveData(gate.label))) {
    return fail('sensitive_data', 'A evidência de gate não pode carregar credenciais nem caminhos absolutos locais.');
  }
  const changeAuthorization = input.changeAuthorization === undefined ? undefined : classifyChangeAuthorization(input.changeAuthorization);
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      workItemId: input.workItemId,
      attemptId: input.attemptId,
      approvedProposalVersion: input.approvedProposalVersion,
      gates,
      shadowPolicyDecisions: gates.map(gate => evaluateDifferentialEvidencePolicy({ claimKind: gate.claimKind, gate })),
      shadowReadinessDecisions: gates.map(gate => evaluateEnforcementReadiness({ claimKind: gate.claimKind, gate, changeAuthorization })),
      ...(changeAuthorization === undefined ? {} : { changeAuthorization }),
      observedAt: input.observedAt,
      coverage: { gates: true },
    },
  };
}

const object = (value: Json | undefined): Record<string, Json | undefined> | null =>
  value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object' ? value : null;

/**
 * Reconstrói a evidência de gate do JSON persistido, fail-closed em qualquer elo
 * malformado, incoerente, acima dos limites ou com segredo. Recomputa o `outcome`
 * a partir dos fatos (não confia no `outcome` persistido).
 */
export function parseHostObservedGateEvidence(value: Json | undefined): HostObservedGateEvidenceV1 | null {
  const root = object(value);
  if (!root || root.schemaVersion !== 1) return null;
  const coverage = object(root.coverage);
  if (!coverage || coverage.gates !== true || !Array.isArray(root.gates) || root.gates.length === 0 || root.gates.length > MAX_GATES) return null;
  if (!nonBlank(root.workItemId) || !nonBlank(root.attemptId) || !positiveVersion(root.approvedProposalVersion)
    || !nonBlank(root.observedAt) || Number.isNaN(Date.parse(root.observedAt as string))) {
    return null;
  }
  const gates: ObservedGateOutcomeV1[] = [];
  for (const entry of root.gates) {
    const gate = object(entry);
    if (!gate || !nonBlank(gate.label) || !nonBlank(gate.command)
      || !isInt(gate.exitCode) || !isInt(gate.durationMs) || (gate.durationMs as number) < 0
      || typeof gate.timedOut !== 'boolean' || typeof gate.cancelled !== 'boolean') {
      return null;
    }
    if ((gate.label as string).length > MAX_LABEL || (gate.command as string).length > MAX_COMMAND) return null;
    if (containsSensitiveData(gate.command as string) || containsSensitiveData(gate.label as string)) return null;
    // Baseline OPCIONAL: ausente ⇒ retrocompatível (evidência antiga); presente mas
    // malformado ⇒ OMITIDO (não invalida o gate/evidência do resultado).
    const baseline = gate.baseline === undefined ? null : deriveDifferentialBaseline(gate.baseline);
    gates.push({
      label: gate.label, command: gate.command, exitCode: gate.exitCode,
      durationMs: gate.durationMs, timedOut: gate.timedOut, cancelled: gate.cancelled,
      outcome: deriveObservedGateOutcome({ exitCode: gate.exitCode, timedOut: gate.timedOut, cancelled: gate.cancelled }),
      ...(gate.claimKind === 'gate_assertion' || gate.claimKind === 'substantive' ? { claimKind: gate.claimKind } : {}),
      ...(baseline === null ? {} : { baseline }),
    });
  }
  const rawAuthorization = object(root.changeAuthorization);
  const changeAuthorization = rawAuthorization
    && Array.isArray(rawAuthorization.declaredScope) && rawAuthorization.declaredScope.every(entry => typeof entry === 'string')
    && Array.isArray(rawAuthorization.changedFiles) && rawAuthorization.changedFiles.every(entry => typeof entry === 'string')
    && (rawAuthorization.excludedScope === undefined
      || (Array.isArray(rawAuthorization.excludedScope) && rawAuthorization.excludedScope.every(entry => typeof entry === 'string')))
    ? classifyChangeAuthorization({
        declaredScope: rawAuthorization.declaredScope as readonly string[],
        excludedScope: (rawAuthorization.excludedScope as readonly string[] | undefined) ?? [],
        changedFiles: rawAuthorization.changedFiles as readonly string[],
      })
    : undefined;
  return {
    schemaVersion: 1,
    workItemId: root.workItemId,
    attemptId: root.attemptId,
    approvedProposalVersion: root.approvedProposalVersion,
    gates,
    shadowPolicyDecisions: gates.map(gate => evaluateDifferentialEvidencePolicy({ claimKind: gate.claimKind, gate })),
    shadowReadinessDecisions: gates.map(gate => evaluateEnforcementReadiness({ claimKind: gate.claimKind, gate, changeAuthorization })),
    ...(changeAuthorization === undefined ? {} : { changeAuthorization }),
    observedAt: root.observedAt as string,
    coverage: { gates: true },
  };
}

/**
 * Projeta a evidência de gate observada mais recente do log, cruzando a correlação
 * declarada contra o envelope do próprio evento `host_observed_gate_evidence_recorded`
 * (o executor não a produz: `author=system`/`origin=host`). `null` quando ausente
 * ou incoerente.
 */
export function projectHostObservedGateEvidence(events: readonly WorkEvent[]): HostObservedGateEvidenceV1 | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.type !== 'host_observed_gate_evidence_recorded') continue;
    const data = object(object(event.payload)?.data);
    const evidence = parseHostObservedGateEvidence(data?.evidence);
    if (!evidence) return null;
    if (data?.work_item_id !== evidence.workItemId
      || data?.attempt_id !== evidence.attemptId
      || data?.approved_proposal_version !== evidence.approvedProposalVersion) {
      return null;
    }
    return evidence;
  }
  return null;
}
