import type { Json } from '@anima/types';
import type { WorkEvent, WorkEventType } from './types';
import { projectHostObservedEvidence, type HostObservedGitEvidenceV1 } from './host-observed-evidence';
import { projectHostObservedGateEvidence, type HostObservedGateEvidenceV1 } from './host-observed-gate-evidence';
import { projectHostObservedCoderEvidence, type HostObservedCoderEvidenceV1 } from './host-observed-coder-evidence';
import { projectVerifierOpinionHistory, type VerifierOpinionV1 } from './verifier-opinion';

// ============================================================
// Contrato canônico do ESTADO RESIDENTE (work_events)
// ============================================================
//
// PROBLEMA ESTRUTURAL (classe do incidente 51929).
// Um formato canônico persistível é aquele cuja evidência, gravada no log
// append-only `work_events`, é REPROJETADA depois pelo Capability Proof Engine /
// Evolution. Cada formato tem DOIS lados que precisam concordar: um PRODUTOR que
// o escreve e um LEITOR (a linha autoritativa) que precisa reprojetá-lo de volta.
//
// O incidente 51929 nasceu da DIVERGÊNCIA entre esses dois lados entre linhas de
// código: uma linha (snapshot/Harness V3) persistiu transcripts do coder com
// `runtimeEvents` — um formato novo — e uma linha `dev` posterior não carregava
// mais o reader correspondente, quebrando o Evolution com semantic_projection_rejected.
//
// DUAS CAMADAS DE PROTEÇÃO, uma superfície central (este módulo):
//
// 1. READ-YOUR-WRITES (lado de escrita, dentro de uma linha).
//    `guardCanonicalResidentWrite` recusa persistir uma carga que a própria linha
//    não reprojeta de volta. Impede uma linha de poluir o estado residente com o
//    que ela mesma não lê.
//
// 2. CARIMBO DE CONTRATO (lado de leitura, ENTRE linhas).
//    Todo evento canônico carrega `payload.canonical_contract = { id, version }`
//    (carimbado autoritativamente pelo trigger de work_events). O leitor observa a
//    IDENTIDADE SEMÂNTICA do contrato ANTES de tentar o projector específico e
//    classifica: legível, contrato desconhecido, versão não suportada (futura) ou
//    payload realmente inválido. Assim uma linha mais antiga que encontra uma
//    versão futura reporta INCOMPATIBILIDADE (reconciliação), nunca "corrupção".
//
// O carimbo representa SEMÂNTICA DO CONTRATO — nunca SHA de commit, branch ou
// identidade efêmera de código. Ver
// docs/arquitetura/protecao-contrato-canonico-estado-residente.md.

/**
 * Identidade estável de cada contrato persistível no estado residente cuja
 * evidência é projetada pelo read-model do Evolution. Introduzir um novo formato
 * canônico persistível é, por construção, adicionar um membro aqui.
 */
export type CanonicalResidentContractId =
  | 'host_observed_evidence'
  | 'host_observed_gate_evidence'
  | 'host_observed_coder_evidence'
  | 'verifier_opinion';

/**
 * Cargas concretas persistidas: os V1 de cada contrato (evidência observada ou
 * parecer do Verifier). Todas compartilham a correlação mínima que o projector
 * cruza contra o envelope.
 */
export type CanonicalResidentPayload =
  | HostObservedGitEvidenceV1
  | HostObservedGateEvidenceV1
  | HostObservedCoderEvidenceV1
  | VerifierOpinionV1;

/**
 * Versão canônica inferida para eventos LEGADOS (anteriores ao carimbo). É
 * determinística: cada um dos quatro contratos só teve a versão 1, então um evento
 * canônico sem carimbo pertence à versão 1. Não é backfill que inventa versão —
 * é a única versão que já existiu.
 */
export const LEGACY_CANONICAL_CONTRACT_VERSION = 1 as const;

interface CanonicalContractDefinition {
  readonly eventType: WorkEventType;
  /** Chave sob `data` onde o envelope carrega a carga: evidência ou parecer. */
  readonly payloadKey: 'evidence' | 'opinion';
  readonly origin: 'host' | 'verifier';
  /** Versão canônica ATUAL que esta linha escreve (carimbada pelo servidor). */
  readonly writeVersion: number;
  /** Versões que esta linha consegue LER. Invariante: writeVersion ∈ readableVersions. */
  readonly readableVersions: readonly number[];
  /**
   * `true` quando a linha ATUAL consegue reprojetar o evento pela MESMA régua
   * semântica usada pelo read-model do Evolution.
   */
  readonly survivesReader: (event: WorkEvent) => boolean;
}

const REGISTRY: Record<CanonicalResidentContractId, CanonicalContractDefinition> = {
  host_observed_evidence: {
    eventType: 'host_observed_evidence_recorded',
    payloadKey: 'evidence',
    origin: 'host',
    writeVersion: 1,
    readableVersions: [1],
    survivesReader: (event) => projectHostObservedEvidence([event]) !== null,
  },
  host_observed_gate_evidence: {
    eventType: 'host_observed_gate_evidence_recorded',
    payloadKey: 'evidence',
    origin: 'host',
    writeVersion: 1,
    readableVersions: [1],
    survivesReader: (event) => projectHostObservedGateEvidence([event]) !== null,
  },
  host_observed_coder_evidence: {
    eventType: 'host_observed_coder_evidence_recorded',
    payloadKey: 'evidence',
    origin: 'host',
    writeVersion: 1,
    readableVersions: [1],
    survivesReader: (event) => projectHostObservedCoderEvidence([event]) !== null,
  },
  verifier_opinion: {
    eventType: 'verifier_opinion_recorded',
    payloadKey: 'opinion',
    origin: 'verifier',
    writeVersion: 1,
    readableVersions: [1],
    // O projector do parecer é tolerante (pula inválidos); "sobrevive" = exatamente
    // um parecer projetado a partir do evento único, espelhando o read-boundary.
    survivesReader: (event) => projectVerifierOpinionHistory([event]).length === 1,
  },
};

export const CANONICAL_RESIDENT_CONTRACT_IDS: readonly CanonicalResidentContractId[] =
  Object.keys(REGISTRY) as CanonicalResidentContractId[];

/** Tipos de evento de work_events que carregam um contrato canônico do estado residente. */
export function canonicalResidentEventTypes(): readonly WorkEventType[] {
  return CANONICAL_RESIDENT_CONTRACT_IDS.map((id) => REGISTRY[id].eventType);
}

/** Versão canônica atual (de escrita) de um contrato — a autoridade do registry. */
export function canonicalResidentWriteVersion(id: CanonicalResidentContractId): number {
  return REGISTRY[id].writeVersion;
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  !!value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Identidade do contrato como o trigger a carimba no envelope. */
export interface CanonicalContractStamp {
  readonly id: string;
  readonly version: number;
}

/**
 * Lê o carimbo genérico `payload.canonical_contract` — a identidade semântica do
 * contrato, observável ANTES do projector específico. `undefined` = evento legado
 * (sem carimbo); `null` = carimbo presente porém malformado.
 */
export function readCanonicalContractStamp(event: WorkEvent): CanonicalContractStamp | null | undefined {
  const payload = asObject(event.payload);
  if (!payload || !('canonical_contract' in payload)) return undefined;
  const stamp = asObject(payload.canonical_contract);
  if (!stamp) return null;
  const { id, version } = stamp;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return null;
  return { id, version };
}

/**
 * Classificação de leitura de um evento do estado residente. Distingue as quatro
 * situações que o incidente 51929 confundia num único `event_history_invalid`.
 */
export type CanonicalContractReadClassification =
  | { readonly kind: 'not_canonical' }
  | { readonly kind: 'readable'; readonly contractId: CanonicalResidentContractId; readonly version: number }
  | { readonly kind: 'unsupported_contract'; readonly contractId: string }
  | {
      readonly kind: 'unsupported_contract_version';
      readonly contractId: CanonicalResidentContractId;
      readonly version: number;
      readonly readableVersions: readonly number[];
    }
  | { readonly kind: 'invalid_payload'; readonly contractId: CanonicalResidentContractId };

function entryForEventType(type: WorkEventType): { id: CanonicalResidentContractId; def: CanonicalContractDefinition } | null {
  for (const id of CANONICAL_RESIDENT_CONTRACT_IDS) {
    if (REGISTRY[id].eventType === type) return { id, def: REGISTRY[id] };
  }
  return null;
}

/**
 * Classifica um evento persistido lendo o carimbo ANTES do projector específico:
 *
 * - evento fora dos contratos canônicos → `not_canonical` (semântica atual);
 * - carimbo presente com id desconhecido → `unsupported_contract`;
 * - carimbo presente com versão fora das legíveis → `unsupported_contract_version`
 *   (é versão futura/não reconciliada — NÃO corrupção);
 * - carimbo ausente (legado) → versão 1 inferida deterministicamente;
 * - versão legível + projector aprova → `readable`;
 * - versão legível + projector recusa (ou carimbo malformado/incoerente) → `invalid_payload`.
 */
export function classifyCanonicalResidentEvent(event: WorkEvent): CanonicalContractReadClassification {
  const entry = entryForEventType(event.type);
  if (!entry) return { kind: 'not_canonical' };

  const stamp = readCanonicalContractStamp(event);

  // Carimbo presente e bem-formado: a identidade declarada manda na classificação.
  if (stamp) {
    if (!(stamp.id in REGISTRY)) {
      return { kind: 'unsupported_contract', contractId: stamp.id };
    }
    // Envelope incoerente: o id carimbado não corresponde ao event_type persistido.
    if (REGISTRY[stamp.id as CanonicalResidentContractId].eventType !== event.type) {
      return { kind: 'invalid_payload', contractId: entry.id };
    }
    if (!entry.def.readableVersions.includes(stamp.version)) {
      return {
        kind: 'unsupported_contract_version',
        contractId: entry.id,
        version: stamp.version,
        readableVersions: entry.def.readableVersions,
      };
    }
    return entry.def.survivesReader(event)
      ? { kind: 'readable', contractId: entry.id, version: stamp.version }
      : { kind: 'invalid_payload', contractId: entry.id };
  }

  // Carimbo presente porém malformado (readCanonicalContractStamp === null): corrupção.
  if (stamp === null) return { kind: 'invalid_payload', contractId: entry.id };

  // Sem carimbo (legado): versão 1 inferida; projeta pela régua atual.
  return entry.def.survivesReader(event)
    ? { kind: 'readable', contractId: entry.id, version: LEGACY_CANONICAL_CONTRACT_VERSION }
    : { kind: 'invalid_payload', contractId: entry.id };
}

/**
 * Régua de LEITURA compartilhada: `true` quando o evento é legível ou não pertence
 * a um contrato canônico. `false` para QUALQUER incompatibilidade/corrupção — o
 * caller decide o diagnóstico exato via `classifyCanonicalResidentEvent`.
 */
export function isCanonicalResidentEventReadable(event: WorkEvent): boolean {
  const kind = classifyCanonicalResidentEvent(event).kind;
  return kind === 'readable' || kind === 'not_canonical';
}

/**
 * Sintetiza o evento COMO O LEITOR O VERÁ, a partir da própria correlação da
 * carga e do carimbo canônico que o trigger materializa. Reprojetá-lo aqui é
 * reproduzir a leitura do Evolution antes de persistir.
 */
function synthesizeReaderEvent(
  contractId: CanonicalResidentContractId,
  definition: CanonicalContractDefinition,
  payload: CanonicalResidentPayload,
): WorkEvent {
  return {
    id: 'canonical-resident-write-guard',
    workItemId: payload.workItemId,
    type: definition.eventType,
    author: 'system',
    proposalVersion: payload.approvedProposalVersion,
    payload: {
      schema_version: 1,
      canonical_contract: { id: contractId, version: definition.writeVersion },
      data: {
        work_item_id: payload.workItemId,
        attempt_id: payload.attemptId,
        approved_proposal_version: payload.approvedProposalVersion,
        origin: definition.origin,
        [definition.payloadKey]: payload as unknown as Json,
      },
    } as unknown as Json,
    // Os projectors canônicos não leem `occurredAt`; um instante finito basta.
    occurredAt: new Date(0),
  };
}

export type CanonicalResidentWriteGuard =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'unknown_canonical_contract' | 'unreadable_by_authoritative_reader';
      readonly contractId: string;
      readonly explanation: string;
    };

/**
 * Guarda fail-closed do lado de ESCRITA: só autoriza persistir uma carga canônica
 * se a linha atual conseguir reprojetá-la de volta (na versão de escrita) pela
 * régua do read-model.
 */
export function guardCanonicalResidentWrite(
  contractId: CanonicalResidentContractId,
  payload: CanonicalResidentPayload,
): CanonicalResidentWriteGuard {
  const definition = REGISTRY[contractId];
  if (!definition) {
    return {
      ok: false,
      reason: 'unknown_canonical_contract',
      contractId: String(contractId),
      explanation:
        'Contrato canônico não registrado: um novo formato persistível precisa ser enumerado no registry e ter reader.',
    };
  }

  const event = synthesizeReaderEvent(contractId, definition, payload);
  if (classifyCanonicalResidentEvent(event).kind !== 'readable') {
    return {
      ok: false,
      reason: 'unreadable_by_authoritative_reader',
      contractId,
      explanation:
        'A carga canônica não sobrevive ao projector do próprio contrato: a linha atual não conseguiria ler de volta o que gravaria.',
    };
  }

  return { ok: true };
}
