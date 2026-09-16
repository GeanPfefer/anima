// FASE 2 (Opção B, decisão humana 2026-09-14): cria o recovery successor seq.5 canônico via a
// RPC canônica `propose_recovery_successor` (mesmo caminho do recover-ce90eb14.ts). NÃO edita
// tabelas, NÃO faz SQL manual, NÃO altera o seq.4, NÃO apaga eventos, NÃO reusa IDs.
//
// Preserva INTEGRALMENTE a intenção material v2 do seq.4 malformado (5895b59c): lê o intent
// (execution_spec v2) e o proposal v2 AUTORITATIVOS do banco e os copia verbatim, adicionando
// APENAS o campo faltante `resume_from_checkpoint` (coerente com a base ccb7dcc). Assim o
// classificador canônico consegue recuperar o planner pela lineage (root 3b0b3c57) SEM alterar a
// política. Boundary máximo: `proposed`. Não aprova, não classifica, não concede authority, não
// executa.
import { resolveCliIdentity } from '@/cli/identity';

const MALFORMED_SEQ4 = '5895b59c-0568-483a-9731-2abd45fb4b90';
const LINEAGE_ROOT = '3b0b3c57-a1d0-4bbe-a719-829b680ca6d1';
const RECOVERY_SEQUENCE = 5;
const IDEMPOTENCY_KEY = '3b0b3c57-a1d0-4bbe-a719-000000000005';
// Base coerente demonstrada (primitive presente, binding ausente). O worktree parte de
// commit_sha; o diff corre contra base_sha. Ambos = ccb7dcc ⇒ attempt HONESTO: o coder produz o
// binding a partir da base, sem promover o commit hand-authored (0bea4c8/af313c3).
const BASE_SHA = 'ccb7dccd6ffa25d65ce443657eddb7c97dd4b6fe';
const RESUME_BRANCH = 'anima-recovery/seq5-base';

const RECOVERY_REASON =
  'Continuação canônica seq.5 do successor malformado 5895b59c: o seq.4 foi materializado pelo ' +
  'planner forte sem `resume_from_checkpoint`, logo sourceForClassification não recupera o planner ' +
  'pela lineage e a classificação canônica recusa (classification_policy_not_applicable). Preserva ' +
  'integralmente intenção/escopo/critérios v2 e a base coerente ccb7dcc; adiciona apenas ' +
  '`resume_from_checkpoint` coerente. Predecessores (3b0b3c57, 4a36b0a5, 5895b59c) e evidência ' +
  'append-only permanecem intactos. Para em `proposed`.';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;

  // 1) Lê o intent/proposal v2 AUTORITATIVOS do seq.4 (fonte de verdade; nada é reescrito à mão).
  const src = await client
    .from('work_items')
    .select('state,proposal_version,impact_level,capability,intent,proposal')
    .eq('id', MALFORMED_SEQ4)
    .single();
  if (src.error || !src.data) throw new Error(`leitura do seq.4 falhou: ${src.error?.message ?? 'sem linha'}`);
  if (src.data.proposal_version !== 2) throw new Error(`seq.4 não está em v2 (v${src.data.proposal_version}); abortando`);
  if (src.data.impact_level !== 'low' || src.data.capability !== 'programming') {
    throw new Error(`envelope inesperado do seq.4 (${src.data.impact_level}/${src.data.capability}); abortando`);
  }

  const srcIntent = src.data.intent as { execution_spec?: Record<string, unknown> };
  const srcSpec = srcIntent.execution_spec;
  if (!srcSpec || typeof srcSpec !== 'object') throw new Error('seq.4 sem execution_spec; abortando');
  if (srcSpec['base_sha'] !== BASE_SHA) {
    throw new Error(`base_sha do seq.4 (${String(srcSpec['base_sha'])}) != base coerente ${BASE_SHA}; abortando`);
  }
  if ((srcSpec['limits'] as { max_duration_minutes?: unknown; max_attempts?: unknown })?.max_duration_minutes !== 30) {
    throw new Error('max_duration_minutes do seq.4 != 30; abortando');
  }
  if ('resume_from_checkpoint' in srcSpec) {
    throw new Error('seq.4 já tem resume_from_checkpoint (inesperado); abortando');
  }

  // 2) Copia o execution_spec v2 VERBATIM e adiciona SOMENTE resume_from_checkpoint coerente.
  const seq5Spec = {
    ...srcSpec,
    resume_from_checkpoint: { base_sha: BASE_SHA, commit_sha: BASE_SHA, branch: RESUME_BRANCH },
  };

  // 3) Proposal v2 verbatim, reformatado para o contrato da RPC { schema_version, data:{...} }.
  const srcProposal = src.data.proposal as { data?: Record<string, unknown> } | null;
  const pData = srcProposal?.data;
  if (!pData) throw new Error('seq.4 sem proposal.data; abortando');
  const seq5Proposal = {
    schema_version: 1,
    data: {
      summary: pData['summary'],
      objective: pData['objective'],
      included_scope: pData['included_scope'],
      excluded_scope: pData['excluded_scope'],
      expected_effects: pData['expected_effects'],
      risks: pData['risks'],
    },
  };

  // 4) RPC canônica: cria successor em `proposed`, preserva lineage, idempotente (chave fixa).
  const created = await client.rpc('propose_recovery_successor', {
    p_original_work_item_id: LINEAGE_ROOT,
    p_recovery_sequence: RECOVERY_SEQUENCE,
    p_impact_level: 'low',
    p_capability: 'programming',
    p_intent: { execution_spec: seq5Spec },
    p_proposal: seq5Proposal,
    p_recovery_reason: RECOVERY_REASON,
    p_idempotency_key: IDEMPOTENCY_KEY,
  });
  if (created.error) throw new Error(`successor recusado: ${created.error.code ?? ''} ${created.error.message}`);
  const data = created.data as { successorWorkItemId: string; lineageId: string; recoverySequence: number; replayed: boolean };

  console.log(JSON.stringify({
    step: 'seq5-created',
    successorWorkItemId: data.successorWorkItemId,
    lineageId: data.lineageId,
    recoverySequence: data.recoverySequence,
    replayed: data.replayed,
    base_sha: BASE_SHA,
    resume_from_checkpoint: seq5Spec.resume_from_checkpoint,
    preservedFromSeq4: {
      max_attempts: (seq5Spec['limits'] as { max_attempts?: unknown }).max_attempts,
      max_duration_minutes: (seq5Spec['limits'] as { max_duration_minutes?: unknown }).max_duration_minutes,
      coder_backend: seq5Spec['coder_backend'],
      model: seq5Spec['model'],
      included_scope: seq5Proposal.data.included_scope,
    },
  }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
