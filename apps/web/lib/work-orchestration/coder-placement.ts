import type { MachinePressure } from '@anima/core';
import type { OllamaCoderRuntimeConfig } from './ollama-coder-config';

export type CoderNodeBillingMode = 'owned' | 'already_provisioned' | 'paid';

export interface CoderInferenceNodeV0 {
  readonly id: string;
  readonly endpoint: string;
  readonly locality: 'remote';
  readonly enabled: boolean;
  readonly healthy: boolean;
  readonly capabilities: readonly ['coder_inference'];
  readonly models: readonly string[];
  readonly resourceClass: string;
  readonly billingMode: CoderNodeBillingMode;
}

export type CoderPlacementDecisionV0 =
  | { readonly placement: 'local'; readonly reason: 'local_pressure_low' }
  | { readonly placement: 'remote'; readonly node: CoderInferenceNodeV0; readonly reason: 'local_pressure_requires_burst' }
  | { readonly placement: 'defer'; readonly reason: 'pressure_unknown' | 'no_eligible_remote_node' | 'paid_compute_not_authorized' };

export function decideCoderPlacement(input: {
  readonly pressure: MachinePressure;
  readonly model: string;
  readonly nodes: readonly CoderInferenceNodeV0[];
  readonly paidComputeAuthorized: boolean;
}): CoderPlacementDecisionV0 {
  if (input.pressure === 'low') return { placement: 'local', reason: 'local_pressure_low' };
  if (input.pressure === 'unknown') return { placement: 'defer', reason: 'pressure_unknown' };

  const capable = input.nodes
    .filter(node => node.enabled && node.healthy && node.capabilities.includes('coder_inference') && node.models.includes(input.model))
    .sort((left, right) => left.id.localeCompare(right.id));
  const eligible = capable.find(node => node.billingMode !== 'paid' || input.paidComputeAuthorized);
  if (eligible) return { placement: 'remote', node: eligible, reason: 'local_pressure_requires_burst' };
  if (capable.some(node => node.billingMode === 'paid')) return { placement: 'defer', reason: 'paid_compute_not_authorized' };
  return { placement: 'defer', reason: 'no_eligible_remote_node' };
}

const truthy = (value: string | undefined): boolean => value?.trim().toLowerCase() === 'true';

export function readExplicitCoderNodeV0(
  model: string,
  env: Record<string, string | undefined> = process.env,
): CoderInferenceNodeV0 | null {
  const endpoint = env.ANIMA_WORKTREE_OLLAMA_URL?.trim();
  const id = env.ANIMA_WORKTREE_OLLAMA_NODE_ID?.trim();
  if (!endpoint || !id || env.ANIMA_WORKTREE_OLLAMA_LOCALITY?.trim() !== 'remote') return null;
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
      || !parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash
      || (parsed.pathname !== '' && parsed.pathname !== '/')) return null;
  } catch { return null; }
  const billing = env.ANIMA_WORKTREE_OLLAMA_BILLING_MODE?.trim();
  const billingMode: CoderNodeBillingMode = billing === 'paid' || billing === 'already_provisioned' ? billing : 'owned';
  const models = (env.ANIMA_WORKTREE_OLLAMA_MODELS ?? model).split(',').map(value => value.trim()).filter(Boolean);
  return {
    id,
    endpoint,
    locality: 'remote',
    enabled: env.ANIMA_WORKTREE_OLLAMA_ENABLED === undefined || truthy(env.ANIMA_WORKTREE_OLLAMA_ENABLED),
    healthy: truthy(env.ANIMA_WORKTREE_OLLAMA_HEALTHY),
    capabilities: ['coder_inference'],
    models,
    resourceClass: env.ANIMA_WORKTREE_OLLAMA_RESOURCE_CLASS?.trim() || 'unspecified',
    billingMode,
  };
}

export function remoteRuntimeFor(node: CoderInferenceNodeV0, model: string): OllamaCoderRuntimeConfig {
  return {
    url: node.endpoint.replace(/\/+$/, ''),
    backendId: `ollama:remote/${node.id}:${model}`,
    locality: 'remote',
    nodeId: node.id,
  };
}

export function localRuntimeFor(model: string, env: Record<string, string | undefined> = process.env): OllamaCoderRuntimeConfig {
  return {
    url: (env.OLLAMA_URL?.trim() || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    backendId: `ollama:${model}`,
    locality: 'local',
    nodeId: null,
  };
}
