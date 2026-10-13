import { singleItemContractRefusal } from '@anima/core';
import { resolveCodexCliConfig } from './codex-cli-coder';
import { createNodeExecutorReadinessDeps, probeExecutorReadiness, type ExecutorReadinessDeps } from './executor-readiness';

/** Reusa a observação do runtime real; não inicia coder, worktree ou attempt. */
export async function singleItemCodexRefusal(
  intent: unknown,
  deps: ExecutorReadinessDeps = createNodeExecutorReadinessDeps(),
): Promise<string | null> {
  const refusal = singleItemContractRefusal(intent);
  if (refusal) return refusal;
  const spec = (intent as { execution_spec: Record<string, unknown> }).execution_spec;
  if (spec['coder_backend'] !== 'codex-cli') return null;
  const env = deps.env;
  if (env.ANIMA_CODEX_CLI_TRANSPORT !== 'wsl'
    || !env.ANIMA_CODEX_WSL_DISTRO?.trim() || !env.ANIMA_CODEX_WSL_USER?.trim()
    || !env.ANIMA_CODEX_WSL_CLI_PATH?.trim() || env.ANIMA_CODEX_CLI_PROFILE?.trim()) {
    return 'single_item_codex_wsl_required';
  }
  const config = resolveCodexCliConfig('default', env, deps.platform as NodeJS.Platform);
  if (!config.ok || !config.value.wsl || config.value.model !== 'default') return 'single_item_codex_wsl_required';
  const observed = await probeExecutorReadiness('codex-cli', deps);
  return observed.availability === 'ready' ? null : 'single_item_codex_authentication_unproved';
}
