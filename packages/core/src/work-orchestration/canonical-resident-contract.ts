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
// mais o reader correspondente. O Evolution então rejeitava o evento como
// `semantic_projection_rejected`, quebrando a leitura inteira.
//
// ESTE REGISTRY É O PONTO CENTRAL que enumera esses contratos e amarra ESCRITA e
// LEITURA à MESMA régua: o projector canônico do próprio contrato. Ele não
// substitui os builders (que validam a construção); ele garante, num único ponto
// e fail-closed, a invariante "read-your-writes" no nível do ENVELOPE — o exato
// nível onde o 51929 quebrou:
//
//   nenhuma linha persiste no estado residente um formato canônico que ela
//   própria não consegue reprojetar de volta.
//
// LIMITE HONESTO. Este guard fecha o lado de ESCRITA da classe (uma linha não
// polui o estado residente com o que ela não lê) e torna a introdução de um novo
// formato canônico uma mudança em UM lugar enumerado, verificada por teste
// (writer ⇔ reader). Ele NÃO fecha, sozinho, a regressão de LEITURA entre linhas
// divergentes (linha A escreve formato que a linha B, mais antiga, não lê): isso
// exige namespace isolado OU um carimbo de contrato no envelope persistido —
// ambos mudam a persistência/schema e são decisão humana (migration + checkpoint).
// Ver docs/arquitetura/protecao-contrato-canonico-estado-residente.md.

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
 * Toda carga canônica carrega a mesma correlação mínima; o projector cruza estes
 * campos contra o envelope persistido. As cargas concretas são os V1 de cada
 * contrato (evidência observada ou parecer do Verifier).
 */
export type CanonicalResidentPayload =
  | HostObservedGitEvidenceV1
  | HostObservedGateEvidenceV1
  | HostObservedCoderEvidenceV1
  | VerifierOpinionV1;

interface CanonicalContractDefinition {
  readonly eventType: WorkEventType;
  /** Chave sob `data` onde o envelope carrega a carga: evidência ou parecer. */
  readonly payloadKey: 'evidence' | 'opinion';
  readonly origin: 'host' | 'verifier';
  /**
   * `true` quando a linha ATUAL consegue reprojetar o evento pela MESMA régua
   * semântica usada pelo read-model do Evolution. É a única fonte da verdade de
   * legibilidade — o read-model e o write-guard a compartilham.
   */
  readonly survivesReader: (event: WorkEvent) => boolean;
}

const REGISTRY: Record<CanonicalResidentContractId, CanonicalContractDefinition> = {
  host_observed_evidence: {
    eventType: 'host_observed_evidence_recorded',
    payloadKey: 'evidence',
    origin: 'host',
    survivesReader: (event) => projectHostObservedEvidence([event]) !== null,
  },
  host_observed_gate_evidence: {
    eventType: 'host_observed_gate_evidence_recorded',
    payloadKey: 'evidence',
    origin: 'host',
    survivesReader: (event) => projectHostObservedGateEvidence([event]) !== null,
  },
  host_observed_coder_evidence: {
    eventType: 'host_observed_coder_evidence_recorded',
    payloadKey: 'evidence',
    origin: 'host',
    survivesReader: (event) => projectHostObservedCoderEvidence([event]) !== null,
  },
  verifier_opinion: {
    eventType: 'verifier_opinion_recorded',
    payloadKey: 'opinion',
    origin: 'verifier',
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

/**
 * Sintetiza o evento COMO O LEITOR O VERÁ, a partir da própria correlação da
 * carga. É fiel ao que a RPC de gravação materializa no envelope (`data.*`
 * derivado da própria evidência), então reprojetá-lo aqui é reproduzir a leitura
 * do Evolution antes de persistir.
 */
function synthesizeReaderEvent(
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
 * se a linha atual conseguir reprojetá-la de volta pela régua do read-model.
 *
 * - contrato desconhecido ⇒ recusa (um formato novo tem de ser registrado aqui);
 * - carga que o reader não reprojeta ⇒ recusa (é justamente o formato divergente
 *   que quebraria o Evolution — bloqueado ANTES de tocar o estado residente).
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

  const event = synthesizeReaderEvent(definition, payload);
  if (!definition.survivesReader(event)) {
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

/**
 * Régua de LEITURA compartilhada: `true` quando o evento — se carregar um contrato
 * canônico do estado residente — sobrevive ao projector do seu contrato. Eventos
 * que não carregam contrato canônico ficam fora do escopo desta boundary e
 * retornam `true` (não são reinterpretados aqui). É a mesma régua do write-guard,
 * de modo que escrita e leitura não podem divergir dentro de uma linha.
 */
export function isCanonicalResidentEventReadable(event: WorkEvent): boolean {
  for (const id of CANONICAL_RESIDENT_CONTRACT_IDS) {
    const definition = REGISTRY[id];
    if (definition.eventType === event.type) {
      return definition.survivesReader(event);
    }
  }
  return true;
}
