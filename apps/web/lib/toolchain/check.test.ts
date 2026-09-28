/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from '@/cli/args';
import { checkToolchain, compareVersions, extractVersion, renderToolchainReport, satisfies, scanHostSpecific, type ToolchainReport } from './check';
import { HOST_NEUTRAL_CONTRACT_FILES, TOOLCHAIN_GROUP_SPECS, TOOLCHAIN_MANIFEST, type Platform } from './manifest';
import { currentPlatform } from './node-probe';

// Saídas reais observadas na Goma (formato), usadas como fixture.
const GOMA: Record<string, string> = {
  'node --version': 'v24.16.0\n',
  'npm --version': '11.13.0\n',
  'git --version': 'git version 2.54.0.windows.1\n',
  'docker --version': 'Docker version 29.8.0, build 88096ef\n',
  'supabase --version': '2.105.0\n',
  'python --version': 'Python 3.11.9\n',
  'ollama --version': 'Warning: could not connect to a running Ollama instance\nWarning: client version is 0.32.15\n',
  'java --version': 'openjdk 17.0.20.1 2026-08-18 LTS\n',
  'adb --version': 'Android Debug Bridge version 1.0.41\nVersion 37.0.1-15733141\n',
  'ssh -V': 'OpenSSH_10.3p1, OpenSSL 3.5.6 7 Apr 2026\n',
};

const run = (outputs: Record<string, string | null>, platform: Platform = 'windows', files: Record<string, string> = {}): ToolchainReport =>
  checkToolchain({
    platform,
    probe: command => outputs[command.join(' ')] ?? null,
    repoFileExists: path => path === 'package-lock.json',
    readRepoFile: path => files[path] ?? null,
  });
const group = (r: ToolchainReport, name: string) => r.groups.find(g => g.group === name)!;
const item = (r: ToolchainReport, tool: string) => r.items.find(i => i.tool === tool)!;

describe('Toolchain V0 — versões', () => {
  it('extrai e normaliza versões dos formatos reais', () => {
    expect(extractVersion(GOMA['git --version']!, 'git version (\\d+\\.\\d+\\.\\d+)')).toBe('2.54.0');
    expect(extractVersion(GOMA['ssh -V']!, 'OpenSSH_(?:for_Windows_)?(\\d+\\.\\d+)')).toBe('10.3.0');
    expect(extractVersion('Python não foi encontrado', 'Python (\\d+\\.\\d+\\.\\d+)')).toBeNull();
  });
  it('compara e aplica restrições', () => {
    expect(compareVersions('24.16.0', '24.9.9')).toBe(1);
    expect(satisfies('24.17.1', { type: 'caret', version: '24.16.0' })).toBe(true);
    expect(satisfies('25.0.0', { type: 'caret', version: '24.16.0' })).toBe(false);
    expect(satisfies('2.118.0', { type: 'range', min: '2.105.0', maxExclusive: '3.0.0' })).toBe(true);
    expect(satisfies('3.0.0', { type: 'range', min: '2.105.0', maxExclusive: '3.0.0' })).toBe(false);
  });
});

describe('Toolchain V0 — checker', () => {
  it('core READY com as versões observadas; database/runpod/mobile prontos', () => {
    const r = run(GOMA);
    expect(r.core).toBe('READY');
    for (const g of ['core', 'web', 'database', 'runpod']) expect(group(r, g).state).toBe('ready');
    expect(item(r, 'node')).toMatchObject({ status: 'present', version: '24.16.0', matchesProven: true });
    expect(item(r, 'npm-dependencies').status).toBe('present');
  });

  it('versão errada ⇒ version_mismatch e core NOT READY', () => {
    const r = run({ ...GOMA, 'node --version': 'v22.11.0\n' });
    expect(item(r, 'node')).toMatchObject({ status: 'version_mismatch', version: '22.11.0' });
    expect(r.core).toBe('NOT_READY');
    expect(group(r, 'core').blocking).toEqual([{ tool: 'node', status: 'version_mismatch' }]);
  });

  it('Supabase CLI mais novo é permitido mas sinaliza divergência da prova', () => {
    const r = run({ ...GOMA, 'supabase --version': '2.118.0\n' });
    expect(item(r, 'supabase-cli')).toMatchObject({ status: 'present', matchesProven: false, provenVersion: '2.105.0' });
    expect(renderToolchainReport(r)).toContain('(prova: 2.105.0)');
  });

  it('ferramenta ausente ⇒ missing e bloqueia só o grupo que a exige', () => {
    const r = run({ ...GOMA, 'docker --version': null });
    expect(item(r, 'docker').status).toBe('missing');
    expect(group(r, 'database').state).toBe('not_ready');
    expect(r.core).toBe('READY');
  });

  it('python tenta candidatos em ordem (python3 stub do Windows não conta)', () => {
    const r = run({ ...GOMA, 'python --version': null, 'python3 --version': 'Python não foi encontrado; executar sem argumentos', 'py --version': 'Python 3.11.9' });
    expect(item(r, 'python')).toMatchObject({ status: 'present', version: '3.11.9' });
  });

  it('capacidade opcional ausente (Research Web) é NOT READY com razões e não quebra o core', () => {
    const r = run(GOMA);
    const rw = group(r, 'research-web');
    expect(rw.state).toBe('not_ready');
    expect(rw.blocking).toEqual(expect.arrayContaining([{ tool: 'agent-browser', status: 'unverified' }, { tool: 'chrome-for-testing', status: 'unverified' }]));
    expect(item(r, 'searxng')).toMatchObject({ status: 'non_reproducible', reason: 'mutable_tag' });
    expect(r.core).toBe('READY');
  });

  it('tag mutável ⇒ non_reproducible (qwen3-coder:latest, imagem do runner)', () => {
    const r = run(GOMA);
    expect(item(r, 'model:qwen3-coder:latest')).toMatchObject({ status: 'non_reproducible', pinType: 'mutable_tag', reproducible: false });
    expect(item(r, 'local-agent-image').status).toBe('non_reproducible');
    expect(item(r, 'model:qwen2.5:14b').status).toBe('unverified');
  });

  it('distingue plataforma: Xcode só em macOS', () => {
    expect(item(run(GOMA, 'windows'), 'xcode').status).toBe('not_required');
    expect(item(run(GOMA, 'linux'), 'xcode').status).toBe('not_required');
    expect(item(run(GOMA, 'macos'), 'xcode').status).toBe('unverified');
    expect(group(run(GOMA, 'macos'), 'mobile').blocking).toContainEqual({ tool: 'xcode', status: 'unverified' });
    expect(currentPlatform('win32')).toBe('windows');
    expect(currentPlatform('linux')).toBe('linux');
    expect(currentPlatform('darwin')).toBe('macos');
  });

  it('lockfile ausente quebra o core', () => {
    const r = checkToolchain({ platform: 'linux', probe: c => GOMA[c.join(' ')] ?? null, repoFileExists: () => false, readRepoFile: () => null });
    expect(item(r, 'npm-dependencies').status).toBe('missing');
    expect(r.core).toBe('NOT_READY');
  });

  it('saída não expõe saída bruta, caminhos, env nem valor de hard-code', () => {
    const secretPath = 'C:\\Users\\someone\\secret\\bin';
    const r = run(
      { ...GOMA, 'java --version': `openjdk 17.0.20.1 2026-08-18 LTS\nJAVA_HOME=${secretPath}\nOPENAI_API_KEY=sk-leak-123` },
      'windows',
      { 'apps/web/.env.example': `ANIMA_PROJECT_ROOT=G:\\anima\nOLLAMA_URL=http://100.68.239.78:11434\nX=/home/someone/x`, 'package.json': '{"deps":{"a":"^10.1.0"}}' },
    );
    const out = JSON.stringify(r) + renderToolchainReport(r);
    for (const leak of [secretPath, 'someone', 'sk-leak', 'JAVA_HOME', 'G:\\anima', '100.68.239.78', 'Warning: could not connect', '2026-08-18']) expect(out).not.toContain(leak);
    expect(r.hostSpecificFindings).toEqual([
      { file: 'apps/web/.env.example', kind: 'windows_drive_path', count: 1 },
      { file: 'apps/web/.env.example', kind: 'personal_home_path', count: 1 },
      { file: 'apps/web/.env.example', kind: 'private_network_ip', count: 1 },
    ]);
  });
});

describe('Toolchain V0 — manifesto e contratos versionados', () => {
  const root = resolve(__dirname, '..', '..', '..', '..');

  it('ferramentas únicas; core não exige mobile/research-web/runpod', () => {
    expect(new Set(TOOLCHAIN_MANIFEST.map(e => e.tool)).size).toBe(TOOLCHAIN_MANIFEST.length);
    const core = TOOLCHAIN_MANIFEST.filter(e => e.requiredFor.includes('core')).map(e => e.tool).sort();
    expect(core).toEqual(['git', 'node', 'npm', 'npm-dependencies']);
    const groups = new Set(TOOLCHAIN_GROUP_SPECS.map(s => s.group));
    for (const e of TOOLCHAIN_MANIFEST) for (const g of [...e.requiredFor, ...(e.optionalFor ?? [])]) expect(groups.has(g)).toBe(true);
  });

  it('tag mutável nunca é marcada reprodutível; pin exato/lockfile coerentes', () => {
    for (const e of TOOLCHAIN_MANIFEST) if (e.pinType === 'mutable_tag' || e.pinType === 'none') expect(e.reproducible).toBe(false);
  });

  it('package.json declara engines e packageManager coerentes com o manifesto', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { engines?: Record<string, string>; packageManager?: string };
    expect(pkg.engines?.node).toBe('^24.16.0');
    expect(pkg.engines?.npm).toBe('>=11.13.0');
    expect(pkg.packageManager).toBe('npm@11.13.0');
  });

  it('arquivos de contrato versionados são neutros de host', () => {
    const findings = scanHostSpecific(HOST_NEUTRAL_CONTRACT_FILES, path => {
      try { return readFileSync(resolve(root, path), 'utf8'); } catch { return null; }
    });
    expect(findings).toEqual([]);
  });
});

describe('CLI — toolchain check', () => {
  it('parse do comando e recusas', () => {
    expect(parseArgs(['toolchain', 'check', '--json'])).toEqual({ ok: true, command: { kind: 'toolchain-check', json: true } });
    expect(parseArgs(['toolchain']).ok).toBe(false);
    expect(parseArgs(['toolchain', 'check', 'x']).ok).toBe(false);
  });
});
