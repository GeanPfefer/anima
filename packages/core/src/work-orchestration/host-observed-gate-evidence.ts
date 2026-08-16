import { containsSensitiveData } from './execution-attempt';
import type { ProposalVersion, WorkEvent, WorkItemId } from './types';
import type { Json } from '@anima/types';

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
}

export interface HostObservedGateEvidenceV1 {
  readonly schemaVersion: 1;
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  // Na ordem de execução observada (determinística para a mesma tentativa).
  readonly gates: readonly ObservedGateOutcomeV1[];
  readonly observedAt: string;
  readonly coverage: { readonly gates: true };
}

export interface ObservedGateInput {
  readonly label: string;
  readonly command: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

export interface BuildHostObservedGateEvidenceInput {
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  readonly gates: readonly ObservedGateInput[];
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

/** Desfecho derivado dos fatos observados — a única fonte de `outcome`. */
export const deriveObservedGateOutcome = (gate: { exitCode: number; timedOut: boolean; cancelled: boolean }): ObservedGateResult =>
  gate.exitCode === 0 && !gate.timedOut && !gate.cancelled ? 'passed' : 'failed';

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
    gates.push({
      label: gate.label, command: gate.command, exitCode: gate.exitCode,
      durationMs: gate.durationMs, timedOut: gate.timedOut, cancelled: gate.cancelled,
      outcome: deriveObservedGateOutcome(gate),
    });
  }
  if (gates.some(gate => containsSensitiveData(gate.command) || containsSensitiveData(gate.label))) {
    return fail('sensitive_data', 'A evidência de gate não pode carregar credenciais nem caminhos absolutos locais.');
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      workItemId: input.workItemId,
      attemptId: input.attemptId,
      approvedProposalVersion: input.approvedProposalVersion,
      gates,
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
    gates.push({
      label: gate.label, command: gate.command, exitCode: gate.exitCode,
      durationMs: gate.durationMs, timedOut: gate.timedOut, cancelled: gate.cancelled,
      outcome: deriveObservedGateOutcome({ exitCode: gate.exitCode, timedOut: gate.timedOut, cancelled: gate.cancelled }),
    });
  }
  return {
    schemaVersion: 1,
    workItemId: root.workItemId,
    attemptId: root.attemptId,
    approvedProposalVersion: root.approvedProposalVersion,
    gates,
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
