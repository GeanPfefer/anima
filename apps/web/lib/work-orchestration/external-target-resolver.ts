import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalPathContains, compareExternalTargetIdentity, externalTargetToSpecTarget, isAbsoluteCanonicalPath, isExternalTargetReference,
  isFullCommitSha, readExternalTarget, sameCanonicalPath, type ExternalTargetIdentityV1, type ExternalTargetV1,
} from '@anima/core';
import { isAnimaProjectRoot, projectRoot, type ExecutionContract } from './executor-selection';
import { EXTERNAL_TARGETS_FILE_ENV, parseExternalTargetsFile, type ExternalTargetEntry } from './external-targets-registry';
import { createTrustedGitRunner, resolveTrustedRepository, type GitRunner, type TrustedRepository } from './trusted-git';

// ============================================================
// Resolver de TARGET EXTERNO (Project Builder V0 — T1).
//
// V1-02: VÁRIOS targets por host. Fontes de configuração (todas explícitas, nenhuma descoberta automática):
//   (a) arquivo de registro versionado em `ANIMA_EXTERNAL_TARGETS_FILE` (ver external-targets-registry.ts);
//   (b) legado: `ANIMA_EXTERNAL_TARGET` (UM target), mantido durante a transição.
// Precedência: não há — a MESMA referência em duas fontes é conflito e falha fechado (`external_target_config_conflict`). A
// referência é escolhida SEMPRE pelo work item/pedido; nunca por ser o único target disponível. Referência ausente de todas as
// fontes ⇒ `external_target_unknown`; duas referências que apontam o mesmo git-common-dir ⇒ `external_target_alias_conflict`.
//
// Config legada (UM target): `ANIMA_EXTERNAL_TARGET` =
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
  /** Prova de que `animaRoot()` é mesmo a raiz do Anima (não um cwd arbitrário). */
  readonly isAnimaRoot: (root: string) => boolean;
  /** Leitura do arquivo de registro de targets (lança se ausente/ilegível). */
  readonly readFile?: (path: string) => string;
}

export const defaultExternalTargetDeps: ExternalTargetDeps = {
  realpath: path => realpathSync.native(path),
  exists: path => existsSync(path),
  resolveRepository: repoRoot => resolveTrustedRepository(repoRoot),
  gitFor: gitDir => createTrustedGitRunner({ gitDir }),
  animaRoot: () => projectRoot(),
  isAnimaRoot: root => isAnimaProjectRoot(root),
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

export interface ConfiguredExternalTarget extends ExternalTargetEntry { readonly source: 'file' | 'legacy' }

export type ConfiguredExternalTargetsResult = { readonly ok: true; readonly targets: readonly ConfiguredExternalTarget[]; readonly configured: boolean } | ExternalTargetFailure;

/**
 * Todos os targets configurados neste host (arquivo + legado). Qualquer fonte presente e malformada ⇒ falha fechada para TODAS
 * (não se adivinha o que o operador quis). Nada é executado a partir do conteúdo.
 */
export function loadConfiguredExternalTargets(env: EnvLike = process.env, deps: Pick<ExternalTargetDeps, 'readFile'> = defaultExternalTargetDeps): ConfiguredExternalTargetsResult {
  const targets: ConfiguredExternalTarget[] = [];
  const filePath = env[EXTERNAL_TARGETS_FILE_ENV];
  if (filePath !== undefined && filePath.trim() !== '') {
    if (!isAbsoluteCanonicalPath(filePath.trim())) return refuse('external_targets_file_path_invalid', `${EXTERNAL_TARGETS_FILE_ENV} deve ser um caminho absoluto.`);
    let raw: string;
    try { raw = (deps.readFile ?? ((p: string) => readFileSync(p, 'utf8')))(filePath.trim()); }
    catch { return refuse('external_targets_file_unreadable', 'O registro de targets externos não existe ou não é legível.'); }
    const parsed = parseExternalTargetsFile(raw);
    if (!parsed.ok) return parsed;
    for (const entry of parsed.entries) targets.push({ ...entry, source: 'file' });
  }
  const legacyRaw = env[EXTERNAL_TARGET_ENV];
  if (legacyRaw !== undefined && legacyRaw.trim() !== '') {
    const legacy = parseExternalTargetConfig(legacyRaw);
    if (!legacy.ok) return legacy;
    targets.push({ ...legacy.config, source: 'legacy' });
  }
  return { ok: true, targets, configured: targets.length > 0 || (filePath !== undefined && filePath.trim() !== '') };
}

const gitDirOf = (repoRoot: string, deps: ExternalTargetDeps): string | null => {
  try { return deps.realpath(join(deps.realpath(repoRoot), '.git')); } catch { return null; }
};

/**
 * Resolve a configuração do target pela REFERÊNCIA (nunca pelo único disponível). Falha fechada em: nenhuma fonte configurada,
 * referência desconhecida, mesma referência em fontes diferentes (conflito) e outra referência apontando o MESMO git-common-dir.
 */
export function resolveExternalTargetConfig(
  env: EnvLike, reference: string, deps: ExternalTargetDeps = defaultExternalTargetDeps,
): { readonly ok: true; readonly config: ExternalTargetConfigV1; readonly entry: ConfiguredExternalTarget } | ExternalTargetFailure {
  const loaded = loadConfiguredExternalTargets(env, deps);
  if (!loaded.ok) return loaded;
  if (!loaded.configured) return refuse('external_target_not_configured', 'Nenhum target externo foi autorizado pelo operador.');
  const matches = loaded.targets.filter(t => t.reference === reference);
  if (matches.length === 0) return refuse('external_target_unknown', `A referência ${reference} não está autorizada neste host.`);
  if (matches.length > 1) return refuse('external_target_config_conflict', `A referência ${reference} está definida em mais de uma fonte (${matches.map(m => m.source).join(' e ')}); remova uma delas.`);
  const entry = matches[0]!;
  const dir = gitDirOf(entry.repoRoot, deps);
  if (dir !== null) {
    const alias = loaded.targets.find(t => t !== entry && t.reference !== reference && (() => { const other = gitDirOf(t.repoRoot, deps); return other !== null && sameCanonicalPath(other, dir); })());
    if (alias) return refuse('external_target_alias_conflict', `As referências ${reference} e ${alias.reference} apontam o mesmo repositório físico; mantenha uma só.`);
  }
  return { ok: true, entry, config: { reference: entry.reference, repoRoot: entry.repoRoot, rootCommitSha: entry.rootCommitSha } };
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

  // Disfarce de Anima: nem o mesmo repositório, nem aninhado em qualquer direção. A raiz do Anima precisa ser COMPROVADA
  // (marcadores do monorepo) e legível; sem isso a checagem não existiria, então a recusa é explícita (nunca falha aberta).
  const animaUnknown = refuse('external_target_anima_root_unknown', 'A raiz do Anima não pôde ser comprovada; o target externo não pode ser distinguido dele.');
  let anima: string;
  let animaGitCanonical: string;
  try {
    const animaRaw = deps.animaRoot();
    if (!deps.isAnimaRoot(animaRaw)) return animaUnknown;
    anima = deps.realpath(animaRaw);
    animaGitCanonical = deps.realpath(join(anima, '.git'));
  } catch { return animaUnknown; }
  if (canonicalPathContains(anima, repoRoot) || canonicalPathContains(repoRoot, anima) || sameCanonicalPath(animaGitCanonical, gitCommonDir)) {
    return refuse('external_target_is_anima', 'O target externo coincide com, ou se sobrepõe a, o repositório do Anima.');
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
  options: { readonly baseSha?: string; readonly deps?: ExternalTargetDeps; readonly reference?: string } = {},
): Promise<{ readonly ok: true; readonly specTarget: Record<string, unknown>; readonly target: ExternalTargetV1 } | ExternalTargetFailure> {
  // Com `reference` (V1-02) a escolha é pela referência pedida; sem ela só vale o modo legado de UM target (sem arquivo de registro).
  const filePath = env[EXTERNAL_TARGETS_FILE_ENV];
  if (options.reference === undefined && filePath !== undefined && filePath.trim() !== '') return refuse('external_target_reference_required', 'Com registro de targets configurado a referência (ext:<slug>) é obrigatória.');
  const config = options.reference !== undefined
    ? resolveExternalTargetConfig(env, options.reference, options.deps ?? defaultExternalTargetDeps)
    : parseExternalTargetConfig(env[EXTERNAL_TARGET_ENV]);
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

  const config = resolveExternalTargetConfig(env, authorized.target.reference, deps);
  if (!config.ok) return config;

  const observed = await inspectExternalTarget(config.config, authorized.target.identity.baseSha, deps);
  if (!observed.ok) return observed;
  const mismatch = compareExternalTargetIdentity(authorized.target.identity, observed.identity);
  if (mismatch) return refuse('external_target_identity_changed', `A identidade do target externo mudou após a autorização (${mismatch}).`);
  return { ok: true, reference: authorized.target.reference, repoRoot: observed.repoRoot, identity: observed.identity };
}

export interface ExternalTargetListing {
  readonly reference: string;
  readonly source: 'file' | 'legacy';
  readonly repoRoot: string;
  readonly rootCommitSha: string;
  readonly integrationTargetRef: string | null;
  /** `ok` ou o código da recusa (conflito, alias, identidade, Git inválido…). */
  readonly status: string;
  readonly gitCommonDir: string | null;
  readonly headSha: string | null;
}

/** Lista os targets configurados e o estado de cada um (somente leitura: realpath e Git confiável; nada é escrito). */
export async function listExternalTargets(
  env: EnvLike = process.env, deps: ExternalTargetDeps = defaultExternalTargetDeps,
): Promise<{ readonly ok: true; readonly configured: boolean; readonly targets: readonly ExternalTargetListing[] } | ExternalTargetFailure> {
  const loaded = loadConfiguredExternalTargets(env, deps);
  if (!loaded.ok) return loaded;
  const targets: ExternalTargetListing[] = [];
  for (const entry of loaded.targets) {
    const base = { reference: entry.reference, source: entry.source, repoRoot: entry.repoRoot, rootCommitSha: entry.rootCommitSha, integrationTargetRef: entry.integrationTargetRef ?? null };
    const resolved = resolveExternalTargetConfig(env, entry.reference, deps);
    if (!resolved.ok) { targets.push({ ...base, status: resolved.code, gitCommonDir: null, headSha: null }); continue; }
    const inspected = await inspectExternalTarget(resolved.config, null, deps);
    targets.push(inspected.ok
      ? { ...base, status: 'ok', gitCommonDir: inspected.identity.gitCommonDirCanonical, headSha: inspected.identity.baseSha }
      : { ...base, status: inspected.code, gitCommonDir: null, headSha: null });
  }
  return { ok: true, configured: loaded.configured, targets };
}
