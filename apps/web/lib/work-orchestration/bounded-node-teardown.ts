import type { NodeProvisioner, ProvisionedNodeHandle } from '@anima/core';

export const DEFAULT_NODE_TEARDOWN_TIMEOUT_MS = 10_000;

export type NodeTeardownOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly stage: 'stop' | 'destroy' | 'timeout'; readonly reason: string };

/**
 * Reduz um efeito já existente usando autoridade própria, curta e bounded. O signal do
 * workload nunca entra aqui: cancelamento/deadline do trabalho não pode impedir a tentativa
 * de eliminar um recurso conhecido. `destroy`, quando existe, faz parte da convergência para
 * ausência; só então o caller pode afirmar `offline`.
 */
export async function teardownKnownNode(
  provisioner: NodeProvisioner,
  handle: ProvisionedNodeHandle,
  timeoutMs = DEFAULT_NODE_TEARDOWN_TIMEOUT_MS,
): Promise<NodeTeardownOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const teardown = (async (): Promise<NodeTeardownOutcome> => {
    try {
      const stopped = await provisioner.stop(handle, controller.signal);
      if (!stopped.ok) return { ok: false, stage: 'stop', reason: stopped.reason };
      if (controller.signal.aborted) return { ok: false, stage: 'timeout', reason: 'node_teardown_timeout' };
      if (provisioner.destroy) {
        const destroyed = await provisioner.destroy(handle, controller.signal);
        if (!destroyed.ok) return { ok: false, stage: 'destroy', reason: destroyed.reason };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        stage: controller.signal.aborted ? 'timeout' : 'stop',
        reason: error instanceof Error ? error.message : 'node_teardown_failed',
      };
    }
  })();

  const timeout = new Promise<NodeTeardownOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, stage: 'timeout', reason: 'node_teardown_timeout' });
    }, Math.max(1, timeoutMs));
  });

  try {
    return await Promise.race([teardown, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
