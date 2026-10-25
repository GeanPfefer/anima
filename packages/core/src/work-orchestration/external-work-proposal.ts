import type { CreateWorkProposalCommand } from './commands';
import { evaluateAutonomousEligibility } from './eligibility';
import { isAllowedGateCommand } from './gate-command-policy';
import { isExternalTargetReference, isFullCommitSha, readExternalTarget } from './external-target';
import type { WorkItem } from './types';
import { isValidWorkIntent, isValidWorkProposal } from './validation';

// ============================================================
// Proposta de trabalho em TARGET EXTERNO (Project Builder V0 — T2). Construtor PURO.
//
// O operador fornece o objetivo, o escopo, os critérios de aceite, o backend e os gates. Nada aqui usa LLM, toca disco/Git, aprova,
// classifica ou executa: o resultado é um `CreateWorkProposalCommand` (estado `proposed`) que segue o fluxo humano existente
// (aprovação → classificação humana → Single-Item). A identidade do repositório (T1) chega pronta em `specTarget`.
// ============================================================

export const EXTERNAL_WORK_ORIGIN = 'cli_propose_external_v1' as const;
export const EXTERNAL_WORK_BACKENDS = ['ollama', 'codex-cli'] as const;
export type ExternalWorkBackend = typeof EXTERNAL_WORK_BACKENDS[number];

export const EXTERNAL_WORK_OBJECTIVE_MAX = 4000;
export const EXTERNAL_WORK_ITEM_MAX = 400;
export const EXTERNAL_WORK_LIST_MAX = 20;
export const EXTERNAL_WORK_MAX_ATTEMPTS = 3;
export const EXTERNAL_WORK_MAX_MINUTES = 60;

export interface ExternalWorkInput {
  readonly reference: string;
  readonly objective: string;
  /** Caminhos relativos (arquivos ou diretórios) que a execução pode alterar. */
  readonly scope: readonly string[];
  readonly excluded?: readonly string[];
  /** Critérios de aceite em texto; viram `expectedEffects` da proposta. */
  readonly acceptance: readonly string[];
  /** Comandos de gate (allowlist de npm). Cada um vira um critério `proof: 'gate'`. */
  readonly gates: readonly string[];
  readonly backend: string;
  /** Obrigatório para `ollama`; `codex-cli` usa sempre `default`. */
  readonly model?: string;
  readonly maxAttempts?: number;
  readonly maxMinutes?: number;
}

export interface ExternalWorkProvenance {
  readonly kind: 'external_work_proposal';
  readonly origin: typeof EXTERNAL_WORK_ORIGIN;
  readonly reference: string;
  readonly preparedAt: string;
}

const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('\0');

/** Caminho relativo seguro: sem absoluto, `..`, glob, backslash, `.git`/`node_modules`. */
export function isSafeExternalScopePath(value: unknown): value is string {
  if (!text(value, 300) || value !== value.trim()) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\\') || /[*?[\]{}]/.test(value)) return false;
  const segments = value.replace(/\/+$/, '').split('/');
  return segments.every(s => s !== '' && s !== '.' && s !== '..' && s.toLowerCase() !== '.git' && s !== 'node_modules');
}

const isList = (v: unknown, min: number, check: (x: unknown) => boolean): v is readonly string[] =>
  Array.isArray(v) && v.length >= min && v.length <= EXTERNAL_WORK_LIST_MAX && v.every(check) && new Set(v).size === v.length;

export function validateExternalWorkInput(input: ExternalWorkInput): string | null {
  if (!isExternalTargetReference(input.reference)) return 'target_reference_invalid';
  if (!text(input.objective, EXTERNAL_WORK_OBJECTIVE_MAX)) return 'objective_invalid';
  if (!isList(input.scope, 1, isSafeExternalScopePath)) return 'scope_invalid';
  // Escopo concreto exige também o que NÃO entra (regra da elegibilidade): exclusões explícitas e obrigatórias.
  if (!isList(input.excluded, 1, isSafeExternalScopePath)) return 'excluded_invalid';
  if (!isList(input.acceptance, 1, v => text(v, EXTERNAL_WORK_ITEM_MAX))) return 'acceptance_invalid';
  if (!isList(input.gates, 1, v => isAllowedGateCommand(v))) return 'gates_invalid';
  if (!(EXTERNAL_WORK_BACKENDS as readonly string[]).includes(input.backend)) return 'backend_invalid';
  if (input.backend === 'ollama' && !text(input.model, 120)) return 'model_required_for_ollama';
  if (input.backend === 'codex-cli' && input.model !== undefined && input.model !== 'default') return 'model_invalid_for_codex';
  const attempts = input.maxAttempts ?? 1, minutes = input.maxMinutes ?? 30;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > EXTERNAL_WORK_MAX_ATTEMPTS) return 'max_attempts_invalid';
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > EXTERNAL_WORK_MAX_MINUTES) return 'max_minutes_invalid';
  return null;
}

export type ExternalWorkBuild =
  | { readonly ok: true; readonly command: Omit<CreateWorkProposalCommand, 'sourceMessageId'> }
  | { readonly ok: false; readonly code: string };

/**
 * Monta a proposta. `specTarget` é a saída de `captureExternalTargetSpec` (T1): precisa ser um target externo válido da MESMA
 * referência informada e seu `base_sha` é o único base_sha do contrato. Nunca aprova, classifica, reserva compute ou executa.
 */
export function buildExternalWorkProposal(input: ExternalWorkInput, specTarget: unknown, preparedAt: string): ExternalWorkBuild {
  const invalid = validateExternalWorkInput(input);
  if (invalid) return { ok: false, code: invalid };
  const target = readExternalTarget(specTarget);
  if (!target.ok) return { ok: false, code: target.reason };
  if (target.target.reference !== input.reference) return { ok: false, code: 'target_reference_mismatch' };
  const baseSha = target.target.identity.baseSha;
  if (!isFullCommitSha(baseSha)) return { ok: false, code: 'base_sha_invalid' };

  const objective = input.objective.trim();
  const command: Omit<CreateWorkProposalCommand, 'sourceMessageId'> = {
    impactLevel: 'low',
    capability: 'programming',
    intent: {
      external_work_provenance: { kind: 'external_work_proposal', origin: EXTERNAL_WORK_ORIGIN, reference: input.reference, preparedAt } satisfies ExternalWorkProvenance,
      execution_spec: {
        schema_version: 1,
        target: specTarget as Record<string, unknown>,
        executor: 'worktree',
        coder_backend: input.backend,
        coder_backend_source: 'operator_explicit',
        model: input.backend === 'codex-cli' ? 'default' : input.model!.trim(),
        base_sha: baseSha,
        permissions: ['workspace_read', 'workspace_write_isolated'],
        validation_criteria: input.gates.map(command => ({ label: command, command, proof: 'gate', claim_kind: 'gate_assertion' })),
        verifier_requirement: 'required_fail_closed',
        limits: { max_attempts: input.maxAttempts ?? 1, max_duration_minutes: input.maxMinutes ?? 30 },
      },
    } as unknown as CreateWorkProposalCommand['intent'],
    proposal: {
      schemaVersion: 1,
      data: {
        summary: objective.slice(0, 160),
        objective,
        includedScope: [...input.scope],
        excludedScope: [...(input.excluded ?? [])],
        expectedEffects: [...input.acceptance],
        risks: ['Repositório externo: o código e os gates são do projeto alvo; a execução ocorre em worktree isolada e o resultado exige revisão humana.'],
      },
    } as unknown as CreateWorkProposalCommand['proposal'],
  };
  if (!isValidWorkIntent(command.intent) || !isValidWorkProposal(command.proposal)) return { ok: false, code: 'external_envelope_invalid' };

  // Elegibilidade avaliada como se aprovada (não aprova nem persiste nada), igual ao planner.
  const preview = { ...command, id: 'external-preview', userId: 'external-preview', sourceMessageId: 'external-preview', state: 'approved',
    originalRequest: objective, proposalVersion: 1, createdAt: new Date(0), updatedAt: new Date(0) } as unknown as WorkItem;
  const eligibility = evaluateAutonomousEligibility(preview);
  if (!eligibility.eligible) return { ok: false, code: `not_eligible:${eligibility.gaps.map(g => g.code).join(',')}` };
  return { ok: true, command };
}

/** O intent foi produzido por este materializador (origem declarada + target externo válido da mesma referência)? */
export function isExternalWorkEnvelope(intent: unknown): boolean {
  const root = object(intent), p = object(root?.['external_work_provenance']), spec = object(root?.['execution_spec']);
  if (!root || !p || !spec) return false;
  if (Object.keys(p).sort().join(',') !== 'kind,origin,preparedAt,reference') return false;
  if (p['kind'] !== 'external_work_proposal' || p['origin'] !== EXTERNAL_WORK_ORIGIN || !isExternalTargetReference(p['reference'])) return false;
  const target = readExternalTarget(spec['target']);
  return target.ok && target.target.reference === p['reference'] && spec['executor'] === 'worktree' && spec['base_sha'] === target.target.identity.baseSha;
}
