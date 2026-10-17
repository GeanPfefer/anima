/** @jest-environment node */
import { checkGrantorEnvironment, EXIT, runMandateCli, type MandateCliDeps } from './mandate-grantor-cli';

const ITEM = '11111111-1111-4111-8111-111111111111';
const MANDATE = '33333333-3333-4333-8333-333333333333';
const SHA = 'a'.repeat(64); const BASE = 'b'.repeat(40);
const SECRET = 'senha-secreta-do-grantor-teste';
const NOW = new Date('2026-10-17T12:00:00.000Z');

function setup(over: Partial<MandateCliDeps> = {}, rpcImpl?: jest.Mock) {
  const lines: string[] = [];
  const rpc = rpcImpl ?? jest.fn(async (name: string) => {
    if (name === 'preview_acceptance_contract') return { data: { workItemId: ITEM, state: 'approved', proposalVersion: 1, contractSha256: SHA, baseSha: BASE, includedScope: ['a.ts'], blockers: [], policyVersion: 'acceptance-mandate-v1' }, error: null };
    if (name === 'grant_acceptance_mandate') return { data: { action: 'granted', mandate_id: MANDATE, event_seq: 5 }, error: null };
    return { data: { action: 'revoked', mandate_id: MANDATE }, error: null };
  });
  const promptHidden = jest.fn(async () => SECRET);
  const signIn = jest.fn(async () => ({ accessToken: 'tok-secreto-de-sessao' }));
  const clientFor = jest.fn(() => ({ rpc }) as never);
  const deps: MandateCliDeps = { env: { ANIMA_MANDATE_GRANTOR_EMAIL: 'grantor@x.test', ANIMA_RESIDENT_EMAIL: 'res@x.test', ANIMA_SYSTEM_WRITER_EMAIL: 'writer@x.test' },
    promptHidden, signIn, clientFor, now: () => NOW, uuid: () => '44444444-4444-4444-8444-444444444444', write: (l) => lines.push(l), ...over };
  return { deps, lines, rpc, promptHidden, signIn, clientFor, out: () => lines.map(l => JSON.parse(l) as Record<string, unknown>) };
}
const grantArgs = ['grant', ITEM, '--version', '1', '--hash', SHA, '--base', BASE, '--scope', 'packages/core/src/a.ts', '--not-before', '2026-10-17T12:00:00.000Z', '--expires', '2026-10-18T11:00:00.000Z'];

describe('checkGrantorEnvironment', () => {
  test('aceita e-mail dedicado', () => { expect(checkGrantorEnvironment({ ANIMA_MANDATE_GRANTOR_EMAIL: 'g@x' })).toEqual({ ok: true, email: 'g@x' }); });
  test.each([
    ['senha no ambiente', { ANIMA_MANDATE_GRANTOR_EMAIL: 'g@x', ANIMA_MANDATE_GRANTOR_PASSWORD: 'x' }, 'grantor_secret_in_environment'],
    ['token no ambiente', { ANIMA_MANDATE_GRANTOR_EMAIL: 'g@x', ANIMA_MANDATE_GRANTOR_ACCESS_TOKEN: 'x' }, 'grantor_secret_in_environment'],
    ['credenciais do residente presentes (processo do runner)', { ANIMA_MANDATE_GRANTOR_EMAIL: 'g@x', ANIMA_RESIDENT_PASSWORD: 'x' }, 'runner_credentials_present_in_grantor_process'],
    ['credenciais do writer presentes', { ANIMA_MANDATE_GRANTOR_EMAIL: 'g@x', ANIMA_SYSTEM_WRITER_PASSWORD: 'x' }, 'runner_credentials_present_in_grantor_process'],
    ['sem e-mail', {}, 'grantor_email_missing'],
    ['e-mail igual ao do residente', { ANIMA_MANDATE_GRANTOR_EMAIL: 'RES@x.test', ANIMA_RESIDENT_EMAIL: 'res@x.test' }, 'grantor_must_be_dedicated_identity'],
    ['e-mail igual ao do writer', { ANIMA_MANDATE_GRANTOR_EMAIL: 'w@x.test', ANIMA_SYSTEM_WRITER_EMAIL: 'W@x.test' }, 'grantor_must_be_dedicated_identity'],
  ])('recusa %s', (_n, env, reason) => { expect(checkGrantorEnvironment(env)).toEqual({ ok: false, reason }); });
});

describe('runMandateCli', () => {
  test('preview: pede a senha OCULTA, entra como grantor e imprime o contrato (sem segredos)', async () => {
    const t = setup();
    await expect(runMandateCli(['preview', ITEM], t.deps)).resolves.toBe(EXIT.OK);
    expect(t.promptHidden).toHaveBeenCalledTimes(1);
    expect(t.signIn).toHaveBeenCalledWith({ email: 'grantor@x.test', password: SECRET });
    expect(t.out()[0]).toMatchObject({ ok: true, command: 'preview', eligible: true, preview: { contractSha256: SHA } });
    expect(t.lines.join('\n')).not.toContain(SECRET); expect(t.lines.join('\n')).not.toContain('tok-secreto');
  });
  test('grant: passa pelos mesmos controles do sink e imprime o id do mandato', async () => {
    const t = setup();
    await expect(runMandateCli(grantArgs, t.deps)).resolves.toBe(EXIT.OK);
    expect(t.rpc).toHaveBeenCalledWith('grant_acceptance_mandate', expect.objectContaining({ p_scope_files: ['packages/core/src/a.ts'], p_request_id: '44444444-4444-4444-8444-444444444444' }));
    expect(t.out()[0]).toMatchObject({ ok: true, command: 'grant', action: 'granted', mandateId: MANDATE });
    expect(t.lines.join('\n')).not.toContain(SECRET);
  });
  test('grant com hash que o humano não viu ⇒ recusa e NÃO concede', async () => {
    const t = setup();
    await expect(runMandateCli(grantArgs.map(a => a === SHA ? 'f'.repeat(64) : a), t.deps)).resolves.toBe(EXIT.REFUSED);
    expect(t.rpc).not.toHaveBeenCalledWith('grant_acceptance_mandate', expect.anything());
    expect(t.out()[0]).toMatchObject({ ok: false, stage: 'hash_mismatch' });
  });
  test('grant com escopo sensível ⇒ recusa ANTES de pedir senha ou autenticar', async () => {
    const t = setup();
    const args = grantArgs.map(a => a === 'packages/core/src/a.ts' ? 'supabase/migrations/1.sql' : a);
    await expect(runMandateCli(args, t.deps)).resolves.toBe(EXIT.REFUSED);
    expect(t.out()[0]).toMatchObject({ ok: false, stage: 'validation', defect: 'unsafe_scope_path' });
  });
  test('revoke: exige motivo; com motivo revoga', async () => {
    const t = setup();
    await expect(runMandateCli(['revoke', MANDATE], t.deps)).resolves.toBe(EXIT.USAGE);
    expect(t.promptHidden).not.toHaveBeenCalled();
    await expect(runMandateCli(['revoke', MANDATE, '--reason', 'mudei de ideia'], t.deps)).resolves.toBe(EXIT.OK);
    expect(t.rpc).toHaveBeenCalledWith('revoke_acceptance_mandate', { p_mandate_id: MANDATE, p_reason: 'mudei de ideia' });
  });
  test('uso inválido nunca pede senha', async () => {
    for (const argv of [[], ['preview'], ['preview', 'nao-uuid'], ['boom', ITEM], ['grant', ITEM, '--version', 'x']]) {
      const t = setup(); await expect(runMandateCli(argv, t.deps)).resolves.toBe(EXIT.USAGE); expect(t.promptHidden).not.toHaveBeenCalled();
    }
  });
  test('ambiente inválido (senha no ambiente) recusa antes de qualquer prompt', async () => {
    const t = setup({ env: { ANIMA_MANDATE_GRANTOR_EMAIL: 'g@x', ANIMA_MANDATE_GRANTOR_PASSWORD: SECRET } });
    await expect(runMandateCli(['preview', ITEM], t.deps)).resolves.toBe(EXIT.REFUSED);
    expect(t.promptHidden).not.toHaveBeenCalled(); expect(t.signIn).not.toHaveBeenCalled();
    expect(t.lines.join('\n')).not.toContain(SECRET);
  });
  test('senha vazia e falha de login', async () => {
    await expect(runMandateCli(['preview', ITEM], setup({ promptHidden: async () => '' }).deps)).resolves.toBe(EXIT.REFUSED);
    const t = setup({ signIn: async () => null });
    await expect(runMandateCli(['preview', ITEM], t.deps)).resolves.toBe(EXIT.FAILED);
    expect(t.out()[0]).toMatchObject({ ok: false, error: 'grantor_sign_in_failed' });
  });
  test('o runner (sessão comum) é recusado pelo banco: erro do RPC vira falha tipada, sem segredo', async () => {
    const t = setup({}, jest.fn(async () => ({ data: null, error: { message: 'mandate grantor required' } })));
    await expect(runMandateCli(['preview', ITEM], t.deps)).resolves.toBe(EXIT.FAILED);
    expect(t.out()[0]).toMatchObject({ ok: false, error: 'preview_failed', message: 'mandate grantor required' });
    expect(t.lines.join('\n')).not.toContain(SECRET);
  });
  test('preview com bloqueios sai com REFUSED', async () => {
    const t = setup({}, jest.fn(async () => ({ data: { workItemId: ITEM, state: 'proposed', proposalVersion: 1, contractSha256: SHA, baseSha: null, includedScope: [], blockers: ['item_not_approved'], policyVersion: 'acceptance-mandate-v1' }, error: null })));
    await expect(runMandateCli(['preview', ITEM], t.deps)).resolves.toBe(EXIT.REFUSED);
    expect(t.out()[0]).toMatchObject({ eligible: false });
  });
});
