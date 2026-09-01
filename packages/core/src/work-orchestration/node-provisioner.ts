// ============================================================
// PROVISIONAMENTO ON-DEMAND V1 — contrato PROVIDER-AGNÓSTICO do provisioner (porta).
//
// O menor contrato abstrato necessário para disponibilizar e desligar um node, sem amarrar
// a arquitetura a nenhum provider. A mesma porta deve servir, no futuro, sem mudar placement:
//   - VM/GPU cloud por hora;
//   - servidor próprio desligado (Wake-on-LAN);
//   - máquina em datacenter;
//   - outro PC da rede.
//
// Aqui há SÓ o contrato e seus tipos. Nenhuma API real de AWS/GCP/etc. O primeiro
// provisioner concreto é controlado/local/fake-realista (um processo/endpoint real na rede
// local), provado através desta MESMA interface que um provider real usará depois.
//
// A porta é deliberadamente pequena: provision (subir), inspect (health/status), stop
// (desligar), e destroy OPCIONAL (só quando "parar" ≠ "destruir o recurso"). Toda a
// governança — autorização financeira, lease, ciclo de vida, evidência, idempotência — vive
// FORA do provisioner, nas camadas puras. O provisioner é só o braço que toca o recurso.
// ============================================================

import type { NodeLeaseV0 } from './node-lease';

export interface NodeProvisionRequest {
  readonly nodeId: string;
  readonly providerId: string;
  readonly model: string;
  readonly resourceClass: string;
  /** Envelope temporal/custo que acompanha a provisão (autoridade da camada de decisão). */
  readonly lease: NodeLeaseV0;
}

/** Referência a um node fisicamente disponível. `endpoint` é onde o coder fala (túnel/
 * loopback controlado). `providerRef` é o id opaco do recurso no provider (instanceId,
 * container id, pid) — a Goma o guarda para poder desligar mesmo se o endpoint cair. */
export interface ProvisionedNodeHandle {
  readonly nodeId: string;
  readonly providerId: string;
  readonly endpoint: string;
  readonly providerRef: string;
}

/** Status observado pela Goma via provisioner. `reachable` = o recurso responde;
 * `healthy` = está apto a servir inferência. A Goma NÃO confia no auto-relato do node —
 * este report é o que o provisioner/host consegue verificar de fora. */
export interface ProviderResourceIdentity {
  readonly nodeId: string;
  readonly providerId: string;
  readonly providerRef: string;
}

/**
 * Observador da camada de governanca. O provisioner informa a identidade assim
 * que o provider a devolve, antes de aguardar readiness/health.
 *
 * false = a identidade nao ficou duravelmente observada; o adapter deve parar
 * de avancar a provisao. O caller continua responsavel pelo teardown/recovery.
 */
export interface NodeProvisionObserver {
  providerIdentified(identity: ProviderResourceIdentity): Promise<boolean>;
}

export interface NodeStatusReport {
  readonly nodeId: string;
  readonly reachable: boolean;
  readonly healthy: boolean;
  readonly detail?: string;
}

export type ProvisionOutcome =
  | { readonly ok: true; readonly handle: ProvisionedNodeHandle }
  | { readonly ok: false; readonly reason: string };

export type StopOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Resultado de LOCALIZAR o recurso que hoje respalda um node lógico (por nodeId), sem criar
 * nada. Usado pela RECONCILIAÇÃO após restart: a Goma perdeu o handle em memória, mas o recurso
 * pago pode continuar de pé. O adapter reconstrói o handle a partir do nodeId (ex.: nome
 * determinístico no provider), permitindo teardown de órfão sem depender de estado volátil. */
export type LocateOutcome =
  | { readonly ok: true; readonly found: false }
  | { readonly ok: true; readonly found: true; readonly handle: ProvisionedNodeHandle }
  | { readonly ok: false; readonly reason: string };

/**
 * Porta do provisionamento. Implementações concretas (fake-realista local, e futuramente
 * providers reais) NÃO decidem nada — recebem um pedido já autorizado/decidido e tocam o
 * recurso. `destroy` é opcional: só existe quando desligar não elimina o recurso (e ele
 * ainda poderia custar). Todas as operações recebem um `AbortSignal` para cancelamento.
 */
export interface NodeProvisioner {
  readonly providerId: string;
  provision(
    request: NodeProvisionRequest,
    signal: AbortSignal,
    observer?: NodeProvisionObserver,
  ): Promise<ProvisionOutcome>;
  inspect(handle: ProvisionedNodeHandle, signal: AbortSignal): Promise<NodeStatusReport>;
  stop(handle: ProvisionedNodeHandle, signal: AbortSignal): Promise<StopOutcome>;
  destroy?(handle: ProvisionedNodeHandle, signal: AbortSignal): Promise<StopOutcome>;
  /** Localiza (sem criar) o recurso que respalda `nodeId` — para reconciliação de órfão após
   * restart. Opcional: providers sem estado durável externo (ex.: processo local que morre com
   * o host) podem devolver `found:false`. */
  locate?(nodeId: string, signal: AbortSignal): Promise<LocateOutcome>;
}
