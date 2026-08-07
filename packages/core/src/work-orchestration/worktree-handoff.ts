import type { Json } from '@anima/types';
import { containsSensitiveData } from './execution-attempt';
import type { ProposalVersion, WorkEvent, WorkItemId } from './types';

// Handoff durável da execução em git worktree (ADR-001, Opção A).
//
// O `WorktreeExecutorAdapter` produz um resultado em `review`; este módulo
// estrutura o que torna esse resultado **durável, revisável e transferível** sem
// depender da worktree temporária continuar existindo. O conteúdo é embutido no
// sinal `result` do executor e persistido pela RPC de término em
// `data.executor_signal` (JSONB genérico, log append-only) — sobrevive a
// reinício do servidor e à remoção do diretório da worktree.
//
// NOMENCLATURA. Isto NÃO é o INT-03. O identificador INT-03 é canônico para a
// *fronteira de integração* — `IntegrationHandoff`/`IntegrationBoundaryStatus`
// em `integration-boundary.ts`, que decide aplicar/PR o resultado aceito, ainda
// em aberto no ADR-001. Este módulo é o **substrato de evidência git** que aquele
// passo vai consumir. Ele não decide integração, e — por construção — não aplica,
// não faz merge e não faz push: só importa tipos e a régua de sanitização; não
// há `fs`, `child_process` nem rede aqui.
//
// A branch descartável (`anima-work/<attemptId>`) é preservada como referência
// revisável (o patch vive nela, no `commitSha`); o handoff aponta para ela. Só
// branches sob este namespace pertencem ao Anima; qualquer outra é recusada, para
// nunca tratar trabalho humano como artefato descartável do Anima.

/** Namespace canônico das branches que o Anima cria e possui. */
export const ANIMA_WORKTREE_BRANCH_NAMESPACE = 'anima-work/';

/** Branches remotas que a publicação recusa incondicionalmente — nunca `main`. */
export const PROTECTED_PUBLISH_BRANCHES: ReadonlySet<string> = new Set([
  'main', 'master', 'develop', 'trunk', 'release', 'production', 'stable', 'HEAD',
]);

/** Uma branch é do Anima só quando está sob o namespace, sem traversal nem
 * espaços nem refspec perigosa. Fail-closed em qualquer ambiguidade. */
export const isAnimaWorktreeBranch = (branch: unknown): branch is string =>
  typeof branch === 'string'
  && branch.startsWith(ANIMA_WORKTREE_BRANCH_NAMESPACE)
  && branch.length > ANIMA_WORKTREE_BRANCH_NAMESPACE.length
  && !branch.includes('..')
  && !/[\s~^:?*[\\]/.test(branch)
  && !branch.endsWith('/')
  && !branch.endsWith('.lock');

// Limites de tamanho — um handoff é evidência estruturada, nunca um despejo de
// diff/stdout/stderr. Estourar qualquer limite é falha fechada (payload_too_large),
// para o log append-only não virar vetor de exfiltração nem inchar sem teto.
const MAX_IDENTIFIER = 256; // executor, backend, model, branch
const MAX_PATH = 400; // cada arquivo alterado / caminho no diff
const MAX_LABEL = 200; // rótulo do gate
const MAX_COMMAND = 400; // comando do gate
const MAX_ERROR = 4096; // erro seguro (stdout/stderr/mensagem já recortados)
const MAX_CHANGED_FILES = 2000;
const MAX_DIFF_FILES = 2000;
const MAX_GATES = 100;

export type WorktreePublicationState = 'local_only' | 'published';

/** Desfecho factual da execução em worktree. Sucesso exige todos os gates
 * aprovados; falha exige ao menos um gate reprovado (falha honesta, nunca
 * silenciosa). */
export type WorktreeExecutionStatus = 'succeeded' | 'failed';

export interface WorktreeGateOutcome {
  readonly label: string;
  readonly command: string;
  readonly exitCode: number;
  readonly outcome: 'passed' | 'failed';
}

/** Uma linha do `--numstat`. `insertions`/`deletions` = -1 quando binário. */
export interface WorktreeFileChange {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
}

export interface WorktreeDiffSummary {
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly files: readonly WorktreeFileChange[];
}

export interface WorktreeHandoffV1 {
  readonly schemaVersion: 1;
  // Correlação (INT-02): mesma tríade de qualquer artefato de tentativa.
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  // Inteligência que executou e escreveu o código.
  readonly executorId: string;
  readonly backendId: string;
  readonly model: string | null;
  // Referências git duráveis — a base autorizada, a branch preservada e o
  // commit produzido nela. Nunca pushados nem merjados aqui. O patch revisável
  // é `commitSha` na `branch`; o resumo abaixo é a evidência que sobrevive à
  // worktree sem carregar linhas cruas (logo, sem segredos embutidos no diff).
  readonly baseSha: string;
  readonly branch: string;
  readonly commitSha: string;
  // Desfecho factual e o erro seguro correspondente (só quando falhou).
  readonly status: WorktreeExecutionStatus;
  readonly safeError: string | null;
  // Diff estruturado (contagens), nunca o conteúdo bruto.
  readonly changedFiles: readonly string[];
  readonly diffSummary: WorktreeDiffSummary;
  // Comandos de gate e seus resultados factuais.
  readonly gates: readonly WorktreeGateOutcome[];
  // Metadados. SEM `createdAt` (INT-05): o instante durável vem do envelope do
  // evento persistido (a RPC de término carimba o `work_event`); embutir um
  // relógio de parede aqui quebraria o determinismo e a idempotência byte-a-byte
  // do sinal terminal na reentrega/reexecução.
  readonly publicationState: WorktreePublicationState;
}

export type WorktreeHandoffDefect =
  | 'invalid_correlation'
  | 'invalid_git_reference'
  | 'branch_not_owned'
  | 'invalid_diff'
  | 'invalid_gates'
  | 'invalid_status'
  | 'invalid_metadata'
  | 'payload_too_large'
  | 'sensitive_data';

export type WorktreeHandoffResult =
  | { readonly ok: true; readonly value: WorktreeHandoffV1 }
  | { readonly ok: false; readonly defect: WorktreeHandoffDefect; readonly explanation: string };

const SHA = /^[a-f0-9]{40}$/;
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveVersion = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;
const nonNegativeInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const bounded = (value: string, max: number): boolean => value.length <= max;
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const executionStatuses: ReadonlySet<string> = new Set(['succeeded', 'failed']);

const isFileChange = (value: unknown): value is WorktreeFileChange => {
  if (typeof value !== 'object' || value === null) return false;
  const change = value as WorktreeFileChange;
  return nonBlank(change.path)
    && typeof change.insertions === 'number' && Number.isInteger(change.insertions) && change.insertions >= -1
    && typeof change.deletions === 'number' && Number.isInteger(change.deletions) && change.deletions >= -1;
};
const gateOutcomes: ReadonlySet<string> = new Set(['passed', 'failed']);
const isGate = (value: unknown): value is WorktreeGateOutcome => {
  if (typeof value !== 'object' || value === null) return false;
  const gate = value as WorktreeGateOutcome;
  return nonBlank(gate.label) && nonBlank(gate.command)
    && typeof gate.exitCode === 'number' && Number.isInteger(gate.exitCode)
    && gateOutcomes.has(gate.outcome);
};

// Segredos de transporte que a régua canônica (`containsSensitiveData`) não
// cobre — cabeçalhos/credenciais que só apareceriam num campo de texto livre
// como `safeError`. Isto EXTENDE a régua única para a superfície do handoff; não
// a substitui nem reimplementa a política já existente.
const TRANSPORT_SECRET = /\b(authorization|cookie|set-cookie|x-api-key|proxy-authorization)\b\s*[:=]/i;
const BEARER = /\bbearer\s+[a-z0-9._~+/-]{8,}=*/i;
const JWT = /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/;
const isSensitive = (value: string): boolean =>
  containsSensitiveData(value) || TRANSPORT_SECRET.test(value) || BEARER.test(value) || JWT.test(value);

const fail = (defect: WorktreeHandoffDefect, explanation: string): WorktreeHandoffResult => ({ ok: false, defect, explanation });

export interface BuildWorktreeHandoffInput {
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  readonly executorId: string;
  readonly backendId: string;
  readonly model: string | null;
  readonly baseSha: string;
  readonly branch: string;
  readonly commitSha: string;
  readonly status: WorktreeExecutionStatus;
  readonly safeError?: string | null;
  readonly changedFiles: readonly string[];
  readonly diffFiles: readonly WorktreeFileChange[];
  readonly gates: readonly WorktreeGateOutcome[];
}

/** Reúne o conjunto de strings que jamais podem carregar segredo ou caminho
 * absoluto local. Compartilhado por build e parse. */
const sensitiveCandidates = (handoff: WorktreeHandoffV1): readonly string[] => [
  handoff.executorId, handoff.backendId, handoff.model ?? '', handoff.branch,
  handoff.safeError ?? '',
  ...handoff.changedFiles,
  ...handoff.diffSummary.files.map(file => file.path),
  ...handoff.gates.flatMap(gate => [gate.label, gate.command]),
];

/** Reúne o conjunto de strings/listas sujeitas a limite de tamanho, com o teto
 * de cada uma. Compartilhado por build e parse. */
const oversizedField = (handoff: WorktreeHandoffV1): boolean =>
  !bounded(handoff.executorId, MAX_IDENTIFIER)
  || !bounded(handoff.backendId, MAX_IDENTIFIER)
  || (handoff.model !== null && !bounded(handoff.model, MAX_IDENTIFIER))
  || !bounded(handoff.branch, MAX_IDENTIFIER)
  || (handoff.safeError !== null && !bounded(handoff.safeError, MAX_ERROR))
  || handoff.changedFiles.length > MAX_CHANGED_FILES
  || handoff.changedFiles.some(path => !bounded(path, MAX_PATH))
  || handoff.diffSummary.files.length > MAX_DIFF_FILES
  || handoff.diffSummary.files.some(file => !bounded(file.path, MAX_PATH))
  || handoff.gates.length > MAX_GATES
  || handoff.gates.some(gate => !bounded(gate.label, MAX_LABEL) || !bounded(gate.command, MAX_COMMAND));

/** Régua de status/gates, compartilhada por build e parse. Devolve o defeito ou
 * `null`. Um desfecho de sucesso exige todos os gates aprovados (nunca
 * "aprovado" sem gate completo) e nenhum erro; uma falha exige ao menos um gate
 * reprovado (falha honesta, jamais oculta). */
const statusDefect = (handoff: WorktreeHandoffV1): WorktreeHandoffDefect | null => {
  const failedGates = handoff.gates.filter(gate => gate.outcome !== 'passed');
  if (handoff.status === 'succeeded') {
    if (failedGates.length > 0) return 'invalid_gates';
    if (handoff.safeError !== null) return 'invalid_status';
    return null;
  }
  // status === 'failed'
  if (failedGates.length === 0) return 'invalid_status';
  return null;
};

/**
 * Constrói e valida o handoff durável de uma execução de worktree.
 *
 * Fail-closed em toda ambiguidade: correlação incompleta, SHA malformado, branch
 * fora do namespace do Anima, diff inconsistente, gate ausente, status
 * incoerente com os gates, campo acima dos limites, ou qualquer segredo/caminho
 * absoluto. Um handoff recém-construído é sempre `local_only` — construir jamais
 * afirma publicação, aplicação, merge ou push.
 */
export function buildWorktreeHandoff(input: BuildWorktreeHandoffInput): WorktreeHandoffResult {
  if (!nonBlank(input.workItemId) || !nonBlank(input.attemptId) || !positiveVersion(input.approvedProposalVersion)) {
    return fail('invalid_correlation', 'O handoff exige item, tentativa e versão aprovada válidos.');
  }
  if (!nonBlank(input.executorId) || !nonBlank(input.backendId) || (input.model !== null && !nonBlank(input.model))) {
    return fail('invalid_metadata', 'Executor e backend são obrigatórios; o modelo é nulo ou não vazio.');
  }
  if (!SHA.test(input.baseSha) || !SHA.test(input.commitSha)) {
    return fail('invalid_git_reference', 'base_sha e commit produzido precisam ser SHAs completos.');
  }
  if (input.baseSha === input.commitSha) {
    return fail('invalid_git_reference', 'O commit produzido não pode ser idêntico ao SHA-base: nada teria sido registrado.');
  }
  if (!isAnimaWorktreeBranch(input.branch)) {
    return fail('branch_not_owned', 'A branch precisa pertencer ao namespace de trabalho do Anima.');
  }
  if (!executionStatuses.has(input.status)) {
    return fail('invalid_status', 'O desfecho precisa ser succeeded ou failed.');
  }
  const safeError = input.safeError ?? null;
  if (safeError !== null && !nonBlank(safeError)) {
    return fail('invalid_status', 'O erro seguro, quando presente, não pode ser vazio.');
  }
  if (!Array.isArray(input.changedFiles) || input.changedFiles.length === 0 || !input.changedFiles.every(nonBlank)) {
    return fail('invalid_diff', 'Um handoff sem arquivos alterados não é revisável.');
  }
  if (!Array.isArray(input.diffFiles) || input.diffFiles.length === 0 || !input.diffFiles.every(isFileChange)) {
    return fail('invalid_diff', 'O resumo do diff precisa listar cada arquivo com suas contagens.');
  }
  if (!Array.isArray(input.gates) || input.gates.length === 0 || !input.gates.every(isGate)) {
    return fail('invalid_gates', 'O handoff precisa registrar ao menos um gate com comando e resultado.');
  }
  const insertions = input.diffFiles.reduce((sum, file) => sum + Math.max(file.insertions, 0), 0);
  const deletions = input.diffFiles.reduce((sum, file) => sum + Math.max(file.deletions, 0), 0);
  // Ordenação canônica e determinística (INT-05): duas construções com a mesma
  // evidência lógica produzem a MESMA estrutura, independente da ordem de coleta.
  const changedFiles = [...input.changedFiles].sort(byString);
  const diffFiles = [...input.diffFiles].sort((a, b) => byString(a.path, b.path));
  const gates = [...input.gates].sort((a, b) => byString(a.label, b.label) || byString(a.command, b.command));
  const value: WorktreeHandoffV1 = {
    schemaVersion: 1,
    workItemId: input.workItemId,
    attemptId: input.attemptId,
    approvedProposalVersion: input.approvedProposalVersion,
    executorId: input.executorId,
    backendId: input.backendId,
    model: input.model,
    baseSha: input.baseSha,
    branch: input.branch,
    commitSha: input.commitSha,
    status: input.status,
    safeError,
    changedFiles,
    diffSummary: { filesChanged: diffFiles.length, insertions, deletions, files: diffFiles },
    gates,
    publicationState: 'local_only',
  };

  const status = statusDefect(value);
  if (status !== null) {
    return fail(status, status === 'invalid_gates'
      ? 'Um handoff de sucesso não pode carregar um gate reprovado.'
      : value.status === 'succeeded'
        ? 'Um sucesso não pode carregar um erro; um erro implica falha.'
        : 'Uma falha precisa registrar ao menos um gate reprovado.');
  }
  if (oversizedField(value)) {
    return fail('payload_too_large', 'Um campo do handoff excede o limite de tamanho permitido.');
  }
  if (sensitiveCandidates(value).some(isSensitive)) {
    return fail('sensitive_data', 'O handoff não pode carregar credenciais, cabeçalhos de autenticação nem caminhos absolutos locais.');
  }
  return { ok: true, value };
}

const object = (value: Json | undefined): Record<string, Json | undefined> | null =>
  value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object' ? value : null;

const publicationStates: ReadonlySet<string> = new Set(['local_only', 'published']);

/**
 * Reconstrói um `WorktreeHandoffV1` a partir do JSON persistido, aceitando
 * qualquer estado de publicação (diferente de `build`, que só emite
 * `local_only`). Devolve `null` em qualquer elo malformado, incoerente, acima
 * dos limites ou com segredo: a UI declara a ausência, nunca a inventa nem
 * confia cegamente no que foi persistido.
 */
export function parseWorktreeHandoff(value: Json | undefined): WorktreeHandoffV1 | null {
  const root = object(value);
  if (!root || root.schemaVersion !== 1) return null;
  const diff = object(root.diffSummary);
  if (!diff || !Array.isArray(diff.files) || !Array.isArray(root.changedFiles) || !Array.isArray(root.gates)) return null;

  const files: WorktreeFileChange[] = [];
  for (const entry of diff.files) { if (!isFileChange(entry)) return null; files.push({ path: entry.path, insertions: entry.insertions, deletions: entry.deletions }); }
  const gates: WorktreeGateOutcome[] = [];
  for (const entry of root.gates) { if (!isGate(entry)) return null; gates.push({ label: entry.label, command: entry.command, exitCode: entry.exitCode, outcome: entry.outcome }); }
  const changedFiles: string[] = [];
  for (const entry of root.changedFiles) { if (!nonBlank(entry)) return null; changedFiles.push(entry); }

  const safeError = root.safeError === undefined || root.safeError === null ? null : root.safeError;

  if (!nonBlank(root.workItemId) || !nonBlank(root.attemptId) || !positiveVersion(root.approvedProposalVersion)
    || !nonBlank(root.executorId) || !nonBlank(root.backendId)
    || (root.model !== null && !nonBlank(root.model))
    || typeof root.baseSha !== 'string' || !SHA.test(root.baseSha)
    || typeof root.commitSha !== 'string' || !SHA.test(root.commitSha)
    || root.baseSha === root.commitSha
    || !isAnimaWorktreeBranch(root.branch)
    || typeof root.status !== 'string' || !executionStatuses.has(root.status)
    || (safeError !== null && !nonBlank(safeError))
    || typeof root.publicationState !== 'string' || !publicationStates.has(root.publicationState)
    || !nonNegativeInt(diff.filesChanged) || !nonNegativeInt(diff.insertions) || !nonNegativeInt(diff.deletions)
    || changedFiles.length === 0 || files.length === 0 || gates.length === 0) {
    return null;
  }

  const handoff: WorktreeHandoffV1 = {
    schemaVersion: 1,
    workItemId: root.workItemId,
    attemptId: root.attemptId,
    approvedProposalVersion: root.approvedProposalVersion,
    executorId: root.executorId,
    backendId: root.backendId,
    model: root.model === null ? null : (root.model as string),
    baseSha: root.baseSha,
    branch: root.branch as string,
    commitSha: root.commitSha,
    status: root.status as WorktreeExecutionStatus,
    safeError: safeError === null ? null : (safeError as string),
    changedFiles,
    diffSummary: { filesChanged: diff.filesChanged, insertions: diff.insertions, deletions: diff.deletions, files },
    gates,
    publicationState: root.publicationState as WorktreePublicationState,
  };

  // Coerência status↔gates, limites e segredos valem também para o que já está
  // persistido: dado adulterado ou legado inconsistente não vira handoff válido.
  if (statusDefect(handoff) !== null || oversizedField(handoff) || sensitiveCandidates(handoff).some(isSensitive)) {
    return null;
  }
  return handoff;
}

/**
 * Projeta o handoff durável do resultado mais recente. Lê o sinal do executor
 * persistido (`data.executor_signal.worktreeHandoff`) do último
 * `result_submitted` — a fonte que sobrevive a reinício e à remoção da worktree.
 *
 * A correlação do handoff é cruzada com a do próprio evento que o carrega
 * (`work_item_id`/`attempt_id`/`approved_proposal_version`): um handoff cuja
 * tríade discorda do evento é inconsistente e vira ausência. `null` quando o
 * resultado não veio de uma execução de worktree ou está incoerente.
 */
export function projectWorktreeHandoff(events: readonly WorkEvent[]): WorktreeHandoffV1 | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.type !== 'result_submitted') continue;
    const data = object(object(event.payload)?.data);
    const signal = object(data?.executor_signal);
    const handoff = parseWorktreeHandoff(signal?.worktreeHandoff);
    if (!handoff) return null;
    // Cross-check da correlação contra o envelope persistido do evento.
    if (data?.work_item_id !== handoff.workItemId
      || data?.attempt_id !== handoff.attemptId
      || data?.approved_proposal_version !== handoff.approvedProposalVersion) {
      return null;
    }
    return handoff;
  }
  return null;
}
