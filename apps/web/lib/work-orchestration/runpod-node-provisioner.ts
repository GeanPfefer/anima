import type {
  LocateOutcome,
  NodePriceHintV0,
  NodeProvisioner,
  NodeProvisionObserver,
  NodeProvisionRequest,
  NodeStatusReport,
  ProvisionedNodeHandle,
  ProvisionOutcome,
  StopOutcome,
} from '@anima/core';
import { createConnection } from 'node:net';
import { SshRunPodTunnelManager, type RunPodTunnel, type RunPodTunnelManager } from './runpod-ssh-tunnel';
import { renderRunPodBootstrapScript } from './runpod-bootstrap';

// ============================================================
// PRIMEIRO ADAPTER DE PROVIDER REAL (RunPod) — TEST-ONLY / env-gated / SEM efeito real.
//
// Implementa a porta `NodeProvisioner` contra a REST API do RunPod (POST /pods,
// GET /pods/{id}, POST /pods/{id}/stop, DELETE /pods/{id}). É a MESMA porta do
// `LocalProcessNodeProvisioner`: toda a governança (lifecycle, lease, evidência,
// autorização financeira) permanece FORA — o adapter só toca o recurso QUANDO PERMITIDO.
//
// Este recorte NÃO chama a cloud de verdade: o `HttpClient` é injetável e os testes usam
// fixtures/mocks. A seleção só liga o RunPod sob env-gate + API key presente + autorização
// paga válida (ver `resolveOnDemandProvisioner`). O provider é escolhido, mas incapaz de
// gerar gasto sem esses gates.
//
// CREDENCIAL: a API key vem SOMENTE de env (`ANIMA_RUNPOD_API_KEY`), fica só em memória do
// adapter, entra apenas no header Authorization, e NUNCA é persistida, logada ou incluída em
// evidência/erros (redigida em qualquer mensagem). Ausência = fail-closed.
//
// SAÚDE: a Goma NÃO confia apenas no status do provider. Após o provider reportar RUNNING, o
// `inspect` faz um health-check EXTERNO ao endpoint real de inferência; só então o lifecycle
// (fora daqui) pode ir a `ready`.
// ============================================================

/** Códigos de erro estáveis; mapeiam erros provider-specific sem vazar payload sensível. */
export type RunPodErrorCode =
  | 'auth_invalid'
  | 'quota_exceeded'
  | 'capacity_unavailable'
  // Pod ficou RUNNING mas o endpoint (publicIp + porta 22) não publicou dentro do deadline de
  // publicação (`endpointPublicationDeadlineMs`).
  // Distinto de `capacity_unavailable` (nunca chegou a RUNNING): a capacidade existiu; só a janela
  // de publicação do endpoint foi curta. NÃO é produzido por `classifyRunPodError` (só pelo loop de
  // readiness), então não colide com o mapeamento de status HTTP.
  | 'endpoint_unpublished'
  // Pod foi CRIADO e a REST do provider seguiu alcançável (getPod respondendo), mas o túnel para
  // ESTA máquina não ficou utilizável dentro do `tunnelReadyTimeoutMs`: o mapping publicou e depois
  // oscilou/sumiu (`mapping_absent`), o TCP publicado nunca ficou roteável (`tcp_unreachable`), o
  // `ssh`/túnel não subiu (`ssh_not_ready`) ou o Pod terminou durante a espera (`resource_gone`).
  // É falha DE PLACEMENT/MÁQUINA — RECUPERÁVEL trocando de máquina/SKU —, NÃO indisponibilidade
  // GLOBAL do provider: só `openTunnel` o produz. A indisponibilidade global continua sendo
  // `provider_unreachable`, emitida SOMENTE nos sites de chamada REST (create/list/get/stop/destroy)
  // quando a própria API fica inalcançável — é lá que a "evidência global" aparece.
  | 'tunnel_unavailable'
  | 'rate_limited'
  | 'provider_unreachable'
  | 'provision_failed'
  | 'stop_failed';

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}
export interface HttpRequestInput {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal: AbortSignal;
}
/** Transporte injetável. `send` NUNCA lança por status HTTP (só por rede/abort). */
export interface HttpClient {
  send(input: HttpRequestInput): Promise<HttpResponse>;
}

/** Teto por-requisição do transporte HTTP (anti-hang). SEM ele, um único `fetch` cuja conexão
 * abre mas o servidor nunca responde (clássico em cold-start de GPU) pendura para sempre: os
 * deadlines dos laços de provisão (`awaitEndpoint`/`awaitModelReady`/price-quote) só são checados
 * ENTRE requisições, então NUNCA são alcançados enquanto UMA requisição está pendurada — e o
 * host-turn fica em `state=running` indefinidamente. Bounded por env; o mesmo padrão que
 * `externalHealth` já usava, agora no transporte para TODA requisição herdar o limite. */
export const DEFAULT_RUNPOD_HTTP_TIMEOUT_MS = 30_000;
export const runpodHttpTimeoutMs = (env: Record<string, string | undefined> = process.env): number =>
  positiveInt(env.ANIMA_RUNPOD_HTTP_TIMEOUT_MS, DEFAULT_RUNPOD_HTTP_TIMEOUT_MS);

/** Cliente HTTP padrão sobre o `fetch` global (Node 24+). Erros de rede/timeout viram exceção,
 * que o adapter traduz para `provider_unreachable` — nunca vaza stack/segredo. O timeout por
 * requisição compõe com o `signal` do chamador: aborta no PRIMEIRO dos dois (deadline ou cancel). */
export const fetchHttpClient: HttpClient = {
  async send({ method, url, headers, body, signal }) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), runpodHttpTimeoutMs());
    try {
      const response = await fetch(url, { method, headers: headers as HeadersInit, body, signal: controller.signal });
      return { status: response.status, body: await response.text() };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  },
};

// ============================================================
// READINESS EM CAMADAS (Fase 2): antes de tentar o `ssh`, uma sonda TCP explícita ao endpoint
// publicado separa "endpoint publicado mas ainda NÃO roteável" (a falha observada na última prova
// viva — TCP timeout) de "sshd/handshake/auth ainda não prontos". Sem esta camada, ambos colapsam
// no mesmo `provider_unreachable` e a causa fica inatribuível. A sonda é injetável (fail-closed nos
// testes, que nunca tocam a rede real) e NUNCA carrega segredo.
// ============================================================
export type TcpReachability = 'reachable' | 'refused' | 'timeout' | 'error';
export interface TcpProbe {
  probe(host: string, port: number, timeoutMs: number, signal: AbortSignal): Promise<TcpReachability>;
}
export const DEFAULT_RUNPOD_TCP_PROBE_TIMEOUT_MS = 5_000;
export const runpodTcpProbeTimeoutMs = (env: Record<string, string | undefined> = process.env): number =>
  positiveInt(env.ANIMA_RUNPOD_TCP_PROBE_TIMEOUT_MS, DEFAULT_RUNPOD_TCP_PROBE_TIMEOUT_MS);

/** Sonda TCP real: uma tentativa de `connect` bounded; classifica o resultado sem abrir túnel nem
 * trocar dados. Sempre destrói o socket. Coopera com o `signal` externo (cancelamento). */
export const netTcpProbe: TcpProbe = {
  probe(host, port, timeoutMs, signal) {
    return new Promise<TcpReachability>(resolve => {
      if (signal.aborted) return resolve('error');
      const socket = createConnection({ host, port });
      let settled = false;
      const done = (result: TcpReachability): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = () => done('error');
      signal.addEventListener('abort', onAbort, { once: true });
      socket.setTimeout(timeoutMs, () => done('timeout'));
      socket.once('connect', () => done('reachable'));
      socket.once('error', (error: NodeJS.ErrnoException) =>
        done(error.code === 'ECONNREFUSED' ? 'refused' : error.code === 'ETIMEDOUT' ? 'timeout' : 'error'));
    });
  },
};

export interface RunPodProvisionerConfig {
  readonly apiBase: string;
  readonly apiKey: string;
  readonly imageName: string;
  readonly gpuTypeIds: readonly string[];
  readonly gpuCount: number;
  readonly cloudType: 'SECURE' | 'COMMUNITY';
  readonly containerDiskInGb: number;
  readonly volumeInGb: number;
  readonly networkVolumeId: string | null;
  /** Porta HTTP que serve inferência dentro do pod (ex.: 11434 do Ollama). */
  readonly inferencePort: number;
  readonly healthPath: string;
  readonly sshPrivateKeyPath: string;
  readonly sshKnownHostsPath: string;
  readonly sshPublicKey: string;
  /** Env estático passado ao pod. NUNCA contém a API key do control-plane. */
  readonly podEnv: Readonly<Record<string, string>>;
}

/**
 * DEADLINE DE PUBLICAÇÃO DO ENDPOINT — política EXPLÍCITA (Resilient Cloud Session V1). Separado dos
 * timeouts de camadas posteriores (`tunnelReadyTimeoutMs` = TCP+ssh; `tcpProbeTimeoutMs` = por
 * sonda): esta é a janela para o Pod, uma vez RUNNING, PUBLICAR `publicIp`+porta 22.
 *
 * EVIDÊNCIA (duas provas vivas 2026-09-10): uma máquina publicou endpoint dentro de ~minutos e
 * chegou ao TCP; outra ficou RUNNING com `publicIp`/`portMappings` vazios por toda a janela de 300s.
 * O tempo de publicação VARIA por máquina. Um default de 300s é curto o bastante para condenar
 * máquinas lentas-porém-boas. 540s (9 min) dá folga conservadora a uma máquina lenta sem imobilizar
 * a sessão indefinidamente — e, crucialmente, ESTOURAR o deadline agora HABILITA reprovisionamento
 * (trocar de máquina), não termina a sessão inteira: `awaitEndpoint` devolve `endpoint_unpublished`,
 * que a sessão resiliente classifica como placement recuperável.
 */
export const DEFAULT_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS = 540_000;
export const runpodEndpointPublicationDeadlineMs = (env: Record<string, string | undefined> = process.env): number =>
  positiveInt(env.ANIMA_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS,
    positiveInt(env.ANIMA_RUNPOD_MAX_PROVISION_MS, DEFAULT_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS));

export interface RunPodProvisionerOptions {
  readonly pollIntervalMs?: number;
  /** @deprecated alias de compat de `endpointPublicationDeadlineMs`. Precedência:
   * `endpointPublicationDeadlineMs` > `maxProvisionMs` > env > default. */
  readonly maxProvisionMs?: number;
  /** Deadline explícito para o Pod RUNNING publicar o endpoint (ver constante acima). */
  readonly endpointPublicationDeadlineMs?: number;
  readonly healthTimeoutMs?: number;
  /** Teto para o túnel SSH aceitar conexão (o `sshd` só sobe no meio do bootstrap; a 1ª tentativa
   * quase sempre falha em cold-start). Retry bounded até este teto. */
  readonly tunnelReadyTimeoutMs?: number;
  /** Teto para o modelo ficar servível no endpoint (o bootstrap faz `ollama pull` dentro do Pod;
   * pode levar minutos p/ ~19 GB). Após provision o modelo já está presente ⇒ health passa. */
  readonly modelReadyTimeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly tunnelManager?: RunPodTunnelManager;
  /** Sonda TCP injetável (Fase 2). Default real sobre `node:net`; testes injetam um fake
   * determinístico e nunca tocam a rede. */
  readonly tcpProbe?: TcpProbe;
  /** Teto por-sonda TCP (bounded, anti-hang). */
  readonly tcpProbeTimeoutMs?: number;
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseJson = (text: string): unknown => { try { return JSON.parse(text); } catch { return null; } };

const positiveInt = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** Lê a config do adapter SÓ do ambiente; `null` (fail-closed) sem API key/imagem/GPU. A API
 * key nunca é devolvida por nenhuma outra via e nunca é logada. */
export function readRunPodProvisionerConfig(
  env: Record<string, string | undefined> = process.env,
): RunPodProvisionerConfig | null {
  const apiKey = env.ANIMA_RUNPOD_API_KEY?.trim();
  const imageName = env.ANIMA_RUNPOD_IMAGE?.trim();
  const gpuTypeIds = (env.ANIMA_RUNPOD_GPU_TYPE_IDS ?? '').split(',').map(v => v.trim()).filter(Boolean);
  const sshPrivateKeyPath = env.ANIMA_RUNPOD_SSH_PRIVATE_KEY?.trim();
  const sshKnownHostsPath = env.ANIMA_RUNPOD_SSH_KNOWN_HOSTS?.trim();
  const sshPublicKey = env.ANIMA_RUNPOD_SSH_PUBLIC_KEY?.trim();
  if (!apiKey || !imageName || gpuTypeIds.length === 0 || !sshPrivateKeyPath || !sshKnownHostsPath || !sshPublicKey) return null;
  let podEnv: Record<string, string> = {};
  if (env.ANIMA_RUNPOD_POD_ENV_JSON) {
    const parsed = asObject(parseJson(env.ANIMA_RUNPOD_POD_ENV_JSON));
    if (parsed) {
      for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') podEnv[k] = v;
    }
  }
  return {
    apiBase: (env.ANIMA_RUNPOD_API_BASE?.trim() || 'https://rest.runpod.io/v1').replace(/\/+$/, ''),
    apiKey,
    imageName,
    gpuTypeIds,
    gpuCount: positiveInt(env.ANIMA_RUNPOD_GPU_COUNT, 1),
    cloudType: env.ANIMA_RUNPOD_CLOUD_TYPE?.trim().toUpperCase() === 'COMMUNITY' ? 'COMMUNITY' : 'SECURE',
    containerDiskInGb: positiveInt(env.ANIMA_RUNPOD_CONTAINER_DISK_GB, 50),
    volumeInGb: Number.isInteger(Number(env.ANIMA_RUNPOD_VOLUME_GB)) && Number(env.ANIMA_RUNPOD_VOLUME_GB) >= 0
      ? Number(env.ANIMA_RUNPOD_VOLUME_GB) : 0,
    networkVolumeId: env.ANIMA_RUNPOD_NETWORK_VOLUME_ID?.trim() || null,
    inferencePort: positiveInt(env.ANIMA_RUNPOD_INFERENCE_PORT, 11434),
    healthPath: env.ANIMA_RUNPOD_HEALTH_PATH?.trim() || '/',
    sshPrivateKeyPath,
    sshKnownHostsPath,
    sshPublicKey,
    podEnv,
  };
}

/** Classifica um erro do RunPod em código estável — PURO. Não recebe nem devolve segredo.
 * `message` já deve vir redigida. */
export function classifyRunPodError(status: number, message: string): RunPodErrorCode {
  const text = message.toLowerCase();
  if (status === 401 || status === 403) return 'auth_invalid';
  if (status === 429) return 'rate_limited';
  if (status === 402) return 'quota_exceeded';
  if (/quota|insufficient|balance|payment|spending limit/.test(text)) return 'quota_exceeded';
  if (/no (available|instances|gpus)|capacity|unavailable|out of stock|no longer any instances/.test(text)) return 'capacity_unavailable';
  if (status >= 500) return 'provider_unreachable';
  return 'provision_failed';
}

interface PodView {
  readonly id: string;
  readonly name: string | null;
  readonly desiredStatus: string;
  readonly publicIp: string | null;
  readonly portMappings: Record<string, number>;
  readonly costPerHr: number | null;
}

const parsePod = (value: unknown): PodView | null => {
  const root = asObject(value);
  if (!root || typeof root.id !== 'string' || root.id.trim().length === 0) return null;
  const mappings: Record<string, number> = {};
  const pm = asObject(root.portMappings);
  if (pm) for (const [k, v] of Object.entries(pm)) if (typeof v === 'number') mappings[k] = v;
  return {
    id: root.id,
    name: typeof root.name === 'string' && root.name.length > 0 ? root.name : null,
    desiredStatus: typeof root.desiredStatus === 'string' ? root.desiredStatus : 'UNKNOWN',
    publicIp: typeof root.publicIp === 'string' && root.publicIp.length > 0 ? root.publicIp : null,
    portMappings: mappings,
    costPerHr: typeof root.costPerHr === 'number' && Number.isFinite(root.costPerHr) && root.costPerHr >= 0 ? root.costPerHr : null,
  };
};

const parsePodList = (value: unknown): PodView[] => {
  const arr = Array.isArray(value) ? value
    : Array.isArray(asObject(value)?.pods) ? (asObject(value)!.pods as unknown[])
    : Array.isArray(asObject(value)?.data) ? (asObject(value)!.data as unknown[])
    : [];
  return arr.map(parsePod).filter((p): p is PodView => p !== null);
};

const TERMINAL = new Set(['EXITED', 'TERMINATED']);

// REQUISITO DE REDE do node (não literal solto): este adapter acessa o node SEMPRE por SSH sobre
// TCP/22 (`SshRunPodTunnelManager`). Logo o create SEMPRE precisa (a) expor a porta TCP 22 e
// (b) pedir IP público. `ports` no formato REST v1 `"[porta]/[protocolo]"`. Em SECURE o IP público
// é garantido pelo provider; em COMMUNITY `supportPublicIp` é o flag documentado — "se null, o Pod
// pode não ter IP público" — então declaramos `true` para remover a ambiguidade e casar o requisito
// do túnel em qualquer cloudType. NÃO expor portas adicionais.
const SSH_TUNNEL_TCP_PORT = '22/tcp';

export class RunPodNodeProvisioner implements NodeProvisioner {
  readonly providerId = 'runpod';
  private readonly pollIntervalMs: number;
  private readonly endpointPublicationDeadlineMs: number;
  private readonly healthTimeoutMs: number;
  private readonly tunnelReadyTimeoutMs: number;
  private readonly modelReadyTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly tunnels: RunPodTunnelManager;
  private readonly tcpProbe: TcpProbe;
  private readonly tcpProbeTimeoutMs: number;
  private readonly openTunnels = new Map<string, RunPodTunnel>();

  constructor(
    private readonly config: RunPodProvisionerConfig,
    private readonly http: HttpClient = fetchHttpClient,
    options: RunPodProvisionerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.endpointPublicationDeadlineMs = options.endpointPublicationDeadlineMs ?? options.maxProvisionMs
      ?? runpodEndpointPublicationDeadlineMs();
    this.healthTimeoutMs = options.healthTimeoutMs ?? 5_000;
    this.tunnelReadyTimeoutMs = options.tunnelReadyTimeoutMs ?? positiveInt(process.env.ANIMA_RUNPOD_TUNNEL_READY_TIMEOUT_MS, 180_000);
    this.modelReadyTimeoutMs = options.modelReadyTimeoutMs ?? positiveInt(process.env.ANIMA_RUNPOD_MODEL_READY_TIMEOUT_MS, 900_000);
    this.sleep = options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
    this.tunnels = options.tunnelManager ?? new SshRunPodTunnelManager({
      privateKeyPath: config.sshPrivateKeyPath,
      knownHostsPath: config.sshKnownHostsPath,
    });
    this.tcpProbe = options.tcpProbe ?? netTcpProbe;
    this.tcpProbeTimeoutMs = options.tcpProbeTimeoutMs ?? runpodTcpProbeTimeoutMs();
  }

  private lastPriceHint: NodePriceHintV0 | null = null;

  /** Preço observado do último provision como HINT (Missão 8) — NUNCA custo final imutável; a
   * autorização humana continua o gate. `null` quando o provider não informou preço. */
  priceHint(): NodePriceHintV0 | null {
    return this.lastPriceHint;
  }

  /** Redige a API key de qualquer mensagem antes de expô-la. Defesa em profundidade: o header
   * nunca é ecoado, mas garantimos que nem a chave nem `Bearer …` vazem em `reason`/`detail`. */
  private redact(text: string): string {
    return text.split(this.config.apiKey).join('***').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***').slice(0, 200);
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' };
  }

  // Nome DETERMINÍSTICO por node: um replay de provision (ou a reconciliação após restart)
  // encontra o mesmo pod pelo nome, sem depender de estado volátil.
  private nameFor(nodeId: string): string { return `anima-${nodeId}`; }
  private podName(request: NodeProvisionRequest): string { return this.nameFor(request.nodeId); }

  /** Localiza o pod que respalda `nodeId` pelo nome determinístico — para reconciliação de
   * órfão. Não cria nada. `found:false` quando não há pod não-terminal com esse nome. */
  async locate(nodeId: string, signal: AbortSignal): Promise<LocateOutcome> {
    const found = await this.findPodByName(this.nameFor(nodeId), signal);
    if (!found.ok) return { ok: false, reason: found.reason };
    if (!found.pod) return { ok: true, found: false };
    // Reconciliação só precisa da identidade para stop/destroy; não abre transporte novo.
    return { ok: true, found: true, handle: { nodeId, providerId: this.providerId, endpoint: '', providerRef: found.pod.id } };
  }

  async provision(request: NodeProvisionRequest, signal: AbortSignal, observer?: NodeProvisionObserver): Promise<ProvisionOutcome> {
    if (signal.aborted) return { ok: false, reason: 'aborted' };
    const name = this.podName(request);

    // Idempotência: reusa um pod não-terminal com o mesmo nome antes de criar outro.
    const existing = await this.findPodByName(name, signal);
    if (!existing.ok) return { ok: false, reason: existing.reason };
    let podId = existing.pod?.id ?? null;

    if (podId === null) {
      const created = await this.createPod(name, request, signal);
      if (!created.ok) return { ok: false, reason: created.reason };
      podId = created.pod.id;
    }

    // IDENTIDADE ANTES DE READINESS: assim que o recurso faturável tem id (pod existente OU
    // recém-criado), informa a governança ANTES de qualquer polling de readiness. Se a identidade
    // não ficou duravelmente observada (`false`), PARA a progressão — não faz polling, não cria
    // segundo recurso; o caller é dono do teardown/recovery pelo providerRef que já conhece.
    if (observer) {
      const persisted = await observer.providerIdentified({ nodeId: request.nodeId, providerId: this.providerId, providerRef: podId });
      if (!persisted) return { ok: false, reason: 'provider_identity_unpersisted' };
    }

    const ready = await this.awaitEndpoint(podId, signal);
    if (!ready.ok) return { ok: false, reason: ready.reason };
    const endpoint = await this.openTunnel(ready.pod, signal);
    // openTunnel só retorna null DEPOIS de o Pod existir e a REST do provider ter respondido durante
    // toda a espera (o próprio loop `getPod` reconsulta o provider): a máquina/endpoint desta SKU é
    // que não ficou utilizável (mapping oscilou, TCP não roteou, ssh não subiu, ou o Pod terminou).
    // Isso é RECUPERÁVEL POR PLACEMENT (trocar de máquina/SKU), NÃO indisponibilidade global — logo
    // `tunnel_unavailable`, nunca `provider_unreachable`. Se a REST estivesse GLOBALMENTE fora, o
    // próximo `createPod`/`findPodByName` desta sessão devolveria `provider_unreachable` e a sessão
    // daria HALT ali — a evidência global aparece nos sites de chamada REST, não numa falha de túnel.
    if (endpoint === null) return { ok: false, reason: 'tunnel_unavailable' };
    // COLD-START: o bootstrap dentro do Pod faz `ollama pull` do modelo (minutos p/ ~19 GB). O
    // provision só retorna PRONTO quando o modelo já é servível pelo endpoint — assim o health
    // subsequente (inspect) passa em vez de derrubar um Pod que ainda estava puxando o modelo.
    if (!await this.awaitModelReady(endpoint, request.model, signal)) return { ok: false, reason: 'provision_failed' };
    // Preço só como HINT/observação (Missão 8); a autorização humana é o gate real de gasto.
    this.lastPriceHint = ready.pod.costPerHr !== null ? { currency: 'USD', perHour: ready.pod.costPerHr } : null;
    return {
      ok: true,
      handle: { nodeId: request.nodeId, providerId: this.providerId, endpoint, providerRef: podId },
    };
  }

  async inspect(handle: ProvisionedNodeHandle, signal: AbortSignal): Promise<NodeStatusReport> {
    const pod = await this.getPod(handle.providerRef, signal);
    if (pod.kind === 'not_found') return { nodeId: handle.nodeId, reachable: false, healthy: false, detail: 'pod not found' };
    if (pod.kind === 'error') return { nodeId: handle.nodeId, reachable: false, healthy: false, detail: pod.code };
    if (pod.pod.desiredStatus !== 'RUNNING') {
      return { nodeId: handle.nodeId, reachable: false, healthy: false, detail: `provider status ${pod.pod.desiredStatus}` };
    }
    // Provider diz RUNNING; a Goma confirma por fora, no endpoint real de inferência.
    const health = await this.externalHealth(handle.endpoint, signal);
    return {
      nodeId: handle.nodeId,
      reachable: true,
      healthy: health.ok,
      ...(health.detail ? { detail: health.detail } : {}),
    };
  }

  async stop(handle: ProvisionedNodeHandle, signal: AbortSignal): Promise<StopOutcome> {
    await this.closeTunnel(handle.providerRef);
    const response = await this.call('POST', `/pods/${encodeURIComponent(handle.providerRef)}/stop`, signal);
    if (response.kind === 'network') return { ok: false, reason: 'provider_unreachable' };
    if (response.status === 404) return { ok: true }; // idempotente: já não existe → nada cobrando
    if (response.status >= 200 && response.status < 300) return { ok: true };
    return { ok: false, reason: 'stop_failed' };
  }

  async destroy(handle: ProvisionedNodeHandle, signal: AbortSignal): Promise<StopOutcome> {
    await this.closeTunnel(handle.providerRef);
    const response = await this.call('DELETE', `/pods/${encodeURIComponent(handle.providerRef)}`, signal);
    if (response.kind === 'network') return { ok: false, reason: 'provider_unreachable' };
    if (response.status === 404) return { ok: true }; // idempotente: já destruído
    if (response.status >= 200 && response.status < 300) return { ok: true };
    return { ok: false, reason: 'stop_failed' };
  }

  // ---- internos -------------------------------------------------------------

  private async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<{ kind: 'ok'; status: number; body: string } | { kind: 'network' }> {
    try {
      const response = await this.http.send({
        method,
        url: `${this.config.apiBase}${path}`,
        headers: this.authHeaders(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal,
      });
      return { kind: 'ok', status: response.status, body: response.body };
    } catch {
      return { kind: 'network' };
    }
  }

  private async findPodByName(
    name: string,
    signal: AbortSignal,
  ): Promise<{ ok: true; pod: PodView | null } | { ok: false; reason: RunPodErrorCode }> {
    const response = await this.call('GET', '/pods', signal);
    if (response.kind === 'network') return { ok: false, reason: 'provider_unreachable' };
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, reason: classifyRunPodError(response.status, this.redact(response.body)) };
    }
    const list = parsePodList(parseJson(response.body));
    const match = list.find(pod => !TERMINAL.has(pod.desiredStatus) && pod.name === name);
    return { ok: true, pod: match ?? null };
  }

  private async createPod(
    name: string,
    request: NodeProvisionRequest,
    signal: AbortSignal,
  ): Promise<{ ok: true; pod: PodView } | { ok: false; reason: RunPodErrorCode }> {
    const payload = {
      name,
      imageName: this.config.imageName,
      computeType: 'GPU',
      cloudType: this.config.cloudType,
      gpuTypeIds: request.gpuTypeId ? [request.gpuTypeId] : this.config.gpuTypeIds,
      gpuCount: this.config.gpuCount,
      containerDiskInGb: this.config.containerDiskInGb,
      ...(this.config.volumeInGb > 0 ? { volumeInGb: this.config.volumeInGb } : {}),
      ...(this.config.networkVolumeId ? { networkVolumeId: this.config.networkVolumeId } : {}),
      // Requisito do túnel SSH: expõe TCP/22 e pede IP público explicitamente (ver SSH_TUNNEL_TCP_PORT).
      ports: [SSH_TUNNEL_TCP_PORT],
      supportPublicIp: true,
      dockerEntrypoint: ['bash', '-lc'],
      dockerStartCmd: [renderRunPodBootstrapScript(request.model)],
      env: { ...this.config.podEnv, PUBLIC_KEY: this.config.sshPublicKey },
    };
    const response = await this.call('POST', '/pods', signal, payload);
    if (response.kind === 'network') return { ok: false, reason: 'provider_unreachable' };
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, reason: classifyRunPodError(response.status, this.redact(response.body)) };
    }
    const pod = parsePod(parseJson(response.body));
    if (!pod) return { ok: false, reason: 'provision_failed' };
    return { ok: true, pod };
  }

  private async getPod(
    podId: string,
    signal: AbortSignal,
  ): Promise<{ kind: 'ok'; pod: PodView } | { kind: 'not_found' } | { kind: 'error'; code: RunPodErrorCode }> {
    const response = await this.call('GET', `/pods/${encodeURIComponent(podId)}`, signal);
    if (response.kind === 'network') return { kind: 'error', code: 'provider_unreachable' };
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status < 200 || response.status >= 300) {
      return { kind: 'error', code: classifyRunPodError(response.status, this.redact(response.body)) };
    }
    const pod = parsePod(parseJson(response.body));
    if (!pod) return { kind: 'error', code: 'provider_unreachable' };
    return { kind: 'ok', pod };
  }

  // READINESS EM CAMADAS (Fases 2+3). O endpoint só é considerado utilizável depois de atravessar,
  // nesta ordem, com deadline e retry bounded/cancelável: (1) mapping corrente presente →
  // (2) TCP roteável → (3) `ssh` aceita/túnel de pé. Cada iteração RECONSULTA o provider
  // (`getPod`) porque o RunPod pode publicar o mapping ANTES de o roteamento estar pronto ou ALTERAR
  // publicIp/publicPort durante o provisioning — martelar um endpoint stale foi o que a última prova
  // viva expôs (TCP timeout em endpoint fixo). Ao esgotar o teto, emite UM diagnóstico estruturado
  // e sanitizado com a fase exata (`mapping_absent` | `tcp_unreachable` | `ssh_not_ready`), o mapping
  // observado, quantas vezes ele mudou e o tempo — tornando a barreira ATRIBUÍVEL por si.
  private async openTunnel(initialPod: PodView, signal: AbortSignal): Promise<string | null> {
    const existing = this.openTunnels.get(initialPod.id);
    if (existing) return existing.endpoint;
    const startedAt = this.now();
    const deadline = startedAt + this.tunnelReadyTimeoutMs;
    let observedIp: string | null = initialPod.publicIp;
    let observedPort: number | null = typeof initialPod.portMappings['22'] === 'number' ? initialPod.portMappings['22'] : null;
    let mappingChanges = 0;
    let attempts = 0;
    let phase: 'mapping_absent' | 'tcp_unreachable' | 'ssh_not_ready' = 'mapping_absent';
    let lastDetail = 'no observation yet';
    for (;;) {
      if (signal.aborted) return null;
      attempts += 1;
      const current = await this.getPod(initialPod.id, signal);
      if (current.kind === 'not_found' || (current.kind === 'ok' && TERMINAL.has(current.pod.desiredStatus))) {
        // O recurso faturável sumiu/terminou — não adianta continuar; o caller faz teardown por ref.
        console.error(`runpod_tunnel_open_failed ${JSON.stringify({ podId: initialPod.id, phase: 'resource_gone', attempts, elapsedMs: this.now() - startedAt })}`);
        return null;
      }
      if (current.kind === 'error') {
        phase = 'mapping_absent';
        lastDetail = `getpod:${current.code}`;
      } else {
        const ip = current.pod.publicIp;
        const port = current.pod.portMappings['22'];
        if (!ip || typeof port !== 'number') {
          phase = 'mapping_absent';
          lastDetail = 'no publicIp/port22';
        } else {
          if (ip !== observedIp || port !== observedPort) {
            mappingChanges += 1;
            console.error(`runpod_tunnel_mapping_changed ${JSON.stringify({ podId: initialPod.id, from: observedIp && observedPort ? `${observedIp}:${observedPort}` : null, to: `${ip}:${port}` })}`);
          }
          observedIp = ip;
          observedPort = port;
          const reachability = await this.tcpProbe.probe(ip, port, this.tcpProbeTimeoutMs, signal);
          if (reachability === 'reachable') {
            try {
              const tunnel = await this.tunnels.open({ publicIp: ip, port, hostKeyAlias: `runpod-${initialPod.id}` }, signal);
              this.openTunnels.set(initialPod.id, tunnel);
              return tunnel.endpoint;
            } catch (error) {
              // TCP roteável mas o `ssh`/túnel ainda não sobe (sshd aquecendo, banner, auth); retry.
              phase = 'ssh_not_ready';
              lastDetail = error instanceof Error ? error.message : String(error);
            }
          } else {
            // Endpoint publicado mas ainda NÃO roteável — a classe de falha da última prova viva.
            phase = 'tcp_unreachable';
            lastDetail = reachability;
          }
        }
      }
      if (this.now() >= deadline) {
        console.error(`runpod_tunnel_open_failed ${JSON.stringify({
          podId: initialPod.id, phase, lastDetail: this.redact(lastDetail),
          observed: observedIp && observedPort ? `${observedIp}:${observedPort}` : null,
          mappingChanges, attempts, elapsedMs: this.now() - startedAt,
        })}`);
        return null;
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  /** Espera o modelo ficar servível no endpoint (`/api/tags` contém o modelo). O bootstrap faz o
   * `ollama pull` DENTRO do Pod; sem esta espera, o health imediato reprovaria por "model missing".
   * BOUNDED pelo `modelReadyTimeoutMs`, cancelável; falha ⇒ o caller faz teardown do recurso. */
  private async awaitModelReady(endpoint: string, model: string, signal: AbortSignal): Promise<boolean> {
    const base = endpoint.replace(/\/+$/, '');
    const expected = this.config.podEnv.ANIMA_OLLAMA_MODEL ?? model;
    const deadline = this.now() + this.modelReadyTimeoutMs;
    for (;;) {
      if (signal.aborted) return false;
      try {
        const tags = await this.http.send({ method: 'GET', url: `${base}/api/tags`, signal });
        if (tags.status >= 200 && tags.status < 300) {
          const parsed = asObject(parseJson(tags.body));
          const models = Array.isArray(parsed?.models) ? parsed.models : [];
          if (models.some(value => { const m = asObject(value); return m?.name === expected || m?.model === expected; })) return true;
        }
      } catch { /* ollama ainda subindo / túnel aquecendo; retry bounded */ }
      if (this.now() >= deadline) return false;
      await this.sleep(this.pollIntervalMs);
    }
  }

  private async closeTunnel(providerRef: string): Promise<void> {
    const tunnel = this.openTunnels.get(providerRef);
    if (!tunnel) return;
    this.openTunnels.delete(providerRef);
    await tunnel.close();
  }

  async disposeAll(): Promise<void> {
    this.openTunnels.clear();
    await this.tunnels.closeAll();
  }

  private async awaitEndpoint(
    podId: string,
    signal: AbortSignal,
  ): Promise<{ ok: true; endpoint: string; pod: PodView } | { ok: false; reason: RunPodErrorCode }> {
    const startedAt = this.now();
    const deadline = startedAt + this.endpointPublicationDeadlineMs;
    let sawRunning = false;
    for (;;) {
      if (signal.aborted) return { ok: false, reason: 'provision_failed' };
      const pod = await this.getPod(podId, signal);
      if (pod.kind === 'not_found') return { ok: false, reason: 'provision_failed' };
      if (pod.kind === 'error') return { ok: false, reason: pod.code };
      if (TERMINAL.has(pod.pod.desiredStatus)) return { ok: false, reason: 'provision_failed' };
      if (pod.pod.desiredStatus === 'RUNNING') {
        sawRunning = true;
        if (pod.pod.publicIp && typeof pod.pod.portMappings['22'] === 'number') return { ok: true, endpoint: '', pod: pod.pod };
      }
      if (this.now() >= deadline) {
        // ATRIBUIÇÃO na camada PRÉ-túnel (Fase 2): "nunca ficou RUNNING" (capacidade real
        // indisponível) é honestamente diferente de "ficou RUNNING mas o endpoint SSH nunca publicou
        // dentro da janela". A prova viva 2026-09-10 (pod `yi133l1j51prjr`) foi o SEGUNDO caso —
        // RUNNING com `publicIp`/`portMappings` vazios além do `endpointPublicationDeadlineMs` — e
        // antes disso colapsava, enganosamente, em `capacity_unavailable`. Aqui a capacidade EXISTIU;
        // a janela de publicação do endpoint é que foi curta. `endpoint_unpublished` é RECUPERÁVEL
        // pela sessão resiliente (trocar de máquina), não terminal; ampliar o deadline
        // (`ANIMA_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS`) só dá mais paciência à MESMA máquina. O
        // diagnóstico estruturado torna a fase atribuível por si e a mensagem de refusal deixa de
        // culpar falsamente a capacidade.
        if (sawRunning) {
          console.error(`runpod_endpoint_unpublished ${JSON.stringify({ podId, endpointPublicationDeadlineMs: this.endpointPublicationDeadlineMs, elapsedMs: this.now() - startedAt })}`);
          return { ok: false, reason: 'endpoint_unpublished' };
        }
        return { ok: false, reason: 'capacity_unavailable' };
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  private async externalHealth(endpoint: string, signal: AbortSignal): Promise<{ ok: boolean; detail?: string }> {
    // Timeout próprio de health, cooperativo com o signal externo.
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.healthTimeoutMs);
    try {
      const tags = await this.http.send({
        method: 'GET',
        url: `${endpoint.replace(/\/+$/, '')}/api/tags`,
        signal: controller.signal,
      });
      if (tags.status < 200 || tags.status >= 300) return { ok: false, detail: `tags ${tags.status}` };
      const parsed = asObject(parseJson(tags.body));
      const models = Array.isArray(parsed?.models) ? parsed.models : [];
      const expected = this.config.podEnv.ANIMA_OLLAMA_MODEL ?? 'qwen3-coder:latest';
      const present = models.some(value => {
        const model = asObject(value);
        return model?.name === expected || model?.model === expected;
      });
      if (!present) return { ok: false, detail: 'model missing' };
      const chat = await this.http.send({
        method: 'POST', url: `${endpoint.replace(/\/+$/, '')}/api/chat`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: expected, messages: [{ role: 'user', content: 'Reply only OK.' }], stream: false, options: { num_predict: 8 } }),
        signal: controller.signal,
      });
      return chat.status >= 200 && chat.status < 300 ? { ok: true } : { ok: false, detail: `chat ${chat.status}` };
    } catch {
      return { ok: false, detail: 'health unreachable' };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
