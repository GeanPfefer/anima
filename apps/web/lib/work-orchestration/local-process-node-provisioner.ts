import { spawn, type ChildProcess } from 'node:child_process';
import { get as httpGet } from 'node:http';
import type {
  LocateOutcome,
  NodeProvisioner,
  NodeProvisionRequest,
  NodeStatusReport,
  ProvisionedNodeHandle,
  ProvisionOutcome,
  StopOutcome,
} from '@anima/core';

// ============================================================
// PROVISIONER CONTROLADO/LOCAL/FAKE-REALISTA (Provisionamento On-Demand V1).
//
// Implementa a porta `NodeProvisioner` iniciando um PROCESSO REAL local (não um mock puro):
// um endpoint de inferência sobe como processo filho do Node, é health-checkado por HTTP de
// verdade sobre o loopback e desligado por sinal com espera do `exit`. É a MESMA interface
// que um provider real (VM/GPU cloud, Wake-on-LAN, PC da rede) usará depois — só o `launch`
// muda. Aqui NÃO há API de cloud, NÃO há custo: prova o boundary de provisionamento sem gasto.
//
// A Goma é a fonte da saúde do node (inspect por fora), nunca o auto-relato do node.
// ============================================================

/** Como iniciar o processo local que serve inferência. Em produção apontaria para o binário
 * real (ex.: `ollama serve`) no recurso provisionado; na prova, para o endpoint fake-realista.
 * O processo DEVE imprimir `READY PORT=<n>` em stdout ao ficar ouvindo. */
export interface LocalProcessLaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  /** Variáveis de ambiente adicionais para o processo (ex.: alvo/conteúdo da operação). */
  readonly env?: Readonly<Record<string, string>>;
  /** Caminho de health-check HTTP (default `/`). Status 200 = saudável. */
  readonly healthPath?: string;
}

export interface LocalProcessProvisionerOptions {
  readonly host?: string;
  readonly startTimeoutMs?: number;
  /** Injeta uma falha de stop (prova de recovery `shutdown_failed`). */
  readonly failStop?: boolean;
}

const READY_RE = /READY PORT=(\d+)/;

export class LocalProcessNodeProvisioner implements NodeProvisioner {
  readonly providerId = 'local-process';
  private readonly host: string;
  private readonly startTimeoutMs: number;
  private readonly children = new Map<string, ChildProcess>();
  private seq = 0;

  constructor(
    private readonly launch: LocalProcessLaunchSpec,
    private readonly options: LocalProcessProvisionerOptions = {},
  ) {
    this.host = options.host ?? '127.0.0.1';
    this.startTimeoutMs = options.startTimeoutMs ?? 10_000;
  }

  async provision(request: NodeProvisionRequest, signal: AbortSignal): Promise<ProvisionOutcome> {
    if (signal.aborted) return { ok: false, reason: 'aborted' };
    const child = spawn(this.launch.command, [...this.launch.args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...this.launch.env },
    });

    const port = await this.awaitReadyPort(child, signal).catch((error: unknown) => {
      child.kill();
      return error instanceof Error ? error : new Error(String(error));
    });
    if (port instanceof Error) return { ok: false, reason: port.message };

    const providerRef = `local-process:${request.nodeId}:${child.pid ?? ++this.seq}`;
    this.children.set(providerRef, child);
    return {
      ok: true,
      handle: {
        nodeId: request.nodeId,
        providerId: this.providerId,
        endpoint: `http://${this.host}:${port}`,
        providerRef,
      },
    };
  }

  async inspect(handle: ProvisionedNodeHandle, signal: AbortSignal): Promise<NodeStatusReport> {
    const child = this.children.get(handle.providerRef);
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return { nodeId: handle.nodeId, reachable: false, healthy: false, detail: 'process not running' };
    }
    const url = `${handle.endpoint}${this.launch.healthPath ?? '/'}`;
    const status = await this.healthCheck(url, signal);
    return {
      nodeId: handle.nodeId,
      reachable: status.reachable,
      healthy: status.reachable && status.code === 200,
      ...(status.detail ? { detail: status.detail } : {}),
    };
  }

  async stop(handle: ProvisionedNodeHandle, _signal: AbortSignal): Promise<StopOutcome> {
    if (this.options.failStop) return { ok: false, reason: 'stop injetado para falhar' };
    const child = this.children.get(handle.providerRef);
    if (!child) return { ok: true }; // idempotente: já não existe processo para este handle
    if (child.exitCode !== null || child.signalCode !== null) {
      this.children.delete(handle.providerRef);
      return { ok: true };
    }
    await this.killAndAwaitExit(child);
    this.children.delete(handle.providerRef);
    return { ok: true };
  }

  /** Reconciliação: um processo local NÃO sobrevive ao host — não há recurso externo durável a
   * reconciliar após restart. Sempre `found:false` (o teardown do processo vivo é do fluxo, não
   * do reconciler). */
  async locate(_nodeId: string, _signal: AbortSignal): Promise<LocateOutcome> {
    return { ok: true, found: false };
  }

  /** Cleanup de segurança para testes: mata e aguarda o exit de qualquer processo remanescente,
   * sem deixar timers/handles pendurados (jest sai limpo). */
  async disposeAll(): Promise<void> {
    await Promise.all([...this.children.values()].map(child => this.killAndAwaitExit(child)));
    this.children.clear();
  }

  private killAndAwaitExit(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = () => { if (timer) clearTimeout(timer); resolve(); };
      child.once('exit', done);
      timer = setTimeout(() => { child.off('exit', done); resolve(); }, 3_000);
      child.kill();
    });
  }

  private awaitReadyPort(child: ChildProcess, signal: AbortSignal): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let buffer = '';
      let settled = false;
      const finish = (fn: () => void) => { if (!settled) { settled = true; cleanup(); fn(); } };
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const match = READY_RE.exec(buffer);
        if (match) finish(() => resolve(Number(match[1])));
      };
      const onExit = (code: number | null) => finish(() => reject(new Error(`processo encerrou antes de subir (code ${code})`)));
      const onError = (error: Error) => finish(() => reject(error));
      const onAbort = () => finish(() => reject(new Error('aborted')));
      const timer = setTimeout(() => finish(() => reject(new Error('timeout ao subir o processo'))), this.startTimeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.off('exit', onExit);
        child.off('error', onError);
        signal.removeEventListener('abort', onAbort);
      };
      child.stdout?.on('data', onData);
      child.once('exit', onExit);
      child.once('error', onError);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private healthCheck(url: string, signal: AbortSignal): Promise<{ reachable: boolean; code?: number; detail?: string }> {
    return new Promise(resolve => {
      const request = httpGet(url, response => {
        response.resume();
        resolve({ reachable: true, code: response.statusCode });
      });
      request.setTimeout(2_000, () => { request.destroy(); resolve({ reachable: false, detail: 'health timeout' }); });
      request.on('error', error => resolve({ reachable: false, detail: error.message }));
      signal.addEventListener('abort', () => request.destroy(), { once: true });
    });
  }
}
