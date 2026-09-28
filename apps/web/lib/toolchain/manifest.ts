// ============================================================
// Toolchain Manifest V0 — contrato versionado do toolchain que uma máquina nova
// precisa para reconstruir e operar o Anima. Formaliza o que é pinado, o que é só
// mínimo e o que continua mutável. NUNCA contém tokens, caminhos pessoais ou valores
// de ambiente. Consumido pelo checker read-only (`anima toolchain check`).
// Registro: docs/registros/2026-09-28-toolchain-manifest-v0.md.
// ============================================================

export const TOOLCHAIN_MANIFEST_SCHEMA = 'anima.toolchain.v0' as const;

export const TOOLCHAIN_GROUPS = ['core', 'database', 'web', 'mobile', 'local-ai', 'self-development', 'research-web', 'runpod'] as const;
export type ToolchainGroup = (typeof TOOLCHAIN_GROUPS)[number];

export type PinType = 'exact' | 'lockfile' | 'digest' | 'major' | 'minimum' | 'mutable_tag' | 'none';
export type Platform = 'windows' | 'linux' | 'macos';

export type VersionConstraint =
  | { readonly type: 'exact'; readonly version: string }
  | { readonly type: 'caret'; readonly version: string } // mesmo major, >= version
  | { readonly type: 'minimum'; readonly version: string }
  | { readonly type: 'range'; readonly min: string; readonly maxExclusive: string }
  | { readonly type: 'any' };

/**
 * Como o checker valida: `probe` executa comandos FIXOS e seguros (só `--version`/`-V`)
 * e extrai a versão por regex — a saída bruta nunca é emitida; `repo_file` verifica um
 * arquivo versionado; `none` = o checker não consegue provar (daemon/modelo/imagem/SDK).
 */
export type ToolchainValidation =
  | { readonly kind: 'probe'; readonly commands: readonly (readonly string[])[]; readonly versionPattern: string }
  | { readonly kind: 'repo_file'; readonly path: string }
  | { readonly kind: 'none'; readonly reason: string };

export interface ToolchainEntry {
  readonly tool: string;
  readonly versionConstraint: VersionConstraint;
  /** Versão efetivamente usada nas provas registradas (ex.: Restore V0.1), quando conhecida. */
  readonly provenVersion: string | null;
  readonly pinType: PinType;
  readonly installSource: string;
  readonly requiredFor: readonly ToolchainGroup[];
  readonly optionalFor?: readonly ToolchainGroup[];
  readonly platform: readonly Platform[];
  readonly validation: ToolchainValidation;
  /** Reinstalar pelo contrato reproduz o mesmo artefato? (major/mínimo/tag mutável ⇒ false). */
  readonly reproducible: boolean;
  readonly hostSpecific: boolean;
  readonly notes: string;
}

export interface ToolchainGroupSpec {
  readonly group: ToolchainGroup;
  readonly kind: 'core' | 'capability';
  readonly description: string;
}

export const TOOLCHAIN_GROUP_SPECS: readonly ToolchainGroupSpec[] = [
  { group: 'core', kind: 'core', description: 'Instalar dependências e rodar CLI/Resident Host/testes (Node + npm + git + lockfile).' },
  { group: 'database', kind: 'capability', description: 'Stack Supabase local e restore (Docker + Supabase CLI).' },
  { group: 'web', kind: 'capability', description: 'Next.js web (mesmo runtime do core).' },
  { group: 'mobile', kind: 'capability', description: 'App Expo/React Native (JDK + Android SDK; iOS exige macOS/Xcode).' },
  { group: 'local-ai', kind: 'capability', description: 'Inferência local via Ollama e modelos canônicos.' },
  { group: 'self-development', kind: 'capability', description: 'Executor de worktree/coder e runner local (Python + contêiner).' },
  { group: 'research-web', kind: 'capability', description: 'research.web: SearXNG + agent-browser + Chrome for Testing.' },
  { group: 'runpod', kind: 'capability', description: 'Burst RunPod: túnel SSH host-side (a API é externa).' },
];

const ALL: readonly Platform[] = ['windows', 'linux', 'macos'];
const SEMVER = '(\\d+\\.\\d+\\.\\d+)';

export const TOOLCHAIN_MANIFEST: readonly ToolchainEntry[] = [
  // ---------- core ----------
  {
    tool: 'node', versionConstraint: { type: 'caret', version: '24.16.0' }, provenVersion: '24.16.0', pinType: 'major',
    installSource: 'nodejs.org (LTS 24.x); declarado em package.json#engines', requiredFor: ['core', 'web', 'self-development'], platform: ALL,
    validation: { kind: 'probe', commands: [['node', '--version']], versionPattern: `v?${SEMVER}` },
    reproducible: false, hostSpecific: false,
    notes: 'CLI e Resident Host rodam TS nativo (--experimental-transform-types) do Node 24. Patch não pinado.',
  },
  {
    tool: 'npm', versionConstraint: { type: 'minimum', version: '11.13.0' }, provenVersion: '11.13.0', pinType: 'exact',
    installSource: 'distribuído com o Node; package.json#packageManager = npm@11.13.0', requiredFor: ['core', 'web'], platform: ALL,
    validation: { kind: 'probe', commands: [['npm', '--version']], versionPattern: SEMVER },
    reproducible: true, hostSpecific: false, notes: 'packageManager declara a versão exata; engines aceita >= 11.13.0.',
  },
  {
    tool: 'git', versionConstraint: { type: 'minimum', version: '2.40.0' }, provenVersion: '2.54.0', pinType: 'minimum',
    installSource: 'git-scm.com', requiredFor: ['core', 'self-development'], platform: ALL,
    validation: { kind: 'probe', commands: [['git', '--version']], versionPattern: `git version ${SEMVER}` },
    reproducible: false, hostSpecific: false, notes: 'Worktrees/archival refs; mínimo conservador, sem pin.',
  },
  {
    tool: 'npm-dependencies', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'lockfile',
    installSource: 'npm ci (package-lock.json v3 na raiz do monorepo)', requiredFor: ['core', 'web', 'mobile'], platform: ALL,
    validation: { kind: 'repo_file', path: 'package-lock.json' },
    reproducible: true, hostSpecific: false, notes: 'Next, Expo, TypeScript, supabase-js, jest etc. travados pelo lockfile.',
  },
  // ---------- database ----------
  {
    tool: 'docker', versionConstraint: { type: 'minimum', version: '24.0.0' }, provenVersion: '29.8.0', pinType: 'minimum',
    installSource: 'Docker Desktop / Docker Engine', requiredFor: ['database'], optionalFor: ['self-development'], platform: ALL,
    validation: { kind: 'probe', commands: [['docker', '--version']], versionPattern: `Docker version ${SEMVER}` },
    reproducible: false, hostSpecific: false, notes: 'Só o cliente é sondado; o checker nunca inicia o daemon.',
  },
  {
    tool: 'supabase-cli', versionConstraint: { type: 'range', min: '2.105.0', maxExclusive: '3.0.0' }, provenVersion: '2.105.0', pinType: 'minimum',
    installSource: 'github.com/supabase/cli releases', requiredFor: ['database'], platform: ALL,
    validation: { kind: 'probe', commands: [['supabase', '--version']], versionPattern: SEMVER },
    reproducible: false, hostSpecific: false,
    notes: 'Versão da prova (Restore V0.1) = 2.105.0 ⇒ imagens postgres:15.8.1.085 + gotrue:v2.189.0. 2.x mais novo é permitido, mas exige nova prova de restore.',
  },
  // ---------- mobile ----------
  {
    tool: 'java', versionConstraint: { type: 'caret', version: '17.0.0' }, provenVersion: '17.0.20', pinType: 'major',
    installSource: 'JDK 17 (ex.: Microsoft Build of OpenJDK)', requiredFor: ['mobile'], platform: ALL,
    validation: { kind: 'probe', commands: [['java', '--version']], versionPattern: `(?:openjdk|java) ${SEMVER}` },
    reproducible: false, hostSpecific: false, notes: 'Build Android (Expo SDK 54 / RN 0.81).',
  },
  {
    tool: 'android-platform-tools', versionConstraint: { type: 'minimum', version: '35.0.0' }, provenVersion: '37.0.1', pinType: 'none',
    installSource: 'Android SDK Manager', requiredFor: ['mobile'], platform: ALL,
    validation: { kind: 'probe', commands: [['adb', '--version']], versionPattern: `Version ${SEMVER}` },
    reproducible: false, hostSpecific: true, notes: 'Pacotes do SDK (platforms/build-tools) ainda não manifestados; caminho do SDK é do host.',
  },
  {
    tool: 'android-sdk-packages', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'none',
    installSource: 'Android SDK Manager (platforms, build-tools, NDK conforme Expo)', requiredFor: ['mobile'], platform: ALL,
    validation: { kind: 'none', reason: 'pacotes do SDK não são sondados nem pinados' },
    reproducible: false, hostSpecific: true, notes: 'Gap: lista de pacotes Android não versionada.',
  },
  {
    tool: 'xcode', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'none',
    installSource: 'Mac App Store', requiredFor: ['mobile'], platform: ['macos'],
    validation: { kind: 'none', reason: 'iOS exige macOS/Xcode; não sondado' },
    reproducible: false, hostSpecific: true, notes: 'Só em macOS.',
  },
  {
    tool: 'tailscale', versionConstraint: { type: 'any' }, provenVersion: '1.102.2', pinType: 'none',
    installSource: 'tailscale.com', requiredFor: [], optionalFor: ['mobile'], platform: ALL,
    validation: { kind: 'none', reason: 'rede privada do operador; sem requisito formal' },
    reproducible: false, hostSpecific: true, notes: 'Opcional: alcance telefone → Goma. IP é do host e nunca vai para o repo.',
  },
  // ---------- local-ai ----------
  {
    tool: 'ollama', versionConstraint: { type: 'minimum', version: '0.30.0' }, provenVersion: '0.32.15', pinType: 'none',
    installSource: 'ollama.com', requiredFor: ['local-ai'], platform: ALL,
    validation: { kind: 'probe', commands: [['ollama', '--version']], versionPattern: `client version is ${SEMVER}|ollama version is ${SEMVER}` },
    reproducible: false, hostSpecific: false, notes: 'Sonda só a versão do cliente; o checker nunca inicia o servidor.',
  },
  {
    tool: 'model:qwen2.5:14b', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'none',
    installSource: 'ollama pull qwen2.5:14b', requiredFor: ['local-ai'], platform: ALL,
    validation: { kind: 'none', reason: 'modelos não são listados (exigiria o daemon)' },
    reproducible: false, hostSpecific: false, notes: 'REQUIRED NOW: default de chat/detecções Ollama. Tag sem digest registrado.',
  },
  {
    tool: 'model:nomic-embed-text', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'none',
    installSource: 'ollama pull nomic-embed-text', requiredFor: ['local-ai'], platform: ALL,
    validation: { kind: 'none', reason: 'modelos não são listados (exigiria o daemon)' },
    reproducible: false, hostSpecific: false, notes: 'REQUIRED NOW: embeddings default. Tag sem digest registrado.',
  },
  {
    tool: 'model:qwen3-coder:latest', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'mutable_tag',
    installSource: 'ollama pull qwen3-coder:latest', requiredFor: [], optionalFor: ['local-ai', 'self-development'], platform: ALL,
    validation: { kind: 'none', reason: 'tag mutável; sem digest imutável registrado' },
    reproducible: false, hostSpecific: false, notes: 'OPTIONAL (coder Ollama default). NON-REPRODUCIBLE até haver referência imutável.',
  },
  {
    tool: 'model:qwen2.5-coder:14b', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'none',
    installSource: 'ollama pull qwen2.5-coder:14b', requiredFor: [], optionalFor: ['self-development'], platform: ALL,
    validation: { kind: 'none', reason: 'modelos não são listados (exigiria o daemon)' },
    reproducible: false, hostSpecific: false, notes: 'OPTIONAL: fallback governado de coder (allowlist + VRAM).',
  },
  {
    tool: 'model:qwen3-coder:30b', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'none',
    installSource: 'ollama pull qwen3-coder:30b', requiredFor: [], optionalFor: ['self-development'], platform: ALL,
    validation: { kind: 'none', reason: 'modelos não são listados (exigiria o daemon)' },
    reproducible: false, hostSpecific: false, notes: 'HISTORICAL/OPTIONAL: runner local; excede 16 GB de RAM (barreira registrada).',
  },
  {
    tool: 'model:qwen2.5-coder:7b', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'none',
    installSource: 'ollama pull qwen2.5-coder:7b', requiredFor: [], optionalFor: [], platform: ALL,
    validation: { kind: 'none', reason: 'modelos não são listados (exigiria o daemon)' },
    reproducible: false, hostSpecific: false, notes: 'HISTORICAL: usado em provas de modelo antigas.',
  },
  // ---------- self-development ----------
  {
    tool: 'python', versionConstraint: { type: 'minimum', version: '3.11.0' }, provenVersion: '3.11.9', pinType: 'minimum',
    installSource: 'python.org (runner local; pyproject requires-python >=3.11)', requiredFor: [], optionalFor: ['self-development'], platform: ALL,
    validation: { kind: 'probe', commands: [['python', '--version'], ['python3', '--version'], ['py', '--version']], versionPattern: `Python ${SEMVER}` },
    reproducible: false, hostSpecific: false, notes: 'Runner sem dependências de runtime; dev deps (pytest/mypy) só com mínimo, sem lock.',
  },
  {
    tool: 'local-agent-image', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'mutable_tag',
    installSource: 'docker build tools/local-agent (FROM python:3.11-slim) → anima-local-agent-python:0.1', requiredFor: [], optionalFor: ['self-development'], platform: ALL,
    validation: { kind: 'none', reason: 'imagem não inspecionada pelo checker' },
    reproducible: false, hostSpecific: false, notes: 'Base python:3.11-slim é tag mutável; sem digest pinado (gap).',
  },
  // ---------- research-web ----------
  {
    tool: 'searxng', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'mutable_tag',
    installSource: 'docker.io/searxng/searxng:latest (docs/arquitetura/research-web-v1.md)', requiredFor: ['research-web'], platform: ALL,
    validation: { kind: 'none', reason: 'serviço não sondado; imagem :latest; settings.yml não versionado' },
    reproducible: false, hostSpecific: false, notes: 'Gap: tag latest + configuração (formats html/json, engines) fora do repo.',
  },
  {
    tool: 'agent-browser', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'none',
    installSource: 'npm i agent-browser (sem versão)', requiredFor: ['research-web'], platform: ALL,
    validation: { kind: 'none', reason: 'binário localizado por env; sem versão pinada' },
    reproducible: false, hostSpecific: true, notes: 'Gap: sem pin; caminho do binário é do host.',
  },
  {
    tool: 'chrome-for-testing', versionConstraint: { type: 'any' }, provenVersion: null, pinType: 'none',
    installSource: 'agent-browser install', requiredFor: ['research-web'], platform: ALL,
    validation: { kind: 'none', reason: 'browser não aberto nem sondado' },
    reproducible: false, hostSpecific: true, notes: 'Gap: versão decidida pelo agent-browser no momento da instalação.',
  },
  // ---------- runpod ----------
  {
    tool: 'openssh', versionConstraint: { type: 'minimum', version: '8.0.0' }, provenVersion: '10.3.0', pinType: 'minimum',
    installSource: 'OpenSSH do sistema', requiredFor: ['runpod'], platform: ALL,
    validation: { kind: 'probe', commands: [['ssh', '-V']], versionPattern: 'OpenSSH_(?:for_Windows_)?(\\d+\\.\\d+)' },
    reproducible: false, hostSpecific: false, notes: 'Túnel SSH host-side; chave dedicada é config (Recovery Configuration), não toolchain.',
  },
];

/** Arquivos de contrato que precisam ser neutros de host (sem drive/caminho pessoal/IP privado). */
export const HOST_NEUTRAL_CONTRACT_FILES = [
  'package.json',
  'apps/web/package.json',
  'apps/mobile/package.json',
  'apps/mobile/app.json',
  'apps/web/.env.example',
  'apps/mobile/.env.example',
  'supabase/config.toml',
  'tools/local-agent/pyproject.toml',
  'tools/local-agent/Dockerfile',
] as const;
