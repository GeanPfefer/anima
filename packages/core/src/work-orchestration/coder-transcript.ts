import type { SubmitGateStateV1 } from './agentic-runtime-policy';
import { containsSensitiveData } from './execution-attempt';

/**
 * Evento de RUNTIME do laço agêntico (Coding Harness V3): observabilidade da máquina
 * de estados de submit e das ações governadas (SEARCH/GLOB, EXEC/TEST, GIT/DIFF,
 * submit bloqueado/permitido). Fatos do HOST apenas — NUNCA conteúdo sensível: `detail`
 * carrega no máximo o programa + subcomando allowlistado (ex.: "npm test", "git diff"),
 * jamais a query de busca, args de caminho, stdout ou trecho de arquivo. Cada evento
 * fotografa o estado do gate e as revisões de prova no instante da ação.
 */
export interface CoderRuntimeEventV1 {
  readonly round: number;
  readonly kind: 'search' | 'glob' | 'exec' | 'test' | 'git_diff' | 'edit_applied' | 'submit_blocked' | 'submit_allowed';
  /** 'test' = validação focal listada; 'exec' = demais comandos. Resultado observado. */
  readonly result: 'served' | 'refused' | 'exit0' | 'exit_nonzero' | 'timeout' | 'blocked' | 'allowed' | 'empty_diff';
  readonly state: SubmitGateStateV1;
  readonly editRevision: number;
  readonly passedValidationRevision: number;
  readonly diffReviewedRevision: number;
  /** Rótulo curto, não-sensível (programa+subcomando allowlistado, ou vazio). */
  readonly detail: string;
}

/**
 * Observabilidade EXEC/TEST/GIT do Coding Harness V3 (aditiva, opcional). Diferente
 * do `CoderRuntimeEventV1` (fatos mínimos e livres de conteúdo), esta evidência é
 * DIAGNÓSTICA: comando, cwd lógico, exit code, stdout/stderr e diff da revisão —
 * SEMPRE bounded e redigidos de segredos pela régua compartilhada de sanitização,
 * com truncation explícita. Nunca autoridade; só reconstrução post-mortem.
 */
export interface CoderCommandObservationV1 {
  readonly round: number;
  readonly editRevision: number;
  readonly state: SubmitGateStateV1;
  readonly kind: 'exec' | 'test' | 'git_diff';
  /** Programa + subcomando + args, redigido e bounded (≤ 300). Sem segredo/caminho local. */
  readonly command: string;
  /** Rótulo LÓGICO do cwd (ex.: "worktree"); NUNCA caminho absoluto do host (≤ 120). */
  readonly cwd: string;
  readonly outcome: 'exit0' | 'exit_nonzero' | 'timeout' | 'refused';
  /** Exit code real; `null` quando recusado (não spawnou) — timeout preserva o que houver. */
  readonly exitCode: number | null;
  /** Motivo sanitizado quando a command policy recusou; caso contrário `null`. */
  readonly refusedReason: string | null;
  /** stdout redigido + bounded (tail; ≤ MAX). Pode ser ''. Em git_diff carrega o diff (head). */
  readonly stdout: string;
  /** stderr redigido + bounded (tail; ≤ MAX). Pode ser ''. */
  readonly stderr: string;
  /** Indicador explícito de truncation (linha OU char) de stdout/stderr. */
  readonly outputTruncated: boolean;
  /** sha256 da saída BRUTA (fingerprint estável da revisão/diff); `null` se sem saída. */
  readonly outputSha256: string | null;
}

/** Host facts only. No prompt, source text, search text, or literal anchor. */
export interface CoderTranscriptEntry {
  readonly step: number;
  readonly round: number;
  readonly phase: 'read' | 'edit' | 'application';
  readonly path: string;
  readonly operation: 'read' | 'replace_exact' | 'insert' | 'append' | 'create_file';
  readonly operationStep: number | null;
  readonly readRefs: readonly number[];
  readonly anchorReadRefs: readonly number[];
  readonly readHash: string | null;
  readonly expectedHash: string | null;
  readonly fingerprint: string;
  readonly normalizedFingerprint: string;
  readonly length: number;
  /** Only punctuation/whitespace survive; every other character becomes x. */
  readonly structure: string;
  readonly lines: readonly number[];
  readonly clipped: boolean;
  readonly rawMatchCount: number | null;
  readonly matchCount: number | null;
  readonly result: 'served' | 'stale_read' | 'invalid_anchor' | 'ambiguous_anchor' | 'normalized_match' | 'exact_match' | 'not_applicable' | 'applied' | 'batch_failed' | 'write_failed';
}

export interface CoderTranscript {
  readonly schemaVersion: 1;
  readonly call: number;
  readonly previousCall: number | null;
  readonly gateFingerprint: string | null;
  readonly diffFingerprint: string | null;
  readonly termination: string;
  readonly truncated: boolean;
  readonly entries: readonly CoderTranscriptEntry[];
  /**
   * Eventos de runtime da máquina de estados de submit (V3). OPCIONAL e ADITIVO:
   * transcripts antigos (e tarefas sem laço exec) não o carregam. Observabilidade,
   * nunca autoridade.
   */
  readonly runtimeEvents?: readonly CoderRuntimeEventV1[];
  /**
   * Observabilidade EXEC/TEST/GIT (V3). OPCIONAL e ADITIVO: bounded, redigida,
   * com truncation. Permite reconstruir stdout/stderr/exit/diff da revisão que
   * falhou sem expor segredos. Observabilidade, nunca autoridade.
   */
  readonly commandObservations?: readonly CoderCommandObservationV1[];
}

const hash = (v: unknown): boolean => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const natural = (v: unknown): boolean => Number.isSafeInteger(v) && Number(v) >= 0;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string): boolean => Object.keys(v).sort().join(',') === keys.split(',').sort().join(',');
const RUNTIME_EVENT_KINDS = ['search', 'glob', 'exec', 'test', 'git_diff', 'edit_applied', 'submit_blocked', 'submit_allowed'];
const RUNTIME_EVENT_RESULTS = ['served', 'refused', 'exit0', 'exit_nonzero', 'timeout', 'blocked', 'allowed', 'empty_diff'];
const SUBMIT_GATE_STATES = ['exploring', 'dirty_unvalidated', 'dirty_validated', 'ready_to_submit'];
const intOrNeg1 = (v: unknown): boolean => Number.isSafeInteger(v) && Number(v) >= -1;
function validRuntimeEvents(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 512) return false;
  return value.every(e => object(e)
    && exact(e, 'round,kind,result,state,editRevision,passedValidationRevision,diffReviewedRevision,detail')
    && natural(e.round) && RUNTIME_EVENT_KINDS.includes(String(e.kind)) && RUNTIME_EVENT_RESULTS.includes(String(e.result))
    && SUBMIT_GATE_STATES.includes(String(e.state))
    && natural(e.editRevision) && intOrNeg1(e.passedValidationRevision) && intOrNeg1(e.diffReviewedRevision)
    // `detail` é não-sensível por construção: só charset seguro (palavra/espaço/.-@:=+), curto.
    && typeof e.detail === 'string' && e.detail.length <= 120 && /^[\w .@:=+/-]*$/.test(e.detail));
}
const OBSERVATION_KINDS = ['exec', 'test', 'git_diff'];
const OBSERVATION_OUTCOMES = ['exit0', 'exit_nonzero', 'timeout', 'refused'];
/** Limites bounded da observação diagnóstica (defense-in-depth além da sanitização). */
export const COMMAND_OBSERVATION_STDOUT_MAX = 6000;
export const COMMAND_OBSERVATION_COMMAND_MAX = 300;
export const COMMAND_OBSERVATION_CWD_MAX = 120;
export const COMMAND_OBSERVATION_REASON_MAX = 300;
const safeInt = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v);
// Segredos que NUNCA devem sobreviver à sanitização (rede de segurança final; não
// dispara em `password=<redacted>` porque o valor já foi apagado).
const RESIDUAL_SECRET = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b|\bbearer\s+[a-z0-9._~+/-]{8,}=*)/i;
function validCommandObservations(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 256) return false;
  return value.every(o => object(o)
    && exact(o, 'round,editRevision,state,kind,command,cwd,outcome,exitCode,refusedReason,stdout,stderr,outputTruncated,outputSha256')
    && natural(o.round) && natural(o.editRevision) && SUBMIT_GATE_STATES.includes(String(o.state))
    && OBSERVATION_KINDS.includes(String(o.kind)) && OBSERVATION_OUTCOMES.includes(String(o.outcome))
    // command/cwd/refusedReason: curtos, controlados, sem segredo/caminho local.
    && typeof o.command === 'string' && o.command.length > 0 && o.command.length <= COMMAND_OBSERVATION_COMMAND_MAX && !containsSensitiveData(o.command)
    && typeof o.cwd === 'string' && o.cwd.length > 0 && o.cwd.length <= COMMAND_OBSERVATION_CWD_MAX && !containsSensitiveData(o.cwd)
    && (o.exitCode === null || safeInt(o.exitCode))
    && (o.refusedReason === null || (typeof o.refusedReason === 'string' && o.refusedReason.length <= COMMAND_OBSERVATION_REASON_MAX && !containsSensitiveData(o.refusedReason)))
    // stdout/stderr: bounded; a sanitização é a autoridade de redaction — a rede final
    // só rejeita segredos que jamais deveriam ter sobrevivido (chave privada/JWT/Bearer bruto).
    && typeof o.stdout === 'string' && o.stdout.length <= COMMAND_OBSERVATION_STDOUT_MAX && !RESIDUAL_SECRET.test(o.stdout)
    && typeof o.stderr === 'string' && o.stderr.length <= COMMAND_OBSERVATION_STDOUT_MAX && !RESIDUAL_SECRET.test(o.stderr)
    && typeof o.outputTruncated === 'boolean'
    && (o.outputSha256 === null || hash(o.outputSha256))
    // Coerência: recusado ⇒ sem exit code e COM motivo; caso contrário ⇒ sem motivo.
    && (String(o.outcome) === 'refused' ? (o.exitCode === null && typeof o.refusedReason === 'string') : o.refusedReason === null)
    && (String(o.outcome) === 'exit0' ? o.exitCode === 0 : true));
}
export function validCoderTranscripts(value: unknown): value is readonly CoderTranscript[] {
  if (!Array.isArray(value) || value.length > 16) return false;
  const BASE_KEYS = 'schemaVersion,call,previousCall,gateFingerprint,diffFingerprint,termination,truncated,entries'.split(',');
  const OPTIONAL_KEYS = new Set(['runtimeEvents', 'commandObservations']);
  return value.every(t => {
    if (!object(t)) return false;
    // Chaves: todas as BASE presentes; extras só as opcionais aditivas conhecidas.
    const keys = Object.keys(t);
    if (!BASE_KEYS.every(k => keys.includes(k)) || !keys.every(k => BASE_KEYS.includes(k) || OPTIONAL_KEYS.has(k))) return false;
    if (t.schemaVersion !== 1 || !natural(t.call) || (t.previousCall !== null && (!natural(t.previousCall) || Number(t.previousCall) >= Number(t.call)))
      || (t.gateFingerprint !== null && !hash(t.gateFingerprint)) || (t.diffFingerprint !== null && !hash(t.diffFingerprint))
      || typeof t.termination !== 'string' || !/^(returned|failed|ollama_[a-z_]+)$/.test(t.termination)
      || typeof t.truncated !== 'boolean' || !Array.isArray(t.entries) || t.entries.length > 256) return false;
    if ('runtimeEvents' in t && !validRuntimeEvents((t as Record<string, unknown>).runtimeEvents)) return false;
    if ('commandObservations' in t && !validCommandObservations((t as Record<string, unknown>).commandObservations)) return false;
    const entries: unknown[] = t.entries;
    return entries.every((e, i) => object(e)
      && exact(e, 'step,round,phase,path,operation,operationStep,readRefs,anchorReadRefs,readHash,expectedHash,fingerprint,normalizedFingerprint,length,structure,lines,clipped,rawMatchCount,matchCount,result')
      && e.step === i + 1 && natural(e.round)
      && ['read','edit','application'].includes(String(e.phase))
      && typeof e.path === 'string' && e.path.length > 0 && e.path.length <= 300 && !/[\u0000-\u001f\\:]/.test(e.path) && !e.path.startsWith('/') && !e.path.split('/').includes('..')
      && ['read','replace_exact','insert','append','create_file'].includes(String(e.operation))
      && (e.operationStep === null || (natural(e.operationStep) && Number(e.operationStep) > 0 && Number(e.operationStep) < Number(e.step)))
      && Array.isArray(e.readRefs) && e.readRefs.length <= 256 && e.readRefs.every(r => natural(r) && r > 0 && r < Number(e.step) && object(entries[r - 1]) && (entries[r - 1] as Record<string, unknown>).phase === 'read')
      && Array.isArray(e.anchorReadRefs) && e.anchorReadRefs.length <= 256 && e.anchorReadRefs.every(r => Array.isArray(e.readRefs) && e.readRefs.includes(r))
      && (e.readHash === null || hash(e.readHash)) && (e.expectedHash === null || hash(e.expectedHash))
      && hash(e.fingerprint) && hash(e.normalizedFingerprint) && natural(e.length)
      && typeof e.structure === 'string' && e.structure.length <= 160 && /^[x\s{}()[\];:,.='"+\-*/<>!?]*$/.test(e.structure)
      && Array.isArray(e.lines) && e.lines.length <= 200 && e.lines.every(natural)
      && typeof e.clipped === 'boolean' && (e.rawMatchCount === null || natural(e.rawMatchCount)) && (e.matchCount === null || natural(e.matchCount))
      && ['served','stale_read','invalid_anchor','ambiguous_anchor','normalized_match','exact_match','not_applicable','applied','batch_failed','write_failed'].includes(String(e.result)));
  });
}
