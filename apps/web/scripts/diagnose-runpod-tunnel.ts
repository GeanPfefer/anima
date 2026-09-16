// OPERACIONAL (não commitar): cria um único Pod mínimo, prova o SshRunPodTunnelManager real
// sem baixar modelo e destrói o recurso no finally. Nunca imprime credenciais ou material SSH.
import { createConnection } from 'node:net';
import { readRunPodProvisionerConfig, fetchHttpClient } from '@/lib/work-orchestration/runpod-node-provisioner';
import { RunPodTunnelError, SshRunPodTunnelManager, type RunPodTunnel } from '@/lib/work-orchestration/runpod-ssh-tunnel';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const connectTcp = (port: number): Promise<boolean> => new Promise(resolve => {
  const socket = createConnection({ host: '127.0.0.1', port });
  const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
  socket.once('connect', () => done(true)); socket.once('error', () => done(false));
  socket.setTimeout(1_000, () => done(false));
});

async function main(): Promise<void> {
  const cfg = readRunPodProvisionerConfig();
  if (!cfg) throw new Error('config null');
  const auth = { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' };
  const signal = new AbortController().signal;
  const boot = [
    'set -euo pipefail', 'apt-get update -qq',
    'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssh-server',
    'install -d -m 700 /root/.ssh /run/sshd', 'test -n "${PUBLIC_KEY:-}"',
    'printf "%s\\n" "$PUBLIC_KEY" > /root/.ssh/authorized_keys', 'chmod 600 /root/.ssh/authorized_keys',
    '/usr/sbin/sshd -D',
  ].join('; ');
  const payload = {
    name: 'anima-tunnel-diag', imageName: cfg.imageName, computeType: 'GPU', cloudType: cfg.cloudType,
    gpuTypeIds: cfg.gpuTypeIds, gpuCount: 1, containerDiskInGb: 20, ports: ['22/tcp'],
    dockerEntrypoint: ['bash', '-lc'], dockerStartCmd: [boot], env: { PUBLIC_KEY: cfg.sshPublicKey },
  };
  const tunnels = new SshRunPodTunnelManager({
    privateKeyPath: cfg.sshPrivateKeyPath, knownHostsPath: cfg.sshKnownHostsPath,
    connectTimeoutMs: 15_000, readinessTimeoutMs: 20_000,
  });
  let podId: string | null = null;
  let tunnel: RunPodTunnel | null = null;
  try {
    const create = await fetchHttpClient.send({ method: 'POST', url: `${cfg.apiBase}/pods`, headers: auth, body: JSON.stringify(payload), signal });
    const created = JSON.parse(create.body) as { id?: string };
    podId = created.id ?? null;
    console.log(JSON.stringify({ phase: 'created', status: create.status, podId }));
    if (!podId) throw new Error(`provider_create_without_id:${create.status}`);

    let ip = ''; let port = 0;
    for (let index = 0; index < 60; index += 1) {
      const response = await fetchHttpClient.send({ method: 'GET', url: `${cfg.apiBase}/pods/${podId}`, headers: auth, signal });
      const pod = JSON.parse(response.body) as { desiredStatus?: string; publicIp?: string; portMappings?: Record<string, number> };
      if (pod.desiredStatus === 'RUNNING' && pod.publicIp && pod.portMappings?.['22']) {
        ip = pod.publicIp; port = pod.portMappings['22']; break;
      }
      if (index % 5 === 0) console.log(JSON.stringify({ phase: 'endpoint_wait', poll: index, status: pod.desiredStatus ?? null, hasIp: Boolean(pod.publicIp), hasPort22: Boolean(pod.portMappings?.['22']) }));
      await sleep(6_000);
    }
    if (!ip || !port) throw new Error('diagnostic_endpoint_timeout');

    let lastFailure: unknown = null;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      try {
        tunnel = await tunnels.open({ publicIp: ip, port, hostKeyAlias: `runpod-${podId}` }, signal);
        console.log(JSON.stringify({ phase: 'tunnel_opened', attempt }));
        break;
      } catch (error) {
        lastFailure = error;
        const safe = error instanceof RunPodTunnelError ? { code: error.code, diagnostics: error.diagnostics } : { error: error instanceof Error ? error.message : String(error) };
        console.log(JSON.stringify({ phase: 'tunnel_retry', attempt, ...safe }));
        if (attempt < 12) await sleep(15_000);
      }
    }
    if (!tunnel) throw lastFailure ?? new Error('tunnel_not_opened');
    const status = await tunnel.inspect?.();
    const localPort = Number(new URL(tunnel.endpoint).port);
    const tcpReady = await connectTcp(localPort);
    let httpOutcome: { status: number } | { error: string };
    try {
      const response = await fetch(`${tunnel.endpoint}/api/tags`, { signal: AbortSignal.timeout(3_000) });
      httpOutcome = { status: response.status };
    } catch (error) {
      httpOutcome = { error: error instanceof Error ? error.name : 'unknown' };
    }
    const afterProbe = await tunnel.inspect?.();
    console.log(JSON.stringify({ phase: 'proof', status, tcpReady, httpOutcome, afterProbe }));
    if (!status?.processAlive || !status.listenerReady || !tcpReady || !afterProbe?.processAlive || !afterProbe.listenerReady) {
      throw new Error('TUNNEL_REAL_MANAGER=FAIL');
    }
    console.log('TUNNEL_REAL_MANAGER = PASS');
  } finally {
    await tunnel?.close();
    await tunnels.closeAll();
    if (podId) {
      let destroyed = false;
      for (let attempt = 1; attempt <= 3 && !destroyed; attempt += 1) {
        const response = await fetchHttpClient.send({ method: 'DELETE', url: `${cfg.apiBase}/pods/${podId}`, headers: auth, signal });
        destroyed = response.status === 404 || (response.status >= 200 && response.status < 300);
        console.log(JSON.stringify({ phase: 'destroy', podId, attempt, status: response.status, destroyed }));
        if (!destroyed) await sleep(2_000);
      }
      if (!destroyed) throw new Error(`diagnostic_destroy_failed:${podId}`);
    }
    const list = await fetchHttpClient.send({ method: 'GET', url: `${cfg.apiBase}/pods`, headers: auth, signal });
    const parsed = JSON.parse(list.body) as unknown;
    const pods = Array.isArray(parsed) ? parsed : [];
    console.log(JSON.stringify({ phase: 'provider_absence', status: list.status, activePods: pods.length }));
    if (pods.length !== 0) throw new Error('provider_resources_remain');
  }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
