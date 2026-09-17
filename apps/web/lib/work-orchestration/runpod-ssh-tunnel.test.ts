/** @jest-environment node */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { RunPodTunnelError, SshRunPodTunnelManager, type SshTunnelDependencies } from './runpod-ssh-tunnel';

interface FakeChild extends ChildProcess { exitCode: number | null; signalCode: NodeJS.Signals | null }
const fakeChild = (): FakeChild => {
  const child = new EventEmitter() as FakeChild;
  Object.assign(child, { pid: 321, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough() });
  child.kill = jest.fn(() => { child.signalCode = 'SIGTERM'; child.emit('exit', null, 'SIGTERM'); child.emit('close', null, 'SIGTERM'); return true; });
  return child;
};
const manager = (dependencies: SshTunnelDependencies, over: Record<string, unknown> = {}) => new SshRunPodTunnelManager({
  privateKeyPath: 'C:/secret/id_ed25519', knownHostsPath: 'C:/secret/known_hosts', connectTimeoutMs: 1_000,
  readinessTimeoutMs: 1_000, dependencies, ...over,
});

describe('SshRunPodTunnelManager', () => {
  test('usa identidade dedicada, bind loopback e só fica ready com processo vivo + listener', async () => {
    const child = fakeChild(); let recordedArgs: readonly string[] = []; let checks = 0;
    const tunnel = await manager({
      allocateLoopbackPort: async () => 24567,
      spawnProcess: (_command, args) => { recordedArgs = args; return child; },
      isLoopbackPortListening: async () => { checks += 1; return checks >= 2; }, sleep: async () => undefined,
    }).open({ publicIp: '1.2.3.4', port: 22022, hostKeyAlias: 'runpod-pod-1' }, new AbortController().signal);
    expect(recordedArgs).toEqual(expect.arrayContaining(['ExitOnForwardFailure=yes', 'IdentitiesOnly=yes', 'HostKeyAlias=runpod-pod-1', '-i', 'C:/secret/id_ed25519', '-L', '127.0.0.1:24567:127.0.0.1:11434', 'root@1.2.3.4']));
    expect(tunnel.endpoint).toBe('http://127.0.0.1:24567'); expect(checks).toBe(2);
    expect(await tunnel.inspect?.()).toEqual({ pid: 321, processAlive: true, listenerReady: true, localPort: 24567 });
    await tunnel.close(); expect(child.kill).toHaveBeenCalledTimes(1);
  });

  test('exit imediato/porta ocupada preserva exit, stderr bounded e redige paths dos args', async () => {
    const child = fakeChild();
    const opening = manager({
      allocateLoopbackPort: async () => 24567,
      spawnProcess: () => { queueMicrotask(() => { child.stderr?.emit('data', `bind: Address already in use ${'x'.repeat(100)}`); child.exitCode = 255; child.emit('exit', 255, null); child.emit('close', 255, null); }); return child; },
      isLoopbackPortListening: async () => false, sleep: async () => new Promise(resolve => setImmediate(resolve)),
    }, { diagnosticMaxBytes: 80 }).open({ publicIp: '1.2.3.4', port: 22022 }, new AbortController().signal);
    await expect(opening).rejects.toMatchObject({ code: 'tunnel_exited_before_ready' });
    try { await opening; } catch (error) {
      expect(error).toBeInstanceOf(RunPodTunnelError);
      const diagnostic = (error as RunPodTunnelError).diagnostics;
      expect(diagnostic.exitCode).toBe(255); expect(String(diagnostic.stderr).length).toBeLessThanOrEqual(80);
      expect(JSON.stringify(diagnostic.args)).not.toContain('C:/secret'); expect(diagnostic.processAlive).toBe(false);
    }
  });

  test('processo vivo sem listener termina com diagnóstico distinto e teardown', async () => {
    const child = fakeChild(); let instant = 0;
    const opening = manager({ allocateLoopbackPort: async () => 24567, spawnProcess: () => child,
      isLoopbackPortListening: async () => false, sleep: async () => undefined, now: () => (instant += 600),
    }).open({ publicIp: '1.2.3.4', port: 22022 }, new AbortController().signal);
    await expect(opening).rejects.toMatchObject({ code: 'tunnel_listener_timeout' }); expect(child.kill).toHaveBeenCalledTimes(1);
  });

  test('erro de spawn, abort e closeAll são tratados', async () => {
    const failed = fakeChild();
    const spawnFailure = manager({ allocateLoopbackPort: async () => 24567,
      spawnProcess: () => { queueMicrotask(() => failed.emit('error', new Error('ENOENT'))); return failed; },
      isLoopbackPortListening: async () => false, sleep: async () => new Promise(resolve => setImmediate(resolve)),
    }).open({ publicIp: '1.2.3.4', port: 22022 }, new AbortController().signal);
    await expect(spawnFailure).rejects.toMatchObject({ code: 'tunnel_spawn_failed' });
    const alive = fakeChild();
    const m = manager({ allocateLoopbackPort: async () => 24567, spawnProcess: () => alive, isLoopbackPortListening: async () => true });
    await m.open({ publicIp: '1.2.3.4', port: 22022 }, new AbortController().signal); await m.closeAll();
    expect(alive.kill).toHaveBeenCalledTimes(1);
    const aborted = new AbortController(); aborted.abort();
    await expect(m.open({ publicIp: '1.2.3.4', port: 22022 }, aborted.signal)).rejects.toMatchObject({ code: 'tunnel_aborted' });
  });
});
