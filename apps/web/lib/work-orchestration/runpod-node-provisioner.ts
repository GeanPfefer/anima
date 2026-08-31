import type {
  LocateOutcome,
  NodePriceHintV0,
  NodeProvisioner,
  NodeProvisionRequest,
  NodeStatusReport,
  ProvisionedNodeHandle,
  ProvisionOutcome,
  StopOutcome,
} from '@anima/core';

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

/** Cliente HTTP padrão sobre o `fetch` global (Node 24+). Erros de rede viram exceção,
 * que o adapter traduz para `provider_unreachable` — nunca vaza stack/segredo. */
export const fetchHttpClient: HttpClient = {
  async send({ method, url, headers, body, signal }) {
    const response = await fetch(url, { method, headers: headers as HeadersInit, body, signal });
    return { status: response.status, body: await response.text() };
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
  /** Env estático passado ao pod. NUNCA contém a API key do control-plane. */
  readonly podEnv: Readonly<Record<string, string>>;
}

export interface RunPodProvisionerOptions {
  readonly pollIntervalMs?: number;
  readonly maxProvisionMs?: number;
  readonly healthTimeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
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
  if (!apiKey || !imageName || gpuTypeIds.length === 0) return null;
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

export class RunPodNodeProvisioner implements NodeProvisioner {
  readonly providerId = 'runpod';
  private readonly pollIntervalMs: number;
  private readonly maxProvisionMs: number;
  private readonly healthTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly config: RunPodProvisionerConfig,
    private readonly http: HttpClient = fetchHttpClient,
    options: RunPodProvisionerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.maxProvisionMs = options.maxProvisionMs ?? 180_000;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 5_000;
    this.sleep = options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
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
    return { ok: true, found: true, handle: { nodeId, providerId: this.providerId, endpoint: this.endpointOf(found.pod), providerRef: found.pod.id } };
  }

  async provision(request: NodeProvisionRequest, signal: AbortSignal): Promise<ProvisionOutcome> {
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

    const ready = await this.awaitEndpoint(podId, signal);
    if (!ready.ok) return { ok: false, reason: ready.reason };
    // Preço só como HINT/observação (Missão 8); a autorização humana é o gate real de gasto.
    this.lastPriceHint = ready.pod.costPerHr !== null ? { currency: 'USD', perHour: ready.pod.costPerHr } : null;
    return {
      ok: true,
      handle: { nodeId: request.nodeId, providerId: this.providerId, endpoint: ready.endpoint, providerRef: podId },
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
    const response = await this.call('POST', `/pods/${encodeURIComponent(handle.providerRef)}/stop`, signal);
    if (response.kind === 'network') return { ok: false, reason: 'provider_unreachable' };
    if (response.status === 404) return { ok: true }; // idempotente: já não existe → nada cobrando
    if (response.status >= 200 && response.status < 300) return { ok: true };
    return { ok: false, reason: 'stop_failed' };
  }

  async destroy(handle: ProvisionedNodeHandle, signal: AbortSignal): Promise<StopOutcome> {
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
      gpuTypeIds: this.config.gpuTypeIds,
      gpuCount: this.config.gpuCount,
      containerDiskInGb: this.config.containerDiskInGb,
      ...(this.config.volumeInGb > 0 ? { volumeInGb: this.config.volumeInGb } : {}),
      ...(this.config.networkVolumeId ? { networkVolumeId: this.config.networkVolumeId } : {}),
      ports: [`${this.config.inferencePort}/http`],
      env: this.config.podEnv,
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

  private endpointOf(pod: PodView): string {
    const mapped = pod.portMappings[String(this.config.inferencePort)];
    if (pod.publicIp && typeof mapped === 'number') return `http://${pod.publicIp}:${mapped}`;
    // Sem exposição TCP: convenção de proxy HTTP do RunPod para portas http.
    return `https://${pod.id}-${this.config.inferencePort}.proxy.runpod.net`;
  }

  private async awaitEndpoint(
    podId: string,
    signal: AbortSignal,
  ): Promise<{ ok: true; endpoint: string; pod: PodView } | { ok: false; reason: RunPodErrorCode }> {
    const deadline = this.now() + this.maxProvisionMs;
    for (;;) {
      if (signal.aborted) return { ok: false, reason: 'provision_failed' };
      const pod = await this.getPod(podId, signal);
      if (pod.kind === 'not_found') return { ok: false, reason: 'provision_failed' };
      if (pod.kind === 'error') return { ok: false, reason: pod.code };
      if (TERMINAL.has(pod.pod.desiredStatus)) return { ok: false, reason: 'provision_failed' };
      if (pod.pod.desiredStatus === 'RUNNING') {
        const endpoint = this.endpointOf(pod.pod);
        if (endpoint) return { ok: true, endpoint, pod: pod.pod };
      }
      if (this.now() >= deadline) return { ok: false, reason: 'capacity_unavailable' };
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
      const response = await this.http.send({
        method: 'GET',
        url: `${endpoint.replace(/\/+$/, '')}${this.config.healthPath}`,
        signal: controller.signal,
      });
      return response.status >= 200 && response.status < 300 ? { ok: true } : { ok: false, detail: `health ${response.status}` };
    } catch {
      return { ok: false, detail: 'health unreachable' };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
