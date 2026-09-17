// Revisão do successor fe99e446 para uma proposta v3 TERMINAL — HAND-AUTHORED pelo
// executor sob direção humana explícita (Trilha C aprovada pelo Codex). NÃO chama
// OpenAI/RunPod/provider; NÃO concede authority; NÃO executa; NÃO liquida reserva.
// Apenas persiste um `proposal_revised` (v2→v3) pela identidade residente (RLS).
//
// `planner` permanece 'openai_project_tools_v1' porque é a FONTE de classificação do
// item (o v2 originou-se do planner OpenAI); fe99e446 não tem canonical_provenance nem
// lineage de recovery, então trocar por um valor de operador tornaria o item
// inclassificável no approval. O CONTEÚDO da v3 é autorado pelo executor sob direção
// humana — registrado com transparência no registro/preflight.
import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { readExecutionContract } from '@/lib/work-orchestration/executor-selection';

const WORK_ITEM_ID = 'fe99e446-9f14-45d0-97f5-764e9c2af8a9';
const EXPECTED_VERSION = 2;

// Efeitos de aceitação (proposal.data.expectedEffects). As `covers` dos critérios
// referenciam EXATAMENTE estas strings (igualdade), então covers==expectedEffects.
const E1 = 'O terminal OpenAI correlaciona a reservationId admitida ao attempt e, após persistir ou obter a usage provider-reported agregada, calcula o custo real com ProviderPricingV1 explícito e versionado (provider, model, currency, sourceRef, effectiveFrom).';
const E2 = 'Com usage e pricing válidos, moeda compatível e custo menor ou igual ao valor reservado, o terminal chama settlePaidComputeBudgetReservation exatamente uma vez com a reservationId correlacionada e persiste evidence/auditoria reproduzível (attempt, usage, pricing, reserva, custo).';
const E3 = 'Replay idempotente e fail-closed: usage/pricing ausente ou inválido, correlação inconsistente, moeda divergente ou custo acima da reserva NÃO chamam o RPC de settlement e mantêm a reserva aberta (reserved diferente de settled; o teto nunca vira custo).';
const E4 = 'Os caminhos Ollama e RunPod permanecem sem settlement OpenAI e preservam o comportamento atual, com contenção observável por git.';

const EXPECTED_EFFECTS = [E1, E2, E3, E4];

const VALIDATION_CRITERIA = [
  { label: 'Testes focais do núcleo econômico (Jest)', command: 'npm test --workspace=@anima/core -- compute-economics.test.ts', proof: 'gate', covers: [E1] },
  { label: 'Testes focais de wiring web do settlement OpenAI (Jest)', command: 'npm test --workspace=@anima/web -- openai-actual-cost-settlement.test.ts post-turn-observation.test.ts openai-paid-compute.test.ts', proof: 'gate', covers: [E1, E2, E3] },
  { label: 'Contenção de escopo observada por git (Ollama/RunPod intactos)', proof: 'scope', covers: [E4] },
];

const INCLUDED_SCOPE = [
  'packages/core/src/compute-economics.ts',
  'packages/core/src/compute-economics.test.ts',
  'apps/web/lib/work-orchestration/openai-actual-cost-settlement.ts',
  'apps/web/lib/work-orchestration/openai-actual-cost-settlement.test.ts',
  'apps/web/lib/work-orchestration/openai-paid-compute.ts',
  'apps/web/lib/work-orchestration/openai-paid-compute.test.ts',
  'apps/web/lib/work-orchestration/post-turn-observation.ts',
  'apps/web/lib/work-orchestration/post-turn-observation.test.ts',
  'apps/web/lib/work-orchestration/autonomous-backlog-deps.ts',
];

const EXCLUDED_SCOPE = [
  'apps/web/lib/work-orchestration/autonomous-backlog-deps-router.test.ts',
  'supabase/migrations',
  'reservas históricas c0edc775/8e51abf5/b1c37346',
  'settlement de reservas antigas',
  'Verifier v2',
  'Ponto 1 (8fe633eb)',
  'integração',
  'merge',
  'deploy',
  'origin/main',
  'Ollama',
  'RunPod',
];

const OBJECTIVE = 'Fechar o actual-cost settlement do coder OpenAI no terminal pós-turno: correlacionar a reservationId admitida ao attempt, obter a usage provider-reported agregada após a evidência terminal, montar ProviderPricingV1 versionado, calcular o custo real e — somente quando evidência completa, consistente e custo <= reserva — chamar settlePaidComputeBudgetReservation uma única vez com trilha auditável; wiring real do callback até a API canônica do store; sem alterar Ollama/RunPod nem o schema do banco.';
const SUMMARY = 'v3 TERMINAL do Ponto 2 (settlement real OpenAI): implementação + teste focal em escopo + wiring reservationId->settlePaidComputeBudgetReservation + evidência persistida, fail-closed, Jest canônico, backend do intent.';

const log = (v: unknown) => console.log(JSON.stringify(v, null, 2));

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const service = createWorkOrchestrationService(client);

  // Preserva o execution_spec vetado do item (worktree/openai/base_sha/target/limits),
  // trocando apenas as validation_criteria pelas terminais proof-typed.
  const before = await client.from('work_items').select('intent').eq('id', WORK_ITEM_ID).maybeSingle();
  if (before.error || !before.data) throw new Error(`intent atual ausente: ${before.error?.message ?? 'not found'}`);
  const currentIntent = before.data.intent as { planner?: unknown; execution_spec?: Record<string, unknown> };
  const spec = currentIntent.execution_spec ?? {};

  const intent = {
    planner: 'openai_project_tools_v1',
    execution_spec: {
      ...spec,
      validation_criteria: VALIDATION_CRITERIA,
    },
  };
  const proposal = {
    schemaVersion: 1 as const,
    data: {
      summary: SUMMARY,
      objective: OBJECTIVE,
      includedScope: INCLUDED_SCOPE,
      excludedScope: EXCLUDED_SCOPE,
      expectedEffects: EXPECTED_EFFECTS,
      risks: [
        'Se a usage/pricing/correlação não puderem ser reconstruídas no seam terminal, o settlement deve falhar fechado e manter a reserva aberta.',
        'A passagem da reservationId até o terminal pode exigir correlação transitória limitada ao attempt (via lease provider-api:<attemptId>), sem alterar contratos amplos.',
      ],
    },
  };

  const revised = await service.reviseProposal({ workItemId: WORK_ITEM_ID, expectedProposalVersion: EXPECTED_VERSION, intent, proposal });
  if (!revised.ok) throw new Error(`${revised.error.code}: ${revised.error.message}`);

  // Alinhamento covers==expectedEffects (o mesmo invariante que o Verifier exige).
  const effectsSet = new Set(EXPECTED_EFFECTS);
  const coversUnknown = VALIDATION_CRITERIA.flatMap(c => c.covers.filter(x => !effectsSet.has(x)));
  const uncovered = EXPECTED_EFFECTS.filter(e => !VALIDATION_CRITERIA.some(c => c.covers.includes(e)));

  // Re-leitura pós-escrita: confirma que o intent do item já reflete a v3 terminal.
  const after = await client.from('work_items').select('intent,proposal_version').eq('id', WORK_ITEM_ID).maybeSingle();
  const persistedContract = readExecutionContract(after.data?.intent);

  log({
    workItemId: WORK_ITEM_ID,
    terminalVersion: revised.value.proposalVersion,
    persistedProposalVersion: (after.data as { proposal_version?: number } | null)?.proposal_version,
    coderBackend: persistedContract.coderBackend,
    baseSha: persistedContract.baseSha,
    includedScope: INCLUDED_SCOPE,
    excludedScope: EXCLUDED_SCOPE,
    expectedEffects: EXPECTED_EFFECTS,
    validationCriteria: VALIDATION_CRITERIA,
    ALIGNMENT: { coversUnknown, uncovered, aligned: coversUnknown.length === 0 && uncovered.length === 0 },
  });
}

void main().catch(e => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exitCode = 1; });
