// Capability Proof Evaluation V0 (2026-09-28) — EVIDÊNCIA REGISTRADA.
//
// Algumas capacidades foram provadas FORA do event log canônico: provas vivas
// controladas (Research Web), procedimentos assistidos (restore manual) e
// implementações cobertas por teste (settlement). Esses fatos existiam só como
// texto em docs/registros e como `proofRefs` soltos no registry.
//
// Este catálogo os transforma em OBSERVAÇÕES estruturadas com proveniência
// (registro append-only + commit), no mesmo contrato do motor
// (`CapabilityEvidenceObservation`). Regras:
//
// - uma entrada registra um FATO observado, nunca uma maturidade — quem conclui
//   a maturidade é a régua (`assessCapabilityMaturity`);
// - toda entrada é `source: 'recorded_proof'` e aponta para um registro real;
// - classes permitidas aqui: `implementation`, `verified_execution` e
//   `assisted_procedure`. Prova controlada NUNCA vira `reproduced_operation` nem
//   `autonomous_operation` (operacional exige uso real, não prova repetida);
// - `observedAt` usa o instante do commit que REGISTROU a prova (precisão de
//   commit; o registro é a fonte);
// - helper/primitiva de apoio que NÃO realiza a capacidade entra como
//   `implementation` + `inconclusive`: é preservado, mas não promove
//   ("supporting code implementado ≠ capability implemented").
//
// Fatos só-em-texto que exigiriam interpretação subjetiva NÃO entram aqui.

import type { CapabilityEvidenceObservation } from './capability-proof-engine';

const RESEARCH_WEB_RECORD = 'docs/registros/2026-09-27b-research-web-v1.md';
const RESEARCH_WEB_OCCASION = 'research-web-v1-prova-viva-controlada-2026-09-27';
const RESEARCH_WEB_ENV =
  'windows-local-dev (SearXNG em contêiner descartável + agent-browser local)';
const RESEARCH_WEB_SCOPE =
  'funcionalidade read-only numa prova controlada; sem consumidor no Anima; não prova isolamento de segurança';

export const RECORDED_CAPABILITY_EVIDENCE_V0: readonly CapabilityEvidenceObservation[] = [
  // ─── research.web.* — prova viva controlada (1 ocasião) ──────────────────────
  {
    id: 'recorded:research.web.search:research-web-v1-live',
    capabilityId: 'research.web.search',
    evidenceClass: 'verified_execution',
    outcome: 'positive',
    observedAt: '2026-09-27T18:03:38Z',
    occasionId: RESEARCH_WEB_OCCASION,
    source: 'recorded_proof',
    environment: RESEARCH_WEB_ENV,
    scope: RESEARCH_WEB_SCOPE,
    freshness: 'perishable',
    proofRefs: [
      { kind: 'commit', ref: '515ba65', note: 'searchWeb + normalizeSearxngResponse' },
      { kind: 'record', ref: RESEARCH_WEB_RECORD, note: 'consulta real: status=degraded (silent_empty) ⇒ complete=false; rank 1 = docs oficiais' },
    ],
    note: 'Busca real via SearXNG normalizou resultados e degradação honestamente.',
  },
  {
    id: 'recorded:research.web.open:research-web-v1-live',
    capabilityId: 'research.web.open',
    evidenceClass: 'verified_execution',
    outcome: 'positive',
    observedAt: '2026-09-27T18:03:38Z',
    occasionId: RESEARCH_WEB_OCCASION,
    source: 'recorded_proof',
    environment: RESEARCH_WEB_ENV,
    scope: RESEARCH_WEB_SCOPE,
    freshness: 'perishable',
    proofRefs: [
      { kind: 'commit', ref: '515ba65', note: 'openAndExtractWebPage (sessão efêmera, kill por PID)' },
      { kind: 'record', ref: RESEARCH_WEB_RECORD, note: 'docs.searxng.org aberto; 0 processos e 0 diretórios residuais' },
    ],
    note: 'URL validada aberta em sessão efêmera com encerramento e limpeza observados.',
  },
  {
    id: 'recorded:research.web.extract:research-web-v1-live',
    capabilityId: 'research.web.extract',
    evidenceClass: 'verified_execution',
    outcome: 'positive',
    observedAt: '2026-09-27T18:03:38Z',
    occasionId: RESEARCH_WEB_OCCASION,
    source: 'recorded_proof',
    environment: RESEARCH_WEB_ENV,
    scope: RESEARCH_WEB_SCOPE,
    freshness: 'perishable',
    proofRefs: [
      { kind: 'commit', ref: '515ba65' },
      { kind: 'record', ref: RESEARCH_WEB_RECORD, note: 'contentHash sha256:4a88cfe9… idêntico nas 2 execuções e ao do POC' },
    ],
    note: 'Texto extraído como untrusted_external_content com contentHash estável.',
  },

  // ─── memory.durability — DIMENSÕES provadas como procedimento/primitiva ─────
  // Nenhuma realiza a capacidade declarada ("o Anima garante sozinho a cópia
  // remota"): são processo humano/assistido ou primitivas read-only de apoio.
  {
    id: 'recorded:memory.durability:historical-code-durable-v1-1',
    capabilityId: 'memory.durability',
    evidenceClass: 'assisted_procedure',
    outcome: 'positive',
    observedAt: '2026-09-28T05:28:07Z',
    source: 'recorded_proof',
    scope: 'dimensão Historical Code Durable — refs archive/anima/* publicadas por ato humano',
    freshness: 'durable',
    proofRefs: [
      { kind: 'commit', ref: 'd0e64bb' },
      { kind: 'record', ref: 'docs/registros/2026-09-28-historical-durability-v1.md' },
    ],
    note: 'História MUST alcançável por refs remotas arquivadas — processo humano, não capacidade do sistema.',
  },
  {
    id: 'recorded:memory.durability:restore-proof-v0',
    capabilityId: 'memory.durability',
    evidenceClass: 'assisted_procedure',
    outcome: 'negative',
    observedAt: '2026-09-28T05:40:58Z',
    source: 'recorded_proof',
    environment: 'goma (stack Supabase descartável)',
    scope: 'dimensão State Durable / Restore Proven — dados PASS, equivalência de segurança FAIL',
    freshness: 'durable',
    proofRefs: [
      { kind: 'commit', ref: 'c94571d' },
      { kind: 'record', ref: 'docs/registros/2026-09-28-operational-durability-backup-restore-v0.md' },
    ],
    note: 'Restore manual reproduziu os dados, mas saiu mais permissivo que o banco vivo.',
  },
  {
    id: 'recorded:memory.durability:restore-proof-v0-1',
    capabilityId: 'memory.durability',
    evidenceClass: 'assisted_procedure',
    outcome: 'positive',
    observedAt: '2026-09-28T07:06:54Z',
    source: 'recorded_proof',
    environment: 'goma (stack Supabase descartável)',
    scope: 'dimensão State Durable / Restore Proven — dados e 12/12 projeções de segurança equivalentes',
    freshness: 'durable',
    proofRefs: [
      { kind: 'commit', ref: '0b05166' },
      { kind: 'record', ref: 'docs/registros/2026-09-28-operational-durability-backup-restore-v0-1.md' },
      { kind: 'doc', ref: 'supabase/restore-proof/security-projection.sql' },
    ],
    note: 'Procedimento manual de restore com equivalência de segurança — prova o procedimento, não o Anima.',
  },
  {
    id: 'recorded:memory.durability:recovery-config-check-v0',
    capabilityId: 'memory.durability',
    evidenceClass: 'implementation',
    outcome: 'inconclusive',
    observedAt: '2026-09-28T06:54:32Z',
    source: 'recorded_proof',
    scope: 'dimensão Configuration Recoverable — `anima recovery-config check` read-only (primitiva de apoio)',
    freshness: 'durable',
    proofRefs: [
      { kind: 'commit', ref: 'e5b78af' },
      { kind: 'test', ref: 'apps/web/lib/recovery-config/check.test.ts' },
      { kind: 'record', ref: 'docs/registros/2026-09-28-recovery-configuration-v0.md' },
    ],
    note: 'Primitiva read-only implementada; não detecta progresso só-local nem publica cópia remota.',
  },
  {
    id: 'recorded:memory.durability:toolchain-check-v0',
    capabilityId: 'memory.durability',
    evidenceClass: 'implementation',
    outcome: 'inconclusive',
    observedAt: '2026-09-28T07:48:48Z',
    source: 'recorded_proof',
    scope: 'dimensão Toolchain Recoverable — `anima toolchain check` read-only (primitiva de apoio)',
    freshness: 'perishable',
    proofRefs: [
      { kind: 'commit', ref: 'a63cb35' },
      { kind: 'test', ref: 'apps/web/lib/toolchain/check.test.ts' },
      { kind: 'record', ref: 'docs/registros/2026-09-28-toolchain-manifest-v0.md' },
    ],
    note: 'Primitiva read-only implementada; não realiza a durabilidade por si.',
  },

  // ─── compute.paid-settlement — implementação coberta por teste, sem prova viva ─
  {
    id: 'recorded:compute.paid-settlement:provider-api-settlement-b1',
    capabilityId: 'compute.paid-settlement',
    evidenceClass: 'implementation',
    outcome: 'positive',
    observedAt: '2026-09-27T23:07:38Z',
    source: 'recorded_proof',
    scope: 'settlement provider_api por uso reportado × catálogo de preço; exercitado só por testes',
    freshness: 'durable',
    proofRefs: [
      { kind: 'commit', ref: 'e0adff7' },
      { kind: 'test', ref: 'packages/core/src/work-orchestration/provider-api-settlement.test.ts' },
      { kind: 'record', ref: 'docs/registros/2026-09-27e-provider-api-cost-settlement-b1.md' },
    ],
    note: 'Código de settlement exercitado por testes; nenhuma liquidação paga real observada.',
  },
  {
    id: 'recorded:compute.paid-settlement:pricing-catalog-v1-1',
    capabilityId: 'compute.paid-settlement',
    evidenceClass: 'implementation',
    outcome: 'positive',
    observedAt: '2026-09-28T05:09:39Z',
    source: 'recorded_proof',
    scope: 'catálogo oficial de pricing versionado no repo (vigência epistemológica)',
    freshness: 'perishable',
    proofRefs: [
      { kind: 'commit', ref: '2c435b2' },
      { kind: 'record', ref: 'docs/registros/2026-09-28-pricing-catalog-v1-b1c.md' },
    ],
    note: 'Preço oficial versionado; preço de provider envelhece e ainda não foi usado numa liquidação viva.',
  },
];
