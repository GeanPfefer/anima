import { containsSensitiveData } from './execution-attempt';
import { parseHostObservedCoderEvidence } from './host-observed-coder-evidence';
import { parseHostObservedGateEvidence } from './host-observed-gate-evidence';
import type { WorkEvent } from './types';
import type { Json } from '@anima/types';

// Resource Governor V0 — camada de EVIDÊNCIA (fatos observados).
//
// A distinção canônica do recorte, herdada do Verifier:
//
//   EVIDÊNCIA (custo/telemetria observados)  ≠  CLASSIFICAÇÃO (low/medium/high)  ≠
//   ADVISORY/DECISÃO (executar agora, adiar, exigir máquina exclusiva).
//
// Este arquivo cobre só a primeira camada: a menor representação HONESTA de "quanto
// custou rodar um workload" e "qual era a pressão da máquina num instante". Nada aqui
// classifica nem decide — são fatos. Princípio arquitetural do recorte:
//
//   observação real → evidência durável → classificação/advisory → histórico
//
// antes de `previsão → controle automático`. O V0 aprende com fatos; não trata
// thresholds como verdade universal e não concede autoridade nova.
//
// SEMENTE REAL: o sistema já observa `durationMs` por gate na evidência de gate
// observada pelo host (`HostObservedGateEvidenceV1`, append-only). Em vez de criar
// telemetria nova, o V0 DERIVA observações de custo desse log já persistido — custo
// zero de schema, totalmente determinístico. A telemetria de máquina (RAM/CPU) é um
// campo OPCIONAL e honesto: quando a fonte não a carrega, é simplesmente omitida.

/** Tipo/identidade do workload. Taxonomia aberta e provisória (a semente do V0 é
 * `gate`); o valor exato NÃO é política — só agrupa observações comparáveis. */
export type WorkloadKind = 'gate' | 'suite' | 'build' | 'typecheck' | 'coder' | 'container' | 'other';

/** Desfecho observado do workload. `unknown` quando a fonte não o determina. */
export type WorkloadOutcome = 'succeeded' | 'failed' | 'unknown';

const WORKLOAD_KINDS: ReadonlySet<WorkloadKind> = new Set<WorkloadKind>([
  'gate', 'suite', 'build', 'typecheck', 'coder', 'container', 'other',
]);
const WORKLOAD_OUTCOMES: ReadonlySet<WorkloadOutcome> = new Set<WorkloadOutcome>(['succeeded', 'failed', 'unknown']);

const MAX_COMMAND = 2000;
const MAX_REPO = 400;
const MAX_ID = 200;

/**
 * Snapshot barato do estado da máquina num instante. TODOS os campos de recurso são
 * OPCIONAIS e honestos: só presentes quando a fonte é barata e confiável NA PLATAFORMA
 * (ex.: `loadAvg1` é omitido no Windows, onde `os.loadavg()` retorna sempre 0 e não
 * significa nada). Preferimos campo ausente a número falsamente preciso.
 */
export interface MachineSnapshotV1 {
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly observer: 'host';
  readonly totalMemBytes?: number;
  readonly freeMemBytes?: number;
  readonly cpuCount?: number;
  readonly loadAvg1?: number;
}

/** Telemetria de recursos ao redor de um workload, quando barata e confiável.
 * Omitida pela derivação de gate (a evidência de gate não a carrega) — não forçamos. */
export interface WorkloadResourceSample {
  readonly memBeforeBytes?: number;
  readonly memAfterBytes?: number;
  readonly cpuCount?: number;
}

/**
 * Uma observação de custo de UM workload. A menor representação útil: identidade/tipo,
 * comando estável, repo/contexto (opcional), instante, duração, desfecho, proveniência
 * do observador e telemetria opcional. É FATO — não carrega classificação nem advisory.
 */
export interface WorkloadCostObservationV1 {
  readonly schemaVersion: 1;
  readonly workloadKind: WorkloadKind;
  readonly command: string;
  readonly repo?: string;
  readonly observedAt: string;
  readonly durationMs: number;
  readonly outcome: WorkloadOutcome;
  readonly observer: 'host';
  // Correlação opcional à execução de origem (presente quando derivada de uma tentativa).
  readonly workItemId?: string;
  readonly attemptId?: string;
  readonly resources?: WorkloadResourceSample;
}

export type WorkloadObservationDefect =
  | 'invalid_kind'
  | 'invalid_command'
  | 'invalid_duration'
  | 'invalid_outcome'
  | 'invalid_timestamp'
  | 'payload_too_large'
  | 'sensitive_data';

export type WorkloadObservationResult =
  | { readonly ok: true; readonly value: WorkloadCostObservationV1 }
  | { readonly ok: false; readonly defect: WorkloadObservationDefect; readonly explanation: string };

export interface BuildWorkloadCostObservationInput {
  readonly workloadKind: WorkloadKind;
  readonly command: string;
  readonly repo?: string | null;
  readonly observedAt: string;
  readonly durationMs: number;
  readonly outcome: WorkloadOutcome;
  readonly workItemId?: string | null;
  readonly attemptId?: string | null;
  readonly resources?: WorkloadResourceSample | null;
}

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isNonNegInt = (value: unknown): value is number => isInt(value) && (value as number) >= 0;
const isNonNegNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const fail = (defect: WorkloadObservationDefect, explanation: string): WorkloadObservationResult => ({ ok: false, defect, explanation });

const cleanResources = (sample: WorkloadResourceSample | null | undefined): WorkloadResourceSample | undefined => {
  if (sample === null || sample === undefined) return undefined;
  const out: { -readonly [K in keyof WorkloadResourceSample]: WorkloadResourceSample[K] } = {};
  if (isNonNegNumber(sample.memBeforeBytes)) out.memBeforeBytes = sample.memBeforeBytes;
  if (isNonNegNumber(sample.memAfterBytes)) out.memAfterBytes = sample.memAfterBytes;
  if (isNonNegInt(sample.cpuCount)) out.cpuCount = sample.cpuCount;
  return Object.keys(out).length > 0 ? out : undefined;
};

/**
 * Constrói e valida uma observação de custo. Fail-closed: tipo desconhecido, comando
 * em branco/grande demais, duração não finita ou negativa, desfecho inválido, timestamp
 * inválido ou dado sensível no comando/repo. Campos opcionais ausentes/nulos são
 * simplesmente omitidos (honestos), nunca inventados.
 */
export function buildWorkloadCostObservation(input: BuildWorkloadCostObservationInput): WorkloadObservationResult {
  if (!WORKLOAD_KINDS.has(input.workloadKind)) return fail('invalid_kind', 'O tipo de workload é desconhecido.');
  if (!nonBlank(input.command)) return fail('invalid_command', 'A observação exige um comando/identificador estável.');
  if (input.command.length > MAX_COMMAND) return fail('payload_too_large', 'O comando excede o tamanho permitido.');
  if (input.repo !== null && input.repo !== undefined) {
    if (!nonBlank(input.repo)) return fail('invalid_command', 'O repo/contexto, quando presente, não pode ser vazio.');
    if (input.repo.length > MAX_REPO) return fail('payload_too_large', 'O repo/contexto excede o tamanho permitido.');
  }
  if (!isNonNegNumber(input.durationMs)) return fail('invalid_duration', 'A duração precisa ser um número finito não negativo.');
  if (!WORKLOAD_OUTCOMES.has(input.outcome)) return fail('invalid_outcome', 'O desfecho precisa ser succeeded, failed ou unknown.');
  if (!nonBlank(input.observedAt) || Number.isNaN(Date.parse(input.observedAt))) {
    return fail('invalid_timestamp', 'observedAt precisa ser um instante ISO-8601 válido.');
  }
  for (const id of [input.workItemId, input.attemptId]) {
    if (id !== null && id !== undefined && (!nonBlank(id) || id.length > MAX_ID)) {
      return fail('invalid_command', 'workItemId/attemptId, quando presentes, precisam ser identificadores válidos.');
    }
  }
  if (containsSensitiveData(input.command) || (nonBlank(input.repo) && containsSensitiveData(input.repo))) {
    return fail('sensitive_data', 'A observação não pode carregar credenciais nem caminhos absolutos locais.');
  }
  const resources = cleanResources(input.resources);
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      workloadKind: input.workloadKind,
      command: input.command,
      ...(nonBlank(input.repo) ? { repo: input.repo } : {}),
      observedAt: input.observedAt,
      durationMs: input.durationMs,
      outcome: input.outcome,
      observer: 'host',
      ...(nonBlank(input.workItemId) ? { workItemId: input.workItemId } : {}),
      ...(nonBlank(input.attemptId) ? { attemptId: input.attemptId } : {}),
      ...(resources ? { resources } : {}),
    },
  };
}

const object = (value: Json | undefined): Record<string, Json | undefined> | null =>
  value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object' ? value : null;

/** Reconstrói uma observação do JSON persistido, fail-closed em qualquer elo inválido. */
export function parseWorkloadCostObservation(value: Json | undefined): WorkloadCostObservationV1 | null {
  const root = object(value);
  if (!root || root.schemaVersion !== 1) return null;
  const built = buildWorkloadCostObservation({
    workloadKind: root.workloadKind as WorkloadKind,
    command: root.command as string,
    repo: (root.repo as string | undefined) ?? null,
    observedAt: root.observedAt as string,
    durationMs: root.durationMs as number,
    outcome: root.outcome as WorkloadOutcome,
    workItemId: (root.workItemId as string | undefined) ?? null,
    attemptId: (root.attemptId as string | undefined) ?? null,
    resources: (object(root.resources) as WorkloadResourceSample | null) ?? null,
  });
  return built.ok ? built.value : null;
}

/** Reconstrói um snapshot de máquina do JSON persistido, fail-closed. */
export function parseMachineSnapshot(value: Json | undefined): MachineSnapshotV1 | null {
  const root = object(value);
  if (!root || root.schemaVersion !== 1 || root.observer !== 'host') return null;
  if (!nonBlank(root.capturedAt) || Number.isNaN(Date.parse(root.capturedAt as string))) return null;
  const num = (v: Json | undefined, predicate: (n: unknown) => n is number): number | undefined =>
    predicate(v) ? (v as number) : undefined;
  const totalMemBytes = num(root.totalMemBytes, isNonNegNumber);
  const freeMemBytes = num(root.freeMemBytes, isNonNegNumber);
  const cpuCount = num(root.cpuCount, isNonNegInt);
  const loadAvg1 = num(root.loadAvg1, (n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  return {
    schemaVersion: 1,
    capturedAt: root.capturedAt as string,
    observer: 'host',
    ...(totalMemBytes !== undefined ? { totalMemBytes } : {}),
    ...(freeMemBytes !== undefined ? { freeMemBytes } : {}),
    ...(cpuCount !== undefined ? { cpuCount } : {}),
    ...(loadAvg1 !== undefined ? { loadAvg1 } : {}),
  };
}

/** Mapeia o desfecho de um gate observado para o desfecho de custo do workload. */
const outcomeFromGate = (gateOutcome: 'passed' | 'failed'): WorkloadOutcome =>
  gateOutcome === 'passed' ? 'succeeded' : 'failed';

/**
 * DERIVA observações de custo de workload do log append-only já persistido — a semente
 * real do V0. Percorre TODOS os `host_observed_gate_evidence_recorded` (não só o mais
 * recente: o histórico atravessa tentativas), reconstrói cada evidência, cruza a
 * correlação contra o envelope do próprio evento e emite UMA observação por gate,
 * reaproveitando o `durationMs` real que o host mediu.
 *
 * É uma função PURA e determinística do log: re-derivar do mesmo log dá o mesmo
 * conjunto (idempotente); tentativas distintas do mesmo comando viram observações
 * distintas (o histórico não é apagado nem colapsado).
 */
export function deriveWorkloadCostObservationsFromEvents(events: readonly WorkEvent[]): readonly WorkloadCostObservationV1[] {
  const observations: WorkloadCostObservationV1[] = [];
  for (const event of events) {
    if (event.type !== 'host_observed_gate_evidence_recorded') continue;
    const data = object(object(event.payload)?.data);
    const evidence = parseHostObservedGateEvidence(data?.evidence);
    if (!evidence) continue;
    // Envelope incoerente com a evidência: descarta (não confia cegamente no persistido).
    if (data?.work_item_id !== evidence.workItemId
      || data?.attempt_id !== evidence.attemptId
      || data?.approved_proposal_version !== evidence.approvedProposalVersion) {
      continue;
    }
    for (const gate of evidence.gates) {
      const built = buildWorkloadCostObservation({
        workloadKind: 'gate',
        command: gate.command,
        observedAt: evidence.observedAt,
        durationMs: gate.durationMs,
        outcome: outcomeFromGate(gate.outcome),
        workItemId: evidence.workItemId,
        attemptId: evidence.attemptId,
      });
      if (built.ok) observations.push(built.value);
    }
  }
  return observations;
}

/**
 * DERIVA observações de custo do CODER do log append-only já persistido (evidência do
 * coder observada pelo host — reaproveita a duração wall-clock que o host cronometrou ao
 * redor de `backend.edit()`). Uma observação por evento (uma edição de coder por tentativa),
 * com `workloadKind: 'coder'` e `command` = `backendId` (a identidade estável do workload).
 *
 * Coexistência SEM mistura: a chave de perfil é `(kind, command, repo)`, então observações
 * de coder (`kind='coder'`, `command='ollama-coder'`) formam perfis SEPARADOS das de gate
 * (`kind='gate'`, `command='npm test'`) — proveniência preservada, workloads incompatíveis
 * nunca somados.
 *
 * Cancelamento é PULADO: uma edição abortada por fora (não pelo próprio workload) tem duração
 * arbitrária — não é amostra de custo. A evidência bruta segue persistida e recomputável; o
 * histórico só agrega execuções que rodaram até o próprio término (succeeded/failed).
 *
 * É PURA e determinística do log (idempotente); tentativas distintas viram observações
 * distintas (o histórico não é apagado nem colapsado).
 */
export function deriveCoderWorkloadCostObservationsFromEvents(events: readonly WorkEvent[]): readonly WorkloadCostObservationV1[] {
  const observations: WorkloadCostObservationV1[] = [];
  for (const event of events) {
    if (event.type !== 'host_observed_coder_evidence_recorded') continue;
    const data = object(object(event.payload)?.data);
    const evidence = parseHostObservedCoderEvidence(data?.evidence);
    if (!evidence) continue;
    // Envelope incoerente com a evidência: descarta (não confia cegamente no persistido).
    if (data?.work_item_id !== evidence.workItemId
      || data?.attempt_id !== evidence.attemptId
      || data?.approved_proposal_version !== evidence.approvedProposalVersion) {
      continue;
    }
    if (evidence.outcome === 'cancelled') continue;
    const built = buildWorkloadCostObservation({
      workloadKind: 'coder',
      command: evidence.backendId,
      observedAt: evidence.observedAt,
      durationMs: evidence.durationMs,
      outcome: evidence.outcome === 'succeeded' ? 'succeeded' : 'failed',
      workItemId: evidence.workItemId,
      attemptId: evidence.attemptId,
    });
    if (built.ok) observations.push(built.value);
  }
  return observations;
}
