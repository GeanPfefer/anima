import { containsSensitiveData } from './execution-attempt';
import type { ProposalVersion, WorkItemId } from './types';
import type { WorktreeDiffSummary, WorktreeFileChange } from './worktree-handoff';
import type { Json } from '@anima/types';

// Evidência de execução OBSERVADA PELO HOST (independência real — o eixo do
// "o agente que executa não deve conseguir fabricar sozinho a evidência
// necessária para sua própria aprovação").
//
// Diferente do `WorktreeHandoffV1` (INT-05), que é ATESTADO — o executor coloca
// os valores no sinal —, esta evidência é produzida por inspeção do Git feita
// pelo HOST diretamente sobre a branch descartável já persistida no repositório,
// DEPOIS da execução. O Git não mente sobre o que foi commitado: um executor que
// minta no seu sinal sobre quais arquivos alterou é contraditado por estes fatos.
//
// COBERTURA V0 — honesta e explícita. O host observa independentemente apenas os
// fatos do GIT (commit, arquivos alterados, diff). Os desfechos de GATE NÃO são
// observados independentemente nesta versão: observá-los exigiria RE-EXECUTAR os
// gates num sandbox controlado (evolução futura), fora do escopo deste recorte.
// Por isso `coverage.gates=false`: o Verifier continua tratando gates como
// atestados. É melhor independência real PARCIAL do que uma falsa promessa total.

const MAX_SHA = 64;
const MAX_PATH = 400;
const MAX_CHANGED_FILES = 2000;
const MAX_DIFF_FILES = 2000;

export interface HostObservedGitEvidenceV1 {
  readonly schemaVersion: 1;
  // Correlação obrigatória — a mesma tríade de qualquer artefato de tentativa,
  // amarrada pela persistência confiável (INT-02).
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  // Fatos observados pelo host no Git, nunca vindos do sinal do executor.
  readonly baseSha: string;
  readonly observedCommitSha: string;
  readonly observedChangedFiles: readonly string[];
  readonly observedDiffSummary: WorktreeDiffSummary;
  readonly observedAt: string;
  // Cobertura explícita do que foi observado de forma independente.
  readonly coverage: { readonly git: true; readonly gates: false };
}

export type HostObservedEvidenceDefect =
  | 'invalid_correlation'
  | 'invalid_git_reference'
  | 'invalid_diff'
  | 'invalid_timestamp'
  | 'payload_too_large'
  | 'sensitive_data';

export type HostObservedEvidenceResult =
  | { readonly ok: true; readonly value: HostObservedGitEvidenceV1 }
  | { readonly ok: false; readonly defect: HostObservedEvidenceDefect; readonly explanation: string };

const SHA = /^[a-f0-9]{40}$/;
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveVersion = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;
const bounded = (value: string, max: number): boolean => value.length <= max;
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const isFileChange = (value: unknown): value is WorktreeFileChange => {
  if (typeof value !== 'object' || value === null) return false;
  const change = value as WorktreeFileChange;
  return nonBlank(change.path)
    && typeof change.insertions === 'number' && Number.isInteger(change.insertions) && change.insertions >= -1
    && typeof change.deletions === 'number' && Number.isInteger(change.deletions) && change.deletions >= -1;
};

const fail = (defect: HostObservedEvidenceDefect, explanation: string): HostObservedEvidenceResult => ({ ok: false, defect, explanation });

export interface BuildHostObservedGitEvidenceInput {
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  readonly baseSha: string;
  readonly observedCommitSha: string;
  readonly observedChangedFiles: readonly string[];
  readonly observedDiffFiles: readonly WorktreeFileChange[];
  readonly observedAt: string;
}

const norm = (path: string): string => path.replace(/\\/g, '/');

/**
 * Constrói e valida a evidência observada. Fail-closed: correlação incompleta,
 * SHA malformado, base == commit (nada teria sido registrado), diff inconsistente,
 * timestamp inválido, tamanho acima do teto ou qualquer caminho sensível.
 *
 * Ordena os caminhos canonicamente (determinismo byte-a-byte na reobservação/
 * reentrega). `coverage` é fixo: git observado, gates NÃO.
 */
export function buildHostObservedGitEvidence(input: BuildHostObservedGitEvidenceInput): HostObservedEvidenceResult {
  if (!nonBlank(input.workItemId) || !nonBlank(input.attemptId) || !positiveVersion(input.approvedProposalVersion)) {
    return fail('invalid_correlation', 'A evidência observada exige item, tentativa e versão aprovada válidos.');
  }
  if (!SHA.test(input.baseSha) || !SHA.test(input.observedCommitSha)) {
    return fail('invalid_git_reference', 'base_sha e commit observado precisam ser SHAs completos.');
  }
  if (input.baseSha === input.observedCommitSha) {
    return fail('invalid_git_reference', 'O commit observado não pode ser idêntico à base: nada teria sido registrado.');
  }
  if (!Array.isArray(input.observedChangedFiles) || input.observedChangedFiles.length === 0 || !input.observedChangedFiles.every(nonBlank)) {
    return fail('invalid_diff', 'A evidência observada precisa listar ao menos um arquivo alterado.');
  }
  if (!Array.isArray(input.observedDiffFiles) || input.observedDiffFiles.length === 0 || !input.observedDiffFiles.every(isFileChange)) {
    return fail('invalid_diff', 'O resumo do diff observado precisa listar cada arquivo com suas contagens.');
  }
  if (!nonBlank(input.observedAt) || Number.isNaN(Date.parse(input.observedAt))) {
    return fail('invalid_timestamp', 'observedAt precisa ser um instante ISO-8601 válido.');
  }
  const changedFiles = [...input.observedChangedFiles.map(norm)].sort(byString);
  const diffFiles = [...input.observedDiffFiles.map(file => ({ ...file, path: norm(file.path) }))].sort((a, b) => byString(a.path, b.path));
  if (changedFiles.length > MAX_CHANGED_FILES || diffFiles.length > MAX_DIFF_FILES
    || changedFiles.some(path => !bounded(path, MAX_PATH)) || diffFiles.some(file => !bounded(file.path, MAX_PATH))
    || !bounded(input.baseSha, MAX_SHA) || !bounded(input.observedCommitSha, MAX_SHA)) {
    return fail('payload_too_large', 'Um campo da evidência observada excede o limite de tamanho permitido.');
  }
  if ([...changedFiles, ...diffFiles.map(f => f.path)].some(containsSensitiveData)) {
    return fail('sensitive_data', 'A evidência observada não pode carregar credenciais nem caminhos absolutos locais.');
  }
  const insertions = diffFiles.reduce((sum, file) => sum + Math.max(file.insertions, 0), 0);
  const deletions = diffFiles.reduce((sum, file) => sum + Math.max(file.deletions, 0), 0);
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      workItemId: input.workItemId,
      attemptId: input.attemptId,
      approvedProposalVersion: input.approvedProposalVersion,
      baseSha: input.baseSha,
      observedCommitSha: input.observedCommitSha,
      observedChangedFiles: changedFiles,
      observedDiffSummary: { filesChanged: diffFiles.length, insertions, deletions, files: diffFiles },
      observedAt: input.observedAt,
      coverage: { git: true, gates: false },
    },
  };
}

const object = (value: Json | undefined): Record<string, Json | undefined> | null =>
  value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object' ? value : null;

/**
 * Reconstrói a evidência observada a partir do JSON persistido, fail-closed em
 * qualquer elo malformado, incoerente, acima dos limites ou com segredo — a UI/o
 * Verifier declaram a ausência, nunca confiam cegamente no persistido.
 */
export function parseHostObservedGitEvidence(value: Json | undefined): HostObservedGitEvidenceV1 | null {
  const root = object(value);
  if (!root || root.schemaVersion !== 1) return null;
  const diff = object(root.observedDiffSummary);
  const coverage = object(root.coverage);
  if (!diff || !Array.isArray(diff.files) || !Array.isArray(root.observedChangedFiles) || !coverage) return null;
  const files: WorktreeFileChange[] = [];
  for (const entry of diff.files) { if (!isFileChange(entry)) return null; files.push({ path: entry.path, insertions: entry.insertions, deletions: entry.deletions }); }
  const changedFiles: string[] = [];
  for (const entry of root.observedChangedFiles) { if (!nonBlank(entry)) return null; changedFiles.push(entry); }
  if (!nonBlank(root.workItemId) || !nonBlank(root.attemptId) || !positiveVersion(root.approvedProposalVersion)
    || typeof root.baseSha !== 'string' || !SHA.test(root.baseSha)
    || typeof root.observedCommitSha !== 'string' || !SHA.test(root.observedCommitSha)
    || root.baseSha === root.observedCommitSha
    || !nonBlank(root.observedAt) || Number.isNaN(Date.parse(root.observedAt as string))
    || coverage.git !== true || coverage.gates !== false
    || typeof diff.filesChanged !== 'number' || typeof diff.insertions !== 'number' || typeof diff.deletions !== 'number'
    || changedFiles.length === 0 || files.length === 0
    || changedFiles.length > MAX_CHANGED_FILES || files.length > MAX_DIFF_FILES
    || [...changedFiles, ...files.map(f => f.path)].some(containsSensitiveData)) {
    return null;
  }
  return {
    schemaVersion: 1,
    workItemId: root.workItemId,
    attemptId: root.attemptId,
    approvedProposalVersion: root.approvedProposalVersion,
    baseSha: root.baseSha,
    observedCommitSha: root.observedCommitSha,
    observedChangedFiles: changedFiles,
    observedDiffSummary: { filesChanged: diff.filesChanged, insertions: diff.insertions, deletions: diff.deletions, files },
    observedAt: root.observedAt as string,
    coverage: { git: true, gates: false },
  };
}
