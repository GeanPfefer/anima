import { containsSensitiveData } from './execution-attempt';
import type { ProposalVersion, WorkEvent, WorkItemId } from './types';
import type { Json } from '@anima/types';

// Evidência do CODER OBSERVADA PELO HOST (custo wall-clock de primeira parte, sem
// confiar no provider — direção da visão §12).
//
// O eixo: assim como o host mede o `durationMs` real de cada gate que ele próprio
// executa (`HostObservedGateEvidenceV1`), o host pode medir o tempo de parede que o
// backend de código levou — ele inicia o relógio ANTES de `backend.edit()` e o encerra
// DEPOIS. Nada disso confia no provider: o LLM/Ollama/OpenAI não reporta nada aqui; é
// o host que cronometra a própria chamada. O `backendId` é a identidade estável do
// workload (o adaptador que o host invocou); a duração e o desfecho são fatos que o
// host observou diretamente.
//
// Proveniência explícita (visão §12):
//   host-observed duration  ≠  provider-reported duration  ≠  provider-reported tokens
// Este arquivo cobre SÓ a duração observada pelo host. Tokens/modelo do provider são
// uma mudança contratual separada e mais invasiva (não entram aqui).
//
// Semântica honesta do coder (diferente do gate): não há `exitCode`; a identidade é o
// `backendId` (não um comando de shell); o desfecho é `succeeded | failed | cancelled`,
// e `cancelled` é distinto — uma edição abortada no meio é uma MEDIÇÃO PARCIAL, não um
// workload que terminou falhando. Preservar essa distinção mantém a evidência recomputável
// sem colapsar um cancelamento num "failed" completo.
//
// Independência honesta: só é produzível quando o HOST cronometra a chamada (caminho
// worktree in-process). Um executor futuro que rode o coder num processo separado não
// gera esta evidência — e aí o custo host-observed do coder é honestamente ausente.

const MAX_BACKEND_ID = 200;

export type HostObservedCoderOutcome = 'succeeded' | 'failed' | 'cancelled';

const CODER_OUTCOMES: ReadonlySet<HostObservedCoderOutcome> = new Set<HostObservedCoderOutcome>([
  'succeeded', 'failed', 'cancelled',
]);

export interface HostObservedCoderEvidenceV1 {
  readonly schemaVersion: 1;
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  // Identidade estável do workload: o adaptador de código que o host invocou
  // (`CoderBackend.id`), ex.: 'ollama-coder', 'gpt-coder', 'scripted'.
  readonly backendId: string;
  // Tempo de parede que o HOST mediu ao redor de `backend.edit()` (convenção Date.now()).
  readonly durationMs: number;
  readonly outcome: HostObservedCoderOutcome;
  readonly observedAt: string;
}

/** O que o executor de worktree reporta pelo canal `onCoderObserved`: os fatos brutos
 * que o host mediu ao redor de `backend.edit()`. Correlação e `observedAt` são anexados
 * pela camada de persistência, não pelo executor. */
export interface ObservedCoderInput {
  readonly backendId: string;
  readonly durationMs: number;
  readonly outcome: HostObservedCoderOutcome;
}

export interface BuildHostObservedCoderEvidenceInput {
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  readonly backendId: string;
  readonly durationMs: number;
  readonly outcome: HostObservedCoderOutcome;
  readonly observedAt: string;
}

export type HostObservedCoderEvidenceDefect =
  | 'invalid_correlation'
  | 'invalid_backend'
  | 'invalid_duration'
  | 'invalid_outcome'
  | 'invalid_timestamp'
  | 'payload_too_large'
  | 'sensitive_data';

export type HostObservedCoderEvidenceResult =
  | { readonly ok: true; readonly value: HostObservedCoderEvidenceV1 }
  | { readonly ok: false; readonly defect: HostObservedCoderEvidenceDefect; readonly explanation: string };

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const positiveVersion = (value: unknown): value is number => isInt(value) && (value as number) > 0;

const fail = (defect: HostObservedCoderEvidenceDefect, explanation: string): HostObservedCoderEvidenceResult =>
  ({ ok: false, defect, explanation });

/**
 * Constrói e valida a evidência do coder observada. Fail-closed: correlação incompleta,
 * backendId em branco/grande demais, duração não inteira ou negativa, desfecho fora do
 * conjunto, timestamp inválido ou dado sensível no backendId. O desfecho é uma OBSERVAÇÃO
 * direta do host (a chamada resolveu, lançou ou foi abortada) — o host é a autoridade
 * sobre o próprio `await backend.edit()`, então é aceito (validado no conjunto), não
 * derivado de um fato mais primitivo como no gate.
 */
export function buildHostObservedCoderEvidence(input: BuildHostObservedCoderEvidenceInput): HostObservedCoderEvidenceResult {
  if (!nonBlank(input.workItemId) || !nonBlank(input.attemptId) || !positiveVersion(input.approvedProposalVersion)) {
    return fail('invalid_correlation', 'A evidência do coder exige item, tentativa e versão aprovada válidos.');
  }
  if (!nonBlank(input.backendId)) return fail('invalid_backend', 'A evidência do coder exige um backendId estável.');
  if (input.backendId.length > MAX_BACKEND_ID) return fail('payload_too_large', 'O backendId excede o tamanho permitido.');
  if (!isInt(input.durationMs) || input.durationMs < 0) {
    return fail('invalid_duration', 'A duração precisa ser um inteiro de milissegundos não negativo.');
  }
  if (!CODER_OUTCOMES.has(input.outcome)) {
    return fail('invalid_outcome', 'O desfecho precisa ser succeeded, failed ou cancelled.');
  }
  if (!nonBlank(input.observedAt) || Number.isNaN(Date.parse(input.observedAt))) {
    return fail('invalid_timestamp', 'observedAt precisa ser um instante ISO-8601 válido.');
  }
  if (containsSensitiveData(input.backendId)) {
    return fail('sensitive_data', 'A evidência do coder não pode carregar credenciais nem caminhos absolutos locais.');
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      workItemId: input.workItemId,
      attemptId: input.attemptId,
      approvedProposalVersion: input.approvedProposalVersion,
      backendId: input.backendId,
      durationMs: input.durationMs,
      outcome: input.outcome,
      observedAt: input.observedAt,
    },
  };
}

const object = (value: Json | undefined): Record<string, Json | undefined> | null =>
  value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object' ? value : null;

/**
 * Reconstrói a evidência do coder do JSON persistido, fail-closed em qualquer elo
 * malformado, incoerente, acima dos limites ou com segredo. Reaproveita o construtor
 * (uma só régua de validação), então o parse não pode aceitar o que o build recusa.
 */
export function parseHostObservedCoderEvidence(value: Json | undefined): HostObservedCoderEvidenceV1 | null {
  const root = object(value);
  if (!root || root.schemaVersion !== 1) return null;
  const built = buildHostObservedCoderEvidence({
    workItemId: root.workItemId as WorkItemId,
    attemptId: root.attemptId as string,
    approvedProposalVersion: root.approvedProposalVersion as ProposalVersion,
    backendId: root.backendId as string,
    durationMs: root.durationMs as number,
    outcome: root.outcome as HostObservedCoderOutcome,
    observedAt: root.observedAt as string,
  });
  return built.ok ? built.value : null;
}

/**
 * Projeta a evidência do coder observada mais recente do log, cruzando a correlação
 * declarada contra o envelope do próprio evento `host_observed_coder_evidence_recorded`
 * (o executor não a produz: `author=system`/`origin=host`). `null` quando ausente ou
 * incoerente.
 */
export function projectHostObservedCoderEvidence(events: readonly WorkEvent[]): HostObservedCoderEvidenceV1 | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.type !== 'host_observed_coder_evidence_recorded') continue;
    const data = object(object(event.payload)?.data);
    const evidence = parseHostObservedCoderEvidence(data?.evidence);
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
