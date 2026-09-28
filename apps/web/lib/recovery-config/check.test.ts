/**
 * @jest-environment node
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from '@/cli/args';
import { checkRecoveryConfig, renderRecoveryConfigReport, type RecoveryConfigEnv, type RecoveryConfigReport } from './check';
import { READINESS_GROUP_SPECS, RECOVERY_CONFIG_MANIFEST } from './manifest';
import { parseDotEnv } from './node-env';

const CORE: RecoveryConfigEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-key',
};
const RESIDENT_UUID = '11111111-2222-4333-8444-555555555555';

const run = (web: RecoveryConfigEnv, mobile: RecoveryConfigEnv | null = null, existing: readonly string[] = []): RecoveryConfigReport =>
  checkRecoveryConfig({ web, mobile, pathExists: path => existing.includes(path) });
const group = (report: RecoveryConfigReport, name: string) => report.groups.find(g => g.group === name)!;
const item = (report: RecoveryConfigReport, key: string) => report.items.find(i => i.key === key)!;

describe('Recovery Configuration V0 — checker', () => {
  it('core mínimo fica READY sem nenhuma capacidade opcional', () => {
    const report = run(CORE);
    expect(report.core).toBe('READY');
    expect(group(report, 'core').state).toBe('ready');
    expect(group(report, 'research-web').state).toBe('not_ready');
    expect(group(report, 'runpod').state).toBe('disabled');
    expect(item(report, 'ANIMA_PROJECT_ROOT').status).toBe('derived');
  });

  it('core NOT READY quando falta a URL do Supabase', () => {
    const report = run({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' });
    expect(report.core).toBe('NOT_READY');
    expect(group(report, 'core').blocking).toEqual(['NEXT_PUBLIC_SUPABASE_URL']);
  });

  it('secret ausente bloqueia só a capacidade que o exige', () => {
    const report = run({ ...CORE, ANIMA_RESIDENT_EMAIL: 'resident@example.test' });
    expect(item(report, 'ANIMA_RESIDENT_PASSWORD').status).toBe('missing');
    expect(group(report, 'resident').blocking).toEqual(['ANIMA_RESIDENT_PASSWORD']);
    expect(report.core).toBe('READY');
  });

  it('capacidade opcional ausente (Research Web) não bloqueia o core', () => {
    const report = run(CORE);
    expect(group(report, 'research-web').blocking).toEqual(['ANIMA_RESEARCH_SEARXNG_URL', 'ANIMA_RESEARCH_AGENT_BROWSER_BIN']);
    expect(report.core).toBe('READY');
    const ready = run({ ...CORE, ANIMA_RESEARCH_SEARXNG_URL: 'http://127.0.0.1:8888', ANIMA_RESEARCH_AGENT_BROWSER_BIN: '/opt/agent-browser' }, null, ['/opt/agent-browser']);
    expect(group(ready, 'research-web').state).toBe('ready');
  });

  it('provider OpenAI (default) exige OPENAI_API_KEY', () => {
    const report = run(CORE);
    expect(report.primaryChatGroup).toBe('chat-openai');
    expect(item(report, 'OPENAI_API_KEY').status).toBe('missing');
    expect(group(report, 'chat-openai').blocking).toEqual(['OPENAI_API_KEY']);
    expect(report.core).toBe('READY');
  });

  it('provider Ollama não exige OpenAI', () => {
    const report = run({ ...CORE, ANIMA_AI_PROVIDER: 'ollama' });
    expect(report.primaryChatGroup).toBe('local-ai');
    expect(group(report, 'chat-openai').state).toBe('disabled');
    expect(item(report, 'OPENAI_API_KEY').status).toBe('not_required');
    expect(group(report, 'local-ai').state).toBe('ready');
    expect(report.core).toBe('READY');
  });

  it('coder OpenAI reabilita a exigência da chave para self-development', () => {
    const report = run({ ...CORE, ANIMA_AI_PROVIDER: 'ollama', ANIMA_CODER_PROVIDER: 'openai' });
    expect(item(report, 'OPENAI_API_KEY').requiredBy).toEqual(['chat-openai', 'self-development']);
    expect(group(report, 'self-development').blocking).toContain('OPENAI_API_KEY');
  });

  it('RunPod desligado não exige secrets de RunPod/SSH; ligado, exige', () => {
    const off = run(CORE);
    expect(group(off, 'runpod').state).toBe('disabled');
    for (const key of ['ANIMA_RUNPOD_API_KEY', 'ANIMA_RUNPOD_SSH_PRIVATE_KEY']) expect(item(off, key).status).toBe('not_required');

    const on = run({ ...CORE, ANIMA_ON_DEMAND_NODE_ENABLED: 'TRUE' });
    expect(group(on, 'runpod').state).toBe('not_ready');
    expect(group(on, 'runpod').blocking).toEqual(expect.arrayContaining(['ANIMA_RUNPOD_API_KEY', 'ANIMA_RUNPOD_SSH_PRIVATE_KEY', 'ANIMA_ON_DEMAND_NODE_PROVISIONER']));
    expect(on.core).toBe('READY');
  });

  it('host path placeholder, relativo ou inexistente é invalid e só quebra a capacidade', () => {
    expect(item(run({ ...CORE, ANIMA_PROJECT_ROOT: '<ABSOLUTE_PATH_TO_ANIMA_REPO>' }), 'ANIMA_PROJECT_ROOT').issue).toBe('placeholder');
    expect(item(run({ ...CORE, ANIMA_PROJECT_ROOT: 'relative/anima' }), 'ANIMA_PROJECT_ROOT').issue).toBe('not_absolute_path');
    const missing = run({ ...CORE, ANIMA_PROJECT_ROOT: 'D:\\nowhere\\anima' });
    expect(item(missing, 'ANIMA_PROJECT_ROOT')).toMatchObject({ status: 'invalid', issue: 'path_not_found' });
    expect(group(missing, 'self-development').blocking).toContain('ANIMA_PROJECT_ROOT');
    expect(missing.core).toBe('READY');
    expect(item(run({ ...CORE, ANIMA_PROJECT_ROOT: 'D:\\anima' }, null, ['D:\\anima']), 'ANIMA_PROJECT_ROOT').status).toBe('present');
  });

  it('placeholder copiado do .env.example é recusado no core', () => {
    const report = run({ ...CORE, NEXT_PUBLIC_SUPABASE_ANON_KEY: '<ANON_KEY_FROM_SUPABASE_STATUS>' });
    expect(report.core).toBe('NOT_READY');
    expect(item(report, 'NEXT_PUBLIC_SUPABASE_ANON_KEY').issue).toBe('placeholder');
  });

  it('deprecated presente não bloqueia nada e aponta o substituto', () => {
    const report = run({ ...CORE, WHISPER_URL: 'http://x:9000', ANIMA_COMPUTE_ROUTER_V1: '1', SUPABASE_SERVICE_ROLE_KEY: 'x', ANIMA_WORKTREE_CODER_BACKEND: 'bogus' });
    expect(report.deprecatedPresent).toEqual(expect.arrayContaining(['WHISPER_URL', 'ANIMA_COMPUTE_ROUTER_V1', 'SUPABASE_SERVICE_ROLE_KEY', 'ANIMA_WORKTREE_CODER_BACKEND']));
    expect(item(report, 'ANIMA_COMPUTE_ROUTER_V1').replacedBy).toBe('ANIMA_COMPUTE_ROUTER_V1_ENABLED');
    for (const g of report.groups) for (const key of report.deprecatedPresent) expect(g.blocking).not.toContain(key);
    expect(report.core).toBe('READY');
  });

  it('dev chat user ids exigem UUIDs válidos', () => {
    expect(item(run({ ...CORE, ANIMA_DEVELOPMENT_CHAT_USER_IDS: `${RESIDENT_UUID}, ${RESIDENT_UUID}` }), 'ANIMA_DEVELOPMENT_CHAT_USER_IDS').status).toBe('present');
    expect(item(run({ ...CORE, ANIMA_DEVELOPMENT_CHAT_USER_IDS: 'user-1' }), 'ANIMA_DEVELOPMENT_CHAT_USER_IDS').issue).toBe('not_uuid_list');
  });

  it('mobile sem arquivo de ambiente fica not_ready com motivo fixo; com arquivo, ready', () => {
    const report = run(CORE, null);
    expect(group(report, 'mobile').state).toBe('not_ready');
    expect(item(report, 'EXPO_PUBLIC_SUPABASE_URL').issue).toBe('env_file_missing');
    const ok = run(CORE, { EXPO_PUBLIC_SUPABASE_URL: 'http://host.test:54321', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon', EXPO_PUBLIC_ANIMA_WEB_URL: 'http://host.test:3000' });
    expect(group(ok, 'mobile').state).toBe('ready');
  });

  it('chaves desconhecidas aparecem só pelo nome e só com prefixo do Anima', () => {
    const report = run({ ...CORE, ANIMA_SOMETHING_NEW: 'v', PATH: '/usr/bin', HOME: '/home/x' });
    expect(report.unknownKeys).toEqual(['ANIMA_SOMETHING_NEW']);
  });
});

describe('Recovery Configuration V0 — redaction', () => {
  // Valores-sentinela de comprimento incomum: nenhum pedaço, comprimento ou hash pode vazar.
  const secret = (tag: string): string => `S3NT1NEL-${tag}-${'q'.repeat(1997)}-END`;
  const env: RecoveryConfigEnv = {
    ...CORE,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: secret('anon'),
    ANIMA_RESIDENT_EMAIL: `${secret('mail')}@example.test`,
    ANIMA_RESIDENT_PASSWORD: secret('pass'),
    OPENAI_API_KEY: secret('openai'),
    ANIMA_RUNPOD_API_KEY: secret('runpod'),
    ANIMA_RUNPOD_SSH_PRIVATE_KEY: secret('ssh'),
    ANIMA_INTEGRATION_GITHUB_TOKEN: secret('gh'),
    SUPABASE_SERVICE_ROLE_KEY: secret('svc'),
    ANIMA_ON_DEMAND_NODE_ENABLED: 'true',
    ANIMA_DEVELOPMENT_CHAT_USER_IDS: secret('ids'),
    ANIMA_PROJECT_ROOT: secret('path'),
  };

  it('nem JSON nem render contêm valor, prefixo, sufixo, comprimento ou hash', () => {
    const report = run(env, { EXPO_PUBLIC_SUPABASE_ANON_KEY: secret('mobile') });
    const outputs = [JSON.stringify(report), renderRecoveryConfigReport(report)];
    const values = [...Object.values(env), secret('mobile')].filter((v): v is string => typeof v === 'string' && v.includes('S3NT1NEL'));
    for (const out of outputs) {
      expect(out).not.toContain('S3NT1NEL');
      expect(out).not.toContain('qqqqqqqq');
      expect(out).not.toContain('-END');
      for (const value of values) {
        expect(out).not.toContain(value);
        expect(out).not.toContain(String(value.length));
        expect(out).not.toContain(createHash('sha256').update(value).digest('hex').slice(0, 12));
      }
    }
  });

  it('valor inválido também não é ecoado (só o código do motivo)', () => {
    const report = run({ ...CORE, ANIMA_RESIDENT_EMAIL: secret('not-an-email') });
    expect(item(report, 'ANIMA_RESIDENT_EMAIL')).toMatchObject({ status: 'invalid', issue: 'not_email' });
    expect(JSON.stringify(report)).not.toContain('S3NT1NEL');
  });
});

describe('Recovery Configuration V0 — manifesto e .env.example', () => {
  const exampleText = readFileSync(resolve(__dirname, '..', '..', '.env.example'), 'utf8');
  const exampleKeys = [...exampleText.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1]!);
  const activeExampleKeys = Object.keys(parseDotEnv(exampleText));
  const byKey = new Map(RECOVERY_CONFIG_MANIFEST.map(entry => [entry.key, entry]));

  it('chaves do manifesto são únicas e grupos existem', () => {
    expect(byKey.size).toBe(RECOVERY_CONFIG_MANIFEST.length);
    const groups = new Set(READINESS_GROUP_SPECS.map(s => s.group));
    for (const entry of RECOVERY_CONFIG_MANIFEST) for (const req of entry.requiredFor) expect(groups.has(req.group)).toBe(true);
  });

  it('core não exige capacidade opcional nem segredo', () => {
    const coreKeys = RECOVERY_CONFIG_MANIFEST.filter(e => e.requiredFor.some(r => r.group === 'core'));
    expect(coreKeys.map(e => e.key).sort()).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL']);
    for (const entry of coreKeys) expect(entry.secret).toBe(false);
  });

  it('segredos são classificados como secret_required (ou deprecated)', () => {
    for (const entry of RECOVERY_CONFIG_MANIFEST.filter(e => e.secret)) {
      expect(entry.classes.includes('secret_required') || entry.classes.includes('deprecated')).toBe(true);
    }
  });

  it('.env.example só cita chaves conhecidas, nunca deprecated/prova', () => {
    for (const key of exampleKeys) {
      const entry = byKey.get(key);
      expect(entry).toBeDefined();
      expect(entry!.classes).not.toContain('deprecated');
      expect(entry!.proofOnly).not.toBe(true);
    }
  });

  it('.env.example cobre toda chave web exigida por algum grupo', () => {
    const required = RECOVERY_CONFIG_MANIFEST.filter(e => e.envFile === 'web' && e.requiredFor.length > 0).map(e => e.key);
    for (const key of required) expect(exampleKeys).toContain(key);
  });

  it('.env.example não carrega segredo nem valor host-specific real', () => {
    const active = parseDotEnv(exampleText);
    for (const key of activeExampleKeys) if (byKey.get(key)?.secret) expect(active[key]).toBe('');
    expect(exampleText).not.toMatch(/[A-Z]:\\\\?[A-Za-z]/);
    expect(exampleText).not.toMatch(/\b100\.\d+\.\d+\.\d+\b/);
    expect(exampleText).not.toMatch(/\/(home|Users)\/[a-z]/i);
    expect(exampleText).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});

describe('CLI — recovery-config check', () => {
  it('parse do comando e das recusas', () => {
    expect(parseArgs(['recovery-config', 'check'])).toEqual({ ok: true, command: { kind: 'recovery-config-check', json: false } });
    expect(parseArgs(['recovery-config', 'check', '--json'])).toEqual({ ok: true, command: { kind: 'recovery-config-check', json: true } });
    expect(parseArgs(['recovery-config']).ok).toBe(false);
    expect(parseArgs(['recovery-config', 'check', 'extra']).ok).toBe(false);
  });
});
