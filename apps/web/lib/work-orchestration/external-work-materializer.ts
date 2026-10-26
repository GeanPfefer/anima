import {
  buildExternalWorkProposal, isExternalWorkEnvelope, listStaticJestTestNames, validateExternalWorkInput, validateWorkIntelligenceClassification,
  workComplexities, workPlanClarities, workReversibilities, workRisks, workUrgencies,
  type ExternalWorkInput, type WorkIntelligenceClassificationV1, type WorkOrchestrationService,
} from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readExecutionContract } from './executor-selection';
import { captureExternalTargetSpec, verifyExternalTargetForContract, type ExternalTargetDeps } from './external-target-resolver';
import { createTrustedGitRunner } from './trusted-git';

// ============================================================
// Materializador de WORK ITEM EXTERNO (Project Builder V0 — T2) + classificação HUMANA explícita.
//
// `prepareExternalWork` só PROPÕE: resolve a identidade do repositório autorizado (T1), monta a proposta de forma
// determinística (sem LLM), reverifica a identidade sobre o contrato montado e persiste UM work item `proposed`.
// Nunca aprova, classifica, abre claim/attempt, executa, instala dependências ou publica.
// `classifyExternalWork` é o ato humano posterior (item já `approved`): grava `human_confirmed` com os cinco eixos
// informados pelo operador; a classificação automática do Anima (`planned-project-classification`) NÃO se aplica a `ext:*`.
// ============================================================

export type ExternalWorkRequest = ExternalWorkInput & { readonly baseSha?: string };

export interface ExternalWorkPrepareDeps {
  /** Captura a identidade canônica do target configurado pelo operador (T1). */
  readonly capture: (baseSha: string | undefined, reference: string) => ReturnType<typeof captureExternalTargetSpec>;
  /** Reverificação da identidade autorizada × repositório vivo sobre o contrato JÁ montado (T1). */
  readonly verify: typeof verifyExternalTargetForContract;
  /** Conteúdo de um arquivo no SHA-base autorizado do target (Git confiável); `null` se não existir. Sem executar nada do alvo. */
  readonly readFileAtBase: (identity: { readonly gitCommonDirCanonical: string; readonly baseSha: string }, path: string) => Promise<string | null>;
  readonly persistSourceMessage: (content: string) => Promise<string | null>;
  readonly service: Pick<WorkOrchestrationService, 'createProposal'>;
  readonly now?: () => Date;
}

export type ExternalWorkPrepareResult =
  | { readonly ok: true; readonly workItemId: string; readonly reference: string; readonly title: string; readonly capability: string; readonly state: 'proposed'; readonly baseSha: string; readonly backend: string }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly rejected: boolean; readonly orphanSourceMessageId?: string };

const reject = (code: string, message = code): ExternalWorkPrepareResult => ({ ok: false, code, message, rejected: true });

export async function prepareExternalWork(input: ExternalWorkRequest, deps: ExternalWorkPrepareDeps): Promise<ExternalWorkPrepareResult> {
  let sourceMessageId: string | null = null;
  try {
    const invalid = validateExternalWorkInput(input);
    if (invalid) return reject(invalid);
    if (input.baseSha !== undefined && !/^[0-9a-f]{40}$/.test(input.baseSha)) return reject('base_sha_invalid');

    const captured = await deps.capture(input.baseSha, input.reference);
    if (!captured.ok) return reject(captured.code, captured.message);
    if (captured.target.reference !== input.reference) {
      return reject('external_target_unknown', `A referência ${input.reference} não é o target autorizado neste host.`);
    }

    // Cobertura não pode ser falsa: cada vínculo de teste precisa apontar um arquivo que existe no SHA-base autorizado e conter
    // (estaticamente) os testes nomeados; senão o Verifier jamais poderia satisfazê-lo (inconclusive estrutural).
    for (const binding of input.bindings ?? []) {
      const source = await deps.readFileAtBase(captured.target.identity, binding.file);
      if (source === null) {
        if (binding.boundTests.length > 0 || binding.minNewTests < 1) return reject(`binding_file_missing_at_base:${binding.file}`, `O arquivo de teste ${binding.file} não existe no SHA-base autorizado.`);
        continue; // arquivo NOVO com min_new_tests ≥ 1 e sem testes vinculados: nada a conferir no base
      }
      const known = listStaticJestTestNames(source);
      const missing = binding.boundTests.find(name => !known.has(name));
      if (missing !== undefined) return reject(`bound_test_not_found:${missing}`, `O teste "${missing}" não foi encontrado de forma estática em ${binding.file} no SHA-base (títulos dinâmicos não são vinculáveis).`);
    }

    const built = buildExternalWorkProposal(input, captured.specTarget, (deps.now ?? (() => new Date()))().toISOString());
    if (!built.ok) return reject(built.code);

    // Round trip: o contrato que SERÁ persistido precisa passar pela mesma verificação que o host aplica antes do claim.
    const verified = await deps.verify(readExecutionContract(built.command.intent));
    if (!verified.ok) return reject(verified.code, verified.message);

    sourceMessageId = await deps.persistSourceMessage(`${input.reference} — ${input.objective.trim()}`);
    if (!sourceMessageId) return { ok: false, code: 'source_message_persist_failed', message: 'Falha ao persistir a mensagem de origem.', rejected: false };
    const created = await deps.service.createProposal({ ...built.command, sourceMessageId } as Parameters<typeof deps.service.createProposal>[0]);
    if (!created.ok) throw new Error(`${created.error.code}: ${created.error.message}`);
    return {
      ok: true, workItemId: created.value.id, reference: input.reference, title: built.command.proposal.data.summary,
      capability: built.command.capability, state: 'proposed', baseSha: captured.target.identity.baseSha, backend: input.backend,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, rejected: false, code: sourceMessageId ? 'proposal_persist_failed' : 'external_work_preparation_failed',
      message: `${detail}${sourceMessageId ? `; mensagem de origem órfã possível: ${sourceMessageId} (INSERT e RPC sem transação conjunta).` : ''}`,
      ...(sourceMessageId ? { orphanSourceMessageId: sourceMessageId } : {}) };
  }
}

export function createExternalWorkPrepareDeps(
  client: SupabaseClient<Database>, userId: string, service: Pick<WorkOrchestrationService, 'createProposal'>,
  options: { readonly env?: Readonly<Record<string, string | undefined>>; readonly targetDeps?: ExternalTargetDeps } = {},
): ExternalWorkPrepareDeps {
  const env = options.env ?? process.env;
  return {
    service,
    capture: (baseSha, reference) => captureExternalTargetSpec(env, { reference, ...(baseSha ? { baseSha } : {}), ...(options.targetDeps ? { deps: options.targetDeps } : {}) }),
    verify: contract => verifyExternalTargetForContract(contract, env, options.targetDeps),
    readFileAtBase: async (identity, path) => {
      const result = await createTrustedGitRunner({ gitDir: identity.gitCommonDirCanonical })(['show', `${identity.baseSha}:${path}`]);
      return result.exitCode === 0 ? result.stdout : null;
    },
    persistSourceMessage: async content => {
      const { data, error } = await client.from('ai_conversations').insert({ user_id: userId, role: 'user', content }).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'source_message_persist_failed');
      return data.id;
    },
  };
}

// ─── Classificação humana explícita ───────────────────────────────────────────

export interface ExternalClassificationAxes {
  readonly complexity: string; readonly risk: string; readonly reversibility: string; readonly planClarity: string; readonly urgency: string;
}
export const EXTERNAL_CLASSIFIER_ID = 'cli_classify_external_v1' as const;

export interface ExternalClassificationPort {
  readonly readItem: (id: string) => Promise<{ readonly state: string; readonly proposalVersion: number; readonly intent: unknown } | null>;
  readonly readCurrent: (id: string) => Promise<{ readonly ok: true; readonly classification: unknown | null } | { readonly ok: false; readonly message: string }>;
  readonly record: (input: { workItemId: string; proposalVersion: number; classification: WorkIntelligenceClassificationV1 }) =>
    Promise<{ readonly ok: true; readonly replayed: boolean } | { readonly ok: false; readonly code: string; readonly message: string }>;
}

export type ExternalClassificationResult =
  | { readonly ok: true; readonly workItemId: string; readonly proposalVersion: number; readonly replayed: boolean }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly rejected: boolean };

const AXES: ReadonlyArray<readonly [keyof ExternalClassificationAxes, readonly string[]]> = [
  ['complexity', workComplexities], ['risk', workRisks], ['reversibility', workReversibilities], ['planClarity', workPlanClarities], ['urgency', workUrgencies],
];
const refuse = (code: string, message: string, rejected = true): ExternalClassificationResult => ({ ok: false, code, message, rejected });

export async function classifyExternalWork(
  port: ExternalClassificationPort,
  input: { readonly workItemId: string; readonly expectedProposalVersion: number; readonly axes: ExternalClassificationAxes },
  now: () => Date = () => new Date(),
): Promise<ExternalClassificationResult> {
  for (const [axis, allowed] of AXES) {
    const value = input.axes[axis];
    if (!allowed.includes(value)) return refuse('classification_axis_invalid', `Eixo ${axis} inválido: ${String(value)}.`);
    if (value === 'unknown') return refuse('classification_axis_unknown', `Eixo ${axis}=unknown não habilita execução; o operador precisa decidir.`);
  }
  const item = await port.readItem(input.workItemId);
  if (!item) return refuse('work_item_not_found', 'O trabalho não foi encontrado para esta conta.');
  if (item.state !== 'approved') return refuse('not_approved', `O item está em "${item.state}"; só um plano approved pode ser classificado.`);
  if (item.proposalVersion !== input.expectedProposalVersion) return refuse('proposal_version_changed', `A versão vigente é v${item.proposalVersion}.`);
  if (!isExternalWorkEnvelope(item.intent)) return refuse('not_external_work', 'Este comando só classifica trabalho externo materializado por `work external propose`.');

  const classification: WorkIntelligenceClassificationV1 = {
    schemaVersion: 1, ...input.axes,
    provenance: { kind: 'human_confirmed', classifiedAt: now().toISOString(), classifierId: EXTERNAL_CLASSIFIER_ID },
  } as WorkIntelligenceClassificationV1;
  if (validateWorkIntelligenceClassification(classification) !== null) return refuse('classification_invalid', 'A classificação montada é inválida.');

  const current = await port.readCurrent(input.workItemId);
  if (!current.ok) return refuse('classification_read_failed', current.message, false);
  if (current.classification) {
    const c = current.classification as Record<string, unknown>;
    const same = AXES.every(([axis]) => c[axis] === input.axes[axis]);
    return same ? { ok: true, workItemId: input.workItemId, proposalVersion: item.proposalVersion, replayed: true }
      : refuse('already_classified', 'Já existe classificação vigente diferente; reclassificar é outro ato.');
  }
  const recorded = await port.record({ workItemId: input.workItemId, proposalVersion: item.proposalVersion, classification });
  if (!recorded.ok) return refuse(recorded.code, recorded.message, false);
  return { ok: true, workItemId: input.workItemId, proposalVersion: item.proposalVersion, replayed: recorded.replayed };
}

export function createExternalClassificationPort(client: SupabaseClient<Database>): ExternalClassificationPort {
  return {
    readItem: async id => {
      const row = await client.from('work_items').select('state,proposal_version,intent').eq('id', id).maybeSingle();
      return row.error || !row.data ? null : { state: row.data.state, proposalVersion: row.data.proposal_version, intent: row.data.intent };
    },
    readCurrent: async id => {
      const current = await client.rpc('current_work_intelligence_classification', { p_work_item_id: id });
      if (current.error) return { ok: false, message: current.error.message };
      return { ok: true, classification: (current.data as { classification?: unknown } | null)?.classification ?? null };
    },
    record: async ({ workItemId, proposalVersion, classification }) => {
      const write = await client.rpc('record_work_intelligence_classification', {
        p_work_item_id: workItemId, p_expected_proposal_version: proposalVersion, p_expected_classification_revision: 0,
        p_classification: classification as unknown as Database['public']['Functions']['record_work_intelligence_classification']['Args']['p_classification'],
      });
      if (write.error) return { ok: false, code: write.error.code ?? 'classification_persist_failed', message: write.error.message };
      return { ok: true, replayed: (write.data as { action?: unknown } | null)?.action === 'replayed' };
    },
  };
}
