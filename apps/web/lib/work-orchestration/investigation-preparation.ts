import { isValidWorkIntent, isValidWorkProposal, isInvestigationCommit, readCanonicalProvenanceFromIntent, readEffectClass, validateEffectClassCoherence, type CreateWorkProposalCommand, type WorkOrchestrationService } from '@anima/core';
import { Constants, type Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { INVESTIGATION_EXECUTOR_ID, projectRoot, readExecutionContract } from './executor-selection';

export const INVESTIGATION_QUESTION_MAX_LENGTH = 4000;
export interface InvestigationInput { readonly question: string; readonly baseSha: string; readonly capability?: string }
export interface InvestigationProvenance { readonly kind: 'investigation_preparation'; readonly origin: 'cli_propose_investigation_v1'; readonly baseSha: string; readonly preparedAt: string; readonly reference: string }
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
export function readInvestigationProvenanceFromIntent(intent: unknown): InvestigationProvenance | null {
  const p = object(object(intent)?.investigation_provenance);
  if (!p || Object.keys(p).some(k => !['kind','origin','baseSha','preparedAt','reference'].includes(k))
    || p.kind !== 'investigation_preparation' || p.origin !== 'cli_propose_investigation_v1'
    || (!isInvestigationCommit(p.baseSha) || p.baseSha.length !== 40) || typeof p.reference !== 'string' || !/^INV-\d{2}$(?![\s\S])/.test(p.reference) || p.reference === 'INV-00'
    || typeof p.preparedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.preparedAt)
    || !Number.isFinite(Date.parse(p.preparedAt)) || new Date(p.preparedAt).toISOString() !== p.preparedAt) return null;
  return p as unknown as InvestigationProvenance;
}
export function validateInvestigationInput(input: InvestigationInput): string | null {
  if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > INVESTIGATION_QUESTION_MAX_LENGTH) return 'question_invalid';
  if (!isInvestigationCommit(input.baseSha) || input.baseSha.length !== 40) return 'base_sha_invalid';
  if (!Constants.public.Enums.work_capability.some(c => c === (input.capability ?? 'research'))) return 'capability_invalid';
  return null;
}
/** Strict V0 profile, also used before recognizing this origin in post-approval classification. */
export function isInvestigationPreparationEnvelope(intent: unknown): boolean {
  const p = readInvestigationProvenanceFromIntent(intent), s = object(object(intent)?.execution_spec);
  const effect = readEffectClass(intent), contract = readExecutionContract(intent);
  const target = object(s?.target), limits = object(s?.limits);
  return !!p && !!s && s.schema_version === 1 && effect.ok && effect.value === 'read_only'
    && validateEffectClassCoherence(effect.value, contract.permissions ?? [], contract.executor ?? '') === null
    && contract.executor === INVESTIGATION_EXECUTOR_ID && contract.coderBackend === 'codex-cli' && contract.model === 'default'
    && s.base_sha === p.baseSha && s.verifier_requirement === 'advisory'
    && target?.kind === 'project' && target.reference === 'anima'
    && limits?.max_attempts === 1 && limits.max_duration_minutes === 30
    && s.resume_from_checkpoint === undefined && s.candidate_recovery === undefined
    && Array.isArray(s.validation_criteria) && s.validation_criteria.length > 0
    && s.validation_criteria.every(v => { const c = object(v); return !!c && typeof c.label === 'string' && !!c.label.trim(); });
}
export function buildInvestigationProposal(input: InvestigationInput, reference: string, preparedAt: string): CreateWorkProposalCommand {
  const error = validateInvestigationInput(input); if (error) throw new Error(error);
  const question = input.question.trim();
  const command: CreateWorkProposalCommand = {
    sourceMessageId: 'investigation-preparation-placeholder', impactLevel: 'low',
    capability: (input.capability ?? 'research') as CreateWorkProposalCommand['capability'],
    intent: { investigation_question: question, investigation_provenance: { kind: 'investigation_preparation', origin: 'cli_propose_investigation_v1', baseSha: input.baseSha, preparedAt, reference },
      execution_spec: { schema_version: 1, effect_class: 'read_only', executor: INVESTIGATION_EXECUTOR_ID, coder_backend: 'codex-cli', model: 'default', base_sha: input.baseSha,
        target: { kind: 'project', reference: 'anima' }, permissions: ['workspace_read'], verifier_requirement: 'advisory',
        validation_criteria: [{ label: 'Responder à pergunta com evidências referenciadas no snapshot autorizado e lacunas explícitas.' }], limits: { max_attempts: 1, max_duration_minutes: 30 } } },
    proposal: { schemaVersion: 1, data: { summary: question.slice(0,160), objective: question,
      includedScope: ['Leitura do snapshot project:anima no SHA-base autorizado.'], excludedScope: ['Alteração de código, execução mutante e efeitos externos.'],
      expectedEffects: ['Relatório de investigação com evidências e lacunas.'], risks: ['A leitura não confina dados sensíveis; evidências podem ser insuficientes.'] } },
  };
  if (!isValidWorkIntent(command.intent) || !isValidWorkProposal(command.proposal) || !isInvestigationPreparationEnvelope(command.intent)) throw new Error('investigation_envelope_invalid');
  return command;
}
export interface InvestigationPreparationDeps {
  readonly readReferences: () => Promise<readonly string[]>;
  readonly commitExists: (sha: string) => Promise<boolean>;
  readonly persistSourceMessage: (content: string) => Promise<string | null>;
  readonly service: Pick<WorkOrchestrationService, 'createProposal'>;
  readonly now?: () => Date;
}
export type InvestigationPreparationResult =
  | { readonly ok: true; readonly workItemId: string; readonly reference: string; readonly title: string; readonly capability: string; readonly state: 'proposed' }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly orphanSourceMessageId?: string };
export async function prepareInvestigation(input: InvestigationInput, deps: InvestigationPreparationDeps): Promise<InvestigationPreparationResult> {
  let sourceMessageId: string | null = null;
  try {
    const invalid = validateInvestigationInput(input); if (invalid) return { ok:false, code:invalid, message:invalid };
    if (!await deps.commitExists(input.baseSha)) return { ok:false, code:'base_sha_not_found', message:'SHA-base não existe como commit no repositório.' };
    const refs = await deps.readReferences();
    let reference: string | null = null;
    for (let n=1;n<=99;n++) { const ref=`INV-${String(n).padStart(2,'0')}`; if (!refs.includes(ref)) { reference=ref; break; } }
    if (!reference) return { ok:false, code:'investigation_references_exhausted', message:'Não há referência INV-NN livre.' };
    const command = buildInvestigationProposal(input, reference, (deps.now ?? (()=>new Date()))().toISOString());
    // Re-read immediately before the first write. No SQL uniqueness: a concurrent write
    // after this check remains a V0 limitation; later reference resolution fails closed.
    if ((await deps.readReferences()).includes(reference)) return { ok:false, code:'investigation_reference_collision', message:`Colisão detectada em ${reference}.` };
    sourceMessageId = await deps.persistSourceMessage(`${reference} — ${input.question.trim()}`);
    if (!sourceMessageId) return { ok:false, code:'source_message_persist_failed', message:'Falha ao persistir mensagem de origem.' };
    const created = await deps.service.createProposal({ ...command, sourceMessageId });
    if (!created.ok) throw new Error(`${created.error.code}: ${created.error.message}`);
    return { ok:true, workItemId:created.value.id, reference, title:command.proposal.data.summary, capability:command.capability, state:'proposed' };
  } catch (error) {
    return { ok:false, code:sourceMessageId ? 'proposal_persist_failed' : 'investigation_preparation_failed',
      message:`${error instanceof Error ? error.message : String(error)}${sourceMessageId ? `; mensagem de origem órfã possível: ${sourceMessageId} (INSERT e RPC sem transação conjunta).` : ''}`,
      ...(sourceMessageId ? { orphanSourceMessageId:sourceMessageId } : {}) };
  }
}
export function investigationCommitExists(sha: string, repoRoot = projectRoot()): Promise<boolean> {
  if (!isInvestigationCommit(sha) || sha.length !== 40) return Promise.resolve(false);
  return new Promise(resolve => execFile('git', ['-C', repoRoot, 'cat-file', '-t', sha], { timeout:15000, windowsHide:true }, (error, stdout) => resolve(!error && stdout.trim() === 'commit')));
}
export function createInvestigationPreparationDeps(client: SupabaseClient<Database>, userId: string, service: Pick<WorkOrchestrationService,'createProposal'>): InvestigationPreparationDeps {
  return { service, commitExists: sha => investigationCommitExists(sha),
    readReferences: async () => {
      const refs:string[]=[];
      for (let offset=0;;offset+=1000) {
        const {data,error}=await client.from('work_items').select('intent').order('id').range(offset,offset+999);
        if(error) throw new Error(error.message);
        for(const row of data ?? []) {
          const canonical=readCanonicalProvenanceFromIntent(row.intent); if(canonical) refs.push(canonical.sourceId);
          // Reserve even malformed provenance's reference; never silently reuse it.
          const ref=object(object(row.intent)?.investigation_provenance)?.reference; if(typeof ref==='string') refs.push(ref);
        }
        if((data ?? []).length<1000) return refs;
      }
    },
    persistSourceMessage: async content => {
      const {data,error}=await client.from('ai_conversations').insert({user_id:userId,role:'user',content}).select('id').single();
      if(error || !data) throw new Error(error?.message ?? 'source_message_persist_failed'); return data.id;
    },
  };
}
