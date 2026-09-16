import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, createServer } from 'node:net';

export interface RunPodSshTarget { readonly publicIp: string; readonly port: number; readonly hostKeyAlias?: string }
export interface RunPodTunnelStatus {
  readonly pid: number | null;
  readonly processAlive: boolean;
  readonly listenerReady: boolean;
  readonly localPort: number;
}
export interface RunPodTunnel {
  readonly endpoint: string;
  inspect?(): Promise<RunPodTunnelStatus>;
  close(): Promise<void>;
}
export interface RunPodTunnelManager {
  open(target: RunPodSshTarget, signal: AbortSignal): Promise<RunPodTunnel>;
  closeAll(): Promise<void>;
}

interface SpawnOptions { readonly stdio: ['ignore', 'pipe', 'pipe']; readonly windowsHide: boolean }
export interface SshTunnelDependencies {
  readonly allocateLoopbackPort?: () => Promise<number>;
  readonly spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  readonly isLoopbackPortListening?: (port: number) => Promise<boolean>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}
export interface SshTunnelOptions {
  readonly privateKeyPath: string;
  readonly knownHostsPath: string;
  readonly connectTimeoutMs?: number;
  readonly readinessTimeoutMs?: number;
  readonly teardownTimeoutMs?: number;
  readonly diagnosticMaxBytes?: number;
  readonly sshCommand?: string;
  readonly dependencies?: SshTunnelDependencies;
}
export type RunPodTunnelFailureCode = 'tunnel_aborted' | 'tunnel_spawn_failed' | 'tunnel_exited_before_ready' | 'tunnel_listener_timeout';

export class RunPodTunnelError extends Error {
  constructor(readonly code: RunPodTunnelFailureCode, readonly diagnostics: Readonly<Record<string, unknown>>) {
    super(`${code}: ${JSON.stringify(diagnostics)}`);
    this.name = 'RunPodTunnelError';
  }
}

const freeLoopbackPort = (): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'string' || address === null) {
      server.close(() => reject(new Error('tunnel_port_unavailable')));
      return;
    }
    const port = address.port;
    server.close(error => error ? reject(error) : resolve(port));
  });
});

const isLoopbackPortListening = (port: number): Promise<boolean> => new Promise(resolve => {
  const socket = createConnection({ host: '127.0.0.1', port });
  const done = (ready: boolean) => { socket.destroy(); resolve(ready); };
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
  socket.setTimeout(250, () => done(false));
});
const appendBounded = (current: string, chunk: unknown, maxBytes: number): string => {
  const combined = current + String(chunk);
  return combined.length <= maxBytes ? combined : combined.slice(combined.length - maxBytes);
};
const sanitizedArgs = (args: readonly string[]): readonly string[] => {
  const safe = [...args];
  for (let index = 0; index < safe.length; index += 1) {
    if (safe[index] === '-i' && index + 1 < safe.length) safe[index + 1] = '<redacted-private-key-path>';
    if (safe[index]?.startsWith('UserKnownHostsFile=')) safe[index] = 'UserKnownHostsFile=<redacted-known-hosts-path>';
  }
  return safe;
};

export class SshRunPodTunnelManager implements RunPodTunnelManager {
  private readonly children = new Set<ChildProcess>();
  constructor(private readonly options: SshTunnelOptions) {}

  async open(target: RunPodSshTarget, signal: AbortSignal): Promise<RunPodTunnel> {
    if (signal.aborted) throw new RunPodTunnelError('tunnel_aborted', {});
    const dependencies = this.options.dependencies ?? {};
    const allocatePort = dependencies.allocateLoopbackPort ?? freeLoopbackPort;
    const checkListener = dependencies.isLoopbackPortListening ?? isLoopbackPortListening;
    const sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const now = dependencies.now ?? Date.now;
    const spawnProcess = dependencies.spawnProcess ?? ((command, args, options) => spawn(command, args, options));
    const localPort = await allocatePort();
    const hostKeyAlias = target.hostKeyAlias && /^[A-Za-z0-9._-]+$/.test(target.hostKeyAlias)
      ? target.hostKeyAlias : null;
    const args = [
      '-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'IdentitiesOnly=yes',
      '-o', `ConnectTimeout=${Math.max(1, Math.ceil((this.options.connectTimeoutMs ?? 15_000) / 1_000))}`,
      '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${this.options.knownHostsPath}`,
      ...(hostKeyAlias ? ['-o', `HostKeyAlias=${hostKeyAlias}`] : []),
      '-i', this.options.privateKeyPath, '-p', String(target.port),
      '-L', `127.0.0.1:${localPort}:127.0.0.1:11434`, `root@${target.publicIp}`,
    ] as const;
    const startedAt = now();
    const child = spawnProcess(this.options.sshCommand ?? 'ssh', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.children.add(child);
    const maxBytes = this.options.diagnosticMaxBytes ?? 4_096;
    let stdout = '';
    let stderr = '';
    let spawnError: string | null = null;
    child.stdout?.on('data', chunk => { stdout = appendBounded(stdout, chunk, maxBytes); });
    child.stderr?.on('data', chunk => { stderr = appendBounded(stderr, chunk, maxBytes); });
    child.once('error', error => { spawnError = error.message; });

    const close = async (): Promise<void> => {
      await this.terminate(child);
      this.children.delete(child);
    };
    const onAbort = () => { void close(); };
    signal.addEventListener('abort', onAbort, { once: true });
    const diagnostics = (): Readonly<Record<string, unknown>> => ({
      args: sanitizedArgs(args), pid: child.pid ?? null,
      processAlive: child.exitCode === null && child.signalCode === null && spawnError === null,
      listenerReady: false, localPort, exitCode: child.exitCode, signal: child.signalCode,
      elapsedMs: Math.max(0, now() - startedAt), stderr, stdout,
      ...(spawnError ? { spawnError } : {}),
    });

    try {
      const deadline = startedAt + (this.options.readinessTimeoutMs ?? this.options.connectTimeoutMs ?? 15_000);
      for (;;) {
        if (signal.aborted) throw new RunPodTunnelError('tunnel_aborted', diagnostics());
        if (spawnError !== null) throw new RunPodTunnelError('tunnel_spawn_failed', diagnostics());
        if (child.exitCode !== null || child.signalCode !== null) throw new RunPodTunnelError('tunnel_exited_before_ready', diagnostics());
        if (await checkListener(localPort)) break;
        if (now() >= deadline) throw new RunPodTunnelError('tunnel_listener_timeout', diagnostics());
        await sleep(100);
      }
    } catch (error) {
      signal.removeEventListener('abort', onAbort);
      await close();
      throw error;
    }
    return {
      endpoint: `http://127.0.0.1:${localPort}`,
      inspect: async () => ({
        pid: child.pid ?? null,
        processAlive: child.exitCode === null && child.signalCode === null && spawnError === null,
        listenerReady: await checkListener(localPort),
        localPort,
      }),
      close: async () => { signal.removeEventListener('abort', onAbort); await close(); },
    };
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.children].map(async child => {
      await this.terminate(child);
      this.children.delete(child);
    }));
  }

  private async terminate(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve();
      };
      child.once('close', done);
      child.once('exit', done);
      child.kill();
      if (!settled) timer = setTimeout(done, this.options.teardownTimeoutMs ?? 2_000);
    });
  }
}
