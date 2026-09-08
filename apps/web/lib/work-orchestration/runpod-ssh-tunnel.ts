import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, createServer } from 'node:net';

export interface RunPodSshTarget {
  readonly publicIp: string;
  readonly port: number;
}

export interface RunPodTunnel {
  readonly endpoint: string;
  close(): Promise<void>;
}

export interface RunPodTunnelManager {
  open(target: RunPodSshTarget, signal: AbortSignal): Promise<RunPodTunnel>;
  closeAll(): Promise<void>;
}

export interface SshTunnelOptions {
  readonly privateKeyPath: string;
  readonly knownHostsPath: string;
  readonly connectTimeoutMs?: number;
  readonly sshCommand?: string;
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

export class SshRunPodTunnelManager implements RunPodTunnelManager {
  private readonly children = new Set<ChildProcess>();

  constructor(private readonly options: SshTunnelOptions) {}

  async open(target: RunPodSshTarget, signal: AbortSignal): Promise<RunPodTunnel> {
    if (signal.aborted) throw new Error('tunnel_aborted');
    const localPort = await freeLoopbackPort();
    const child = spawn(this.options.sshCommand ?? 'ssh', [
      '-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
      // Identidade DEDICADA: só a chave privada informada é ofertada (nunca as do ssh-agent),
      // evitando "too many authentication failures" e mantendo o transporte previsível.
      '-o', 'IdentitiesOnly=yes',
      '-o', `ConnectTimeout=${Math.max(1, Math.ceil((this.options.connectTimeoutMs ?? 15_000) / 1_000))}`,
      '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${this.options.knownHostsPath}`,
      '-i', this.options.privateKeyPath, '-p', String(target.port),
      '-L', `127.0.0.1:${localPort}:127.0.0.1:11434`, `root@${target.publicIp}`,
    ], { stdio: 'ignore', windowsHide: true });
    this.children.add(child);
    let spawnFailed = false;
    child.once('error', () => { spawnFailed = true; });

    const close = async (): Promise<void> => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      this.children.delete(child);
    };
    const onAbort = () => { void close(); };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const deadline = Date.now() + (this.options.connectTimeoutMs ?? 15_000);
      for (;;) {
        if (spawnFailed || child.exitCode !== null || child.signalCode !== null) throw new Error('tunnel_exited');
        const ready = await new Promise<boolean>(resolve => {
          const socket = createConnection({ host: '127.0.0.1', port: localPort });
          socket.once('connect', () => { socket.destroy(); resolve(true); });
          socket.once('error', () => resolve(false));
          socket.setTimeout(250, () => { socket.destroy(); resolve(false); });
        });
        if (ready) break;
        if (Date.now() >= deadline || signal.aborted) throw new Error('tunnel_timeout');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch {
      signal.removeEventListener('abort', onAbort);
      await close();
      throw new Error('tunnel_failed');
    }
    return {
      endpoint: `http://127.0.0.1:${localPort}`,
      close: async () => {
        signal.removeEventListener('abort', onAbort);
        await close();
      },
    };
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.children].map(async child => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      this.children.delete(child);
    }));
  }
}
