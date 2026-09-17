// OPERACIONAL (não commitar): EXPERIMENTO B (TRATAMENTO) do A/B do bootstrap.
// Cria UM Pod pelo PAYLOAD CANÔNICO (renderRunPodBootstrapScript endurecido, supportPublicIp:true,
// disk/env atuais). Mede endpoint/TCP/SSH/estabilidade-do-mapping e, com o SSH de pé, lê o marcador
// /var/run/anima-bootstrap.status por SSH — SEM esperar o pull pesado do modelo (custo bounded).
// Teardown GARANTIDO no finally. NUNCA imprime credenciais/chave.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRunPodProvisionerConfig, fetchHttpClient } from '@/lib/work-orchestration/runpod-node-provisioner';
import { renderRunPodBootstrapScript, RUNPOD_BOOTSTRAP_STATUS_PATH } from '@/lib/work-orchestration/runpod-bootstrap';
import { SshRunPodTunnelManager, RunPodTunnelError, type RunPodTunnel } from '@/lib/work-orchestration/runpod-ssh-tunnel';

const MODEL = process.env.ANIMA_AB_MODEL?.trim() || 'qwen3-coder:latest';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const START = Date.now();
const t = () => Date.now() - START;
const log = (o: unknown) => console.log(JSON.stringify({ t: t(), ...(o as object) }));

// Leitura read-only do marcador por SSH direto (accept-new em known_hosts efêmero; é o nosso Pod).
function readMarker(ip: string, port: number, keyPath: string): Promise<string> {
  const kh = join(mkdtempSync(join(tmpdir(), 'ab-kh-')), 'known');
  const args = [
    '-i', keyPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${kh}`,
    '-o', 'ConnectTimeout=15', '-p', String(port), `root@${ip}`,
    `cat ${RUNPOD_BOOTSTRAP_STATUS_PATH} 2>/dev/null; echo "---WORKER_LOG---"; tail -n 25 /tmp/anima-bootstrap-worker.log 2>/dev/null`,
  ];
  return new Promise(resolve => {
    const p = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', d => { out += String(d); });
    p.stderr.on('data', d => { err += String(d); });
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve(`__ssh_timeout__ ${err.slice(0, 120)}`); }, 20_000);
    p.on('close', code => { clearTimeout(timer); resolve(out.trim() || `__ssh_exit_${code}__ ${err.slice(0, 160)}`); });
    p.on('error', e => { clearTimeout(timer); resolve(`__ssh_spawn_error__ ${e instanceof Error ? e.message : String(e)}`); });
  });
}

async function main(): Promise<void> {
  const cfg = readRunPodProvisionerConfig();
  if (!cfg) throw new Error('config null');
  const auth = { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' };
  const signal = new AbortController().signal;

  // PAYLOAD CANÔNICO (idêntico ao RunPodNodeProvisioner.createPod) — só o nome muda p/ diagnóstico.
  const payload = {
    name: 'anima-ab-treatment', imageName: cfg.imageName, computeType: 'GPU', cloudType: cfg.cloudType,
    gpuTypeIds: cfg.gpuTypeIds, gpuCount: cfg.gpuCount, containerDiskInGb: cfg.containerDiskInGb,
    ...(cfg.volumeInGb > 0 ? { volumeInGb: cfg.volumeInGb } : {}),
    ...(cfg.networkVolumeId ? { networkVolumeId: cfg.networkVolumeId } : {}),
    ports: ['22/tcp'], supportPublicIp: true,
    dockerEntrypoint: ['bash', '-lc'], dockerStartCmd: [renderRunPodBootstrapScript(MODEL)],
    env: { ...cfg.podEnv, PUBLIC_KEY: cfg.sshPublicKey },
  };
  log({ phase: 'payload', imageName: payload.imageName, cloudType: payload.cloudType, gpuTypeIds: payload.gpuTypeIds,
    gpuCount: payload.gpuCount, containerDiskInGb: payload.containerDiskInGb, ports: payload.ports,
    supportPublicIp: payload.supportPublicIp, envKeys: Object.keys(payload.env), dockerStartCmdBytes: payload.dockerStartCmd[0]!.length });

  const tunnels = new SshRunPodTunnelManager({ privateKeyPath: cfg.sshPrivateKeyPath, knownHostsPath: cfg.sshKnownHostsPath,
    connectTimeoutMs: 15_000, readinessTimeoutMs: 20_000 });
  let podId: string | null = null;
  let tunnel: RunPodTunnel | null = null;
  try {
    const create = await fetchHttpClient.send({ method: 'POST', url: `${cfg.apiBase}/pods`, headers: auth, body: JSON.stringify(payload), signal });
    podId = (JSON.parse(create.body) as { id?: string }).id ?? null;
    log({ phase: 'created', status: create.status, podId });
    if (!podId) throw new Error(`provider_create_without_id:${create.status}`);

    // Espera endpoint (publicIp + port22). maxProvisionMs vem do env (600000). Captura mapping stability.
    const deadline = Number(process.env.ANIMA_RUNPOD_MAX_PROVISION_MS ?? '600000');
    let ip = ''; let port = 0; let firstRunningAt = 0; let firstIpAt = 0; let firstPortAt = 0;
    const mappingSeen: string[] = [];
    for (;;) {
      const res = await fetchHttpClient.send({ method: 'GET', url: `${cfg.apiBase}/pods/${podId}`, headers: auth, signal });
      const pod = JSON.parse(res.body) as { desiredStatus?: string; publicIp?: string; portMappings?: Record<string, number> };
      if (pod.desiredStatus === 'RUNNING' && !firstRunningAt) firstRunningAt = t();
      if (pod.publicIp && !firstIpAt) firstIpAt = t();
      const p22 = pod.portMappings?.['22'];
      if (pod.publicIp && typeof p22 === 'number') {
        if (!firstPortAt) firstPortAt = t();
        const m = `${pod.publicIp}:${p22}`;
        if (mappingSeen[mappingSeen.length - 1] !== m) mappingSeen.push(m);
        ip = pod.publicIp; port = p22; break;
      }
      if (t() > deadline) { log({ phase: 'endpoint_timeout', deadline, firstRunningAt, firstIpAt }); break; }
      await sleep(6_000);
    }
    log({ phase: 'endpoint', firstRunningAt, firstIpAt, firstPortAt, mapping: mappingSeen[0] ?? null });
    if (!ip || !port) throw new Error('treatment_endpoint_timeout');

    // Abre o túnel SSH (prova SSH). Retry bounded.
    let lastErr: unknown = null;
    for (let a = 1; a <= 8; a += 1) {
      try { tunnel = await tunnels.open({ publicIp: ip, port, hostKeyAlias: `runpod-${podId}` }, signal); log({ phase: 'tunnel_opened', attempt: a }); break; }
      catch (e) { lastErr = e; const safe = e instanceof RunPodTunnelError ? { code: e.code, diagnostics: e.diagnostics } : { error: e instanceof Error ? e.message : String(e) };
        log({ phase: 'tunnel_retry', attempt: a, ...safe }); if (a < 8) await sleep(12_000); }
    }
    if (!tunnel) throw lastErr ?? new Error('tunnel_not_opened');
    const status = await tunnel.inspect?.();
    log({ phase: 'ssh_ready', status });

    // SSH de pé ⇒ lê o marcador AGORA (pode estar em progresso) e de novo após espera bounded, p/
    // capturar a classe da etapa pesada — SEM esperar o pull completo (custo bounded).
    log({ phase: 'marker_initial', value: await readMarker(ip, port, cfg.sshPrivateKeyPath) });
    await sleep(90_000);
    log({ phase: 'marker_after_90s', value: await readMarker(ip, port, cfg.sshPrivateKeyPath) });

    // Estabilidade do mapping: reconsulta o provider após o probe.
    const recheck = await fetchHttpClient.send({ method: 'GET', url: `${cfg.apiBase}/pods/${podId}`, headers: auth, signal });
    const rp = JSON.parse(recheck.body) as { desiredStatus?: string; publicIp?: string; portMappings?: Record<string, number> };
    log({ phase: 'mapping_recheck', desiredStatus: rp.desiredStatus ?? null, mapping: rp.publicIp && rp.portMappings?.['22'] ? `${rp.publicIp}:${rp.portMappings['22']}` : null, stable: !!(rp.publicIp && rp.portMappings?.['22'] && `${rp.publicIp}:${rp.portMappings['22']}` === `${ip}:${port}`) });
    log({ phase: 'TREATMENT_RESULT', tcpAndSshReady: !!(status?.processAlive && status.listenerReady) });
  } finally {
    await tunnel?.close();
    await tunnels.closeAll();
    if (podId) {
      let destroyed = false;
      for (let a = 1; a <= 4 && !destroyed; a += 1) {
        const res = await fetchHttpClient.send({ method: 'DELETE', url: `${cfg.apiBase}/pods/${podId}`, headers: auth, signal });
        destroyed = res.status === 404 || (res.status >= 200 && res.status < 300);
        log({ phase: 'destroy', podId, attempt: a, status: res.status, destroyed });
        if (!destroyed) await sleep(2_000);
      }
      if (!destroyed) throw new Error(`treatment_destroy_failed:${podId}`);
    }
    const list = await fetchHttpClient.send({ method: 'GET', url: `${cfg.apiBase}/pods`, headers: auth, signal });
    const pods = (() => { try { const j = JSON.parse(list.body); return Array.isArray(j) ? j : (j.pods ?? j.data ?? []); } catch { return []; } })();
    log({ phase: 'provider_absence', status: list.status, activePods: pods.length });
    if (pods.length !== 0) throw new Error('provider_resources_remain');
  }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
