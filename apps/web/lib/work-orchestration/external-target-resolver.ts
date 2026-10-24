import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalPathContains, compareExternalTargetIdentity, externalTargetToSpecTarget, isAbsoluteCanonicalPath, isExternalTargetReference,
  isFullCommitSha, readExternalTarget, sameCanonicalPath, type ExternalTargetIdentityV1, type ExternalTargetV1,
} from '@anima/core';
import { projectRoot, type ExecutionContract } from './executor-selection';
import { createTrustedGitRunner, resolveTrustedRepository, type GitRunner, type TrustedRepository } from './trusted-git';

// ============================================================
// Resolver de TARGET EXTERNO (Project Builder V0 — T1).
//
// Config explícita do operador (UM target): `ANIMA_EXTERNAL_TARGET` =
//   {"reference":"ext:<slug>","repoRoot":"<abs>","rootCommitSha":"<40hex>"}
// O operador fixa qual repositório (e qual história) está autorizado. Nada é descoberto,
// nada cai em `projectRoot()`: referência desconhecida ou identidade divergente ⇒ recusa
// tipada, ANTES do claim. Git via `trusted-git` (ambiente limpo, `--git-dir` explícito,
// hooks/fsmonitor desligados, .git redirecionado recusado).
// ============================================================

export const EXTERNAL_TARGET_ENV = 'ANIMA_EXTERNAL_TARGET';

type EnvLike = Readonly<Record<string, string | undefined>>;

export interface ExternalTargetConfigV1 {
  readonly reference: string;
  readonly repoRoot: string;
  readonly rootCommitSha: string;
}

export interface ExternalTargetDeps {
  readonly realpath: (path: string) => string;
  readonly exists: (path: string) => boolean;
  readonly resolveRepository: (repoRoot: string) => TrustedRepository;
  readonly gitFor: (gitDir: string) => GitRunner;
  readonly animaRoot: () => string;
}

export const defaultExternalTargetDeps: ExternalTargetDeps = {
  realpath: path => realpathSync.native(path),
  exists: path => existsSync(path),
  resolveRepository: repoRoot => resolveTrustedRepository(repoRoot),
  gitFor: gitDir => createTrustedGitRunner({ gitDir }),
  animaRoot: () => projectRoot(),
};

export type ExternalTargetFailure = { readonly ok: false; readonly code: string; readonly message: string };
const refuse = (code: string, message: string): ExternalTargetFailure => ({ ok: false, code, message });

export type ExternalTargetConfigResult = { readonly ok: true; readonly config: ExternalTargetConfigV1 } | ExternalTargetFailure;

export function parseExternalTargetConfig(raw: string | undefined): ExternalTargetConfigResult {
  if (!raw || raw.trim() === '') return refuse('external_target_not_configured', 'Nenhum target externo foi autorizado pelo operador.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return refuse('external_target_config_invalid', 'A configuração do target externo não é JSON válido.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return refuse('external_target_config_invalid', 'A configuração do target externo deve ser um objeto.');
  const o = parsed as Record<string, unknown>;
  if (Object.keys(o).sort().join(',') !== 'reference,repoRoot,rootCommitSha'
    || !isExternalTargetReference(o['reference']) || !isAbsoluteCanonicalPath(o['repoRoot']) || !isFullCommitSha(o['rootCommitSha'])) {
    return refuse('external_target_config_invalid', 'A configuração do target externo exige exatamente reference (ext:<slug>), repoRoot absoluto e rootCommitSha de 40 hex.');
  }
  return { ok: true, config: { reference: o['reference'], repoRoot: o['repoRoot'], rootCommitSha: o['rootCommitSha'] } };
}

export type InspectedExternalTarget = { readonly ok: true; readonly identity: ExternalTargetIdentityV1; readonly repoRoot: string } | ExternalTargetFailure;

/**
 * Inspeciona o repositório configurado e devolve a identidade CANÔNICA observada.
 * `baseSha` ausente ⇒ HEAD atual (captura de autorização); presente ⇒ esse commit exato.
 */
export async function inspectExternalTarget(
  config: ExternalTargetConfigV1,
  baseSha: string | null,
  deps: ExternalTargetDeps = defaultExternalTargetDeps,
): Promise<InspectedExternalTarget> {
  let repoRoot: string;
  try { repoRoot = deps.realpath(config.repoRoot); }
  catch { return refuse('external_target_root_unreadable', 'O repositório externo autorizado não existe ou não é legível.'); }

  const repo = deps.resolveRepository(repoRoot);
  if (!repo.ok) return refuse('external_target_git_invalid', `Repositório externo recusado: ${repo.reason}.`);
  let gitCommonDir: string;
  try { gitCommonDir = deps.realpath(repo.gitDir); }
  catch { return refuse('external_target_git_invalid', 'O diretório Git do target externo não é legível.'); }
  if (deps.exists(join(gitCommonDir, 'commondir'))) return refuse('external_target_git_invalid', 'Repositório externo é um worktree vinculado (commondir).');
  if (deps.exists(join(gitCommonDir, 'objects', 'info', 'alternates'))) return refuse('external_target_git_invalid', 'Repositório externo usa objetos alternativos (alternates).');

  // Disfarce de Anima: nem o mesmo repositório, nem aninhado em qualquer direção.
  let anima: string | null = null;
  try { anima = deps.realpath(deps.animaRoot()); } catch { /* sem raiz do Anima legível ⇒ nada a comparar */ }
  if (anima) {
    const animaGit = join(anima, '.git');
    let animaGitCanonical: string | null = null;
    try { animaGitCanonical = deps.realpath(animaGit); } catch { /* ignora */ }
    if (canonicalPathContains(anima, repoRoot) || canonicalPathContains(repoRoot, anima)
      || (animaGitCanonical !== null && sameCanonicalPath(animaGitCanonical, gitCommonDir))) {
      return refuse('external_target_is_anima', 'O target externo coincide com, ou se sobrepõe a, o repositório do Anima.');
    }
  }

  const git = deps.gitFor(repo.gitDir);
  let base = baseSha;
  if (base === null) {
    const head = await git(['rev-parse', '--verify', 'HEAD^{commit}']);
    base = head.exitCode === 0 ? head.stdout.trim() : null;
  }
  if (!isFullCommitSha(base)) return refuse('external_target_base_sha_invalid', 'O SHA-base do target externo não é um commit de 40 hex.');
  const verified = await git(['rev-parse', '--verify', `${base}^{commit}`]);
  if (verified.exitCode !== 0 || verified.stdout.trim() !== base) return refuse('external_target_base_sha_invalid', 'O SHA-base não existe como commit no target externo.');

  const roots = await git(['rev-list', '--max-parents=0', base]);
  const rootShas = roots.stdout.split('\n').map(l => l.trim()).filter(Boolean);
  if (roots.exitCode !== 0 || rootShas.length !== 1 || !isFullCommitSha(rootShas[0])) {
    return refuse('external_target_root_commit_ambiguous', 'A história do target externo não tem exatamente um commit raiz.');
  }
  if (rootShas[0] !== config.rootCommitSha) return refuse('external_target_root_commit_mismatch', 'O commit raiz do repositório diverge do autorizado pelo operador.');

  return { ok: true, repoRoot, identity: { repoRootCanonical: repoRoot, gitCommonDirCanonical: gitCommonDir, rootCommitSha: rootShas[0], baseSha: base } };
}

/** Captura a identidade a gravar em `execution_spec.target` no momento da autorização. */
export async function captureExternalTargetSpec(
  env: EnvLike = process.env,
  options: { readonly baseSha?: string; readonly deps?: ExternalTargetDeps } = {},
): Promise<{ readonly ok: true; readonly specTarget: Record<string, unknown>; readonly target: ExternalTargetV1 } | ExternalTargetFailure> {
  const config = parseExternalTargetConfig(env[EXTERNAL_TARGET_ENV]);
  if (!config.ok) return config;
  const inspected = await inspectExternalTarget(config.config, options.baseSha ?? null, options.deps);
  if (!inspected.ok) return inspected;
  const target: ExternalTargetV1 = { reference: config.config.reference, identity: inspected.identity };
  return { ok: true, target, specTarget: externalTargetToSpecTarget(target) };
}

export type VerifiedExternalTarget = { readonly ok: true; readonly reference: string; readonly repoRoot: string; readonly identity: ExternalTargetIdentityV1 } | ExternalTargetFailure;

/**
 * Confronta a identidade AUTORIZADA (persistida no contrato) com o repositório vivo.
 * Chamada antes do claim, e de novo na observação pós-volta. Sem fallback: qualquer
 * dúvida é recusa. O `repoRoot` devolvido é o canônico observado — o único que a
 * execução, o Git observado e o Verifier podem usar.
 */
export async function verifyExternalTargetForContract(
  contract: Pick<ExecutionContract, 'targetKind' | 'targetReference' | 'baseSha' | 'targetSpec'>,
  env: EnvLike = process.env,
  deps: ExternalTargetDeps = defaultExternalTargetDeps,
): Promise<VerifiedExternalTarget> {
  const authorized = readExternalTarget(contract.targetSpec);
  if (!authorized.ok) return refuse(authorized.reason, 'O contrato não carrega uma identidade válida de target externo.');
  if (contract.targetKind !== 'project' || contract.targetReference !== authorized.target.reference) {
    return refuse('external_target_reference_invalid', 'A referência do contrato diverge do target autorizado.');
  }
  if (contract.baseSha !== authorized.target.identity.baseSha) return refuse('external_target_identity_changed', 'O SHA-base do contrato diverge da identidade autorizada (base_sha_changed).');

  const config = parseExternalTargetConfig(env[EXTERNAL_TARGET_ENV]);
  if (!config.ok) return config;
  if (config.config.reference !== authorized.target.reference) return refuse('external_target_unknown', `A referência ${authorized.target.reference} não está autorizada neste host.`);

  const observed = await inspectExternalTarget(config.config, authorized.target.identity.baseSha, deps);
  if (!observed.ok) return observed;
  const mismatch = compareExternalTargetIdentity(authorized.target.identity, observed.identity);
  if (mismatch) return refuse('external_target_identity_changed', `A identidade do target externo mudou após a autorização (${mismatch}).`);
  return { ok: true, reference: authorized.target.reference, repoRoot: observed.repoRoot, identity: observed.identity };
}
