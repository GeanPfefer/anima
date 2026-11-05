import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyWorkFocusIntent, type WorkFocusIntent } from '@anima/core';
import { handleWorkFocusIntent } from './work-focus-chat';
import { clearWorkFocus, isClearWorkFocusEnabled } from '@/lib/work-orchestration/work-focus';
import type { UserClient } from './project-read-model';

type Row = Record<string, unknown>;
const U1 = '11111111-1111-4111-8111-111111111111';
const ITEM_A = 'fad07a1f-c03b-4211-a42c-c353a1572694';
const ITEM_B = 'fad07a1f-0000-4211-a42c-c353a1572694'; // mesmo prefixo de 8 caracteres de ITEM_A
const ITEM_C = '56a74a19-c524-46c4-b18e-363113df7da7';

interface Log { rpcs: Array<{ name: string; args?: unknown }>; writes: string[]; reads: string[] }

function fake(tables: Record<string, Row[]>, opts: { fail?: readonly string[]; rpcError?: boolean; clearReturns?: boolean } = {}): { client: UserClient; log: Log } {
  const log: Log = { rpcs: [], writes: [], reads: [] };
  const from = (table: string) => {
    log.reads.push(table);
    let rows = (tables[table] ?? []).filter(r => r.user_id === undefined || r.user_id === U1);
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { rows = rows.filter(r => r[c] === v); return b; };
    b.in = (c: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[c])); return b; };
    b.order = () => b;
    b.limit = (n: number) => { rows = rows.slice(0, n); return b; };
    const failing = opts.fail?.includes(table);
    b.maybeSingle = () => Promise.resolve(failing ? { data: null, error: { message: 'x' } } : { data: rows[0] ?? null, error: null });
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(failing ? { data: null, error: { message: 'x' } } : { data: rows, error: null }).then(res);
    for (const m of ['insert', 'update', 'delete', 'upsert']) b[m] = () => { log.writes.push(`${table}.${m}`); throw new Error('escrita proibida'); };
    return b;
  };
  const rpc = (name: string, args?: unknown) => {
    log.rpcs.push({ name, args });
    if (opts.rpcError) return Promise.resolve({ data: null, error: { code: '42501' } });
    return Promise.resolve({ data: name === 'clear_work_focus' ? (opts.clearReturns ?? true) : { id: 'x' }, error: null });
  };
  return { client: { from, rpc } as unknown as UserClient, log };
}

const items = (): Row[] => [
  { id: ITEM_A, user_id: U1, state: 'proposed', capability: 'programming', proposal_version: 1, updated_at: '2026-10-14T10:00:00Z', proposal: { data: { summary: 'Durability D1 (sucessor)' } }, original_request: 'x' },
  { id: ITEM_B, user_id: U1, state: 'approved', capability: 'programming', proposal_version: 1, updated_at: '2026-10-13T10:00:00Z', proposal: {}, original_request: 'outro' },
  { id: ITEM_C, user_id: U1, state: 'review', capability: 'programming', proposal_version: 1, updated_at: '2026-10-12T10:00:00Z', proposal: { data: { summary: 'Revisar backlog' } }, original_request: 'y' },
];
const intent = (m: string) => classifyWorkFocusIntent(m) as Exclude<WorkFocusIntent, { kind: 'none' }>;
const run = (m: string, client: UserClient, developmentMode: boolean, env: Record<string, string | undefined> = {}) =>
  handleWorkFocusIntent({ client, userId: U1, intent: intent(m), developmentMode, env });

describe('consulta de foco é somente leitura', () => {
  test('"Qual trabalho está em foco?" sem foco: informa, não oferece seletor, não escreve', async () => {
    const { client, log } = fake({ work_focus: [], work_items: items() });
    const out = await run('Qual trabalho está em foco?', client, true);
    expect(out).toMatchObject({ mutation: 'none' });
    expect(out.text).toMatch(/Nenhum trabalho está em foco/);
    expect(out.text).toMatch(/não alterou nada/);
    expect(out.focusChangedTo).toBeUndefined();
    expect(log.rpcs).toEqual([]);
    expect(log.writes).toEqual([]);
    expect(log.reads).not.toContain('work_contexts');
  });

  test('com foco: descreve o trabalho sem alterar nada, também no chat pessoal', async () => {
    const { client, log } = fake({ work_focus: [{ user_id: U1, work_item_id: ITEM_A }], work_items: items() });
    for (const dev of [true, false]) {
      const out = await run('Qual trabalho está em foco?', client, dev);
      expect(out.text).toContain('[obra:fad07a1f]');
      expect(out.text).toContain('Durability D1 (sucessor)');
      expect(out.text).toContain('estado: proposed');
      expect(out.mutation).toBe('none');
    }
    expect(log.rpcs).toEqual([]);
    expect(log.writes).toEqual([]);
  });

  test('falha de consulta: informa a falha e não confunde com "sem foco"', async () => {
    const { client } = fake({ work_focus: [], work_items: items() }, { fail: ['work_focus'] });
    const out = await run('Qual trabalho está em foco?', client, true);
    expect(out.text).toMatch(/falha na consulta/);
    expect(out.text).not.toMatch(/Nenhum trabalho está em foco/);
  });
});

describe('definição explícita de foco', () => {
  test('"Use X como foco" chama somente set_work_focus; não anexa contexto nem escreve', async () => {
    const { client, log } = fake({ work_focus: [], work_items: items() });
    const out = await run('Use 56a74a19 como foco do trabalho', client, true);
    expect(out).toMatchObject({ mutation: 'focus-set', focusChangedTo: ITEM_C });
    expect(out.text).toMatch(/nenhuma mensagem foi anexada/);
    expect(log.rpcs).toEqual([{ name: 'set_work_focus', args: { work_item_id: ITEM_C } }]);
    expect(log.writes).toEqual([]);
    expect(log.reads).not.toContain('work_contexts');
  });

  test.each([
    ['referência ambígua', 'use fad07a1f como foco do trabalho', /ambígua/],
    ['referência inexistente', 'use deadbeef como foco do trabalho', /Não encontrei/],
    ['sem referência', 'troque o foco do trabalho', /Informe qual trabalho/],
  ])('%s: não escreve', async (_n, message, pattern) => {
    const { client, log } = fake({ work_focus: [], work_items: items() });
    const out = await run(message, client, true);
    expect(out.text).toMatch(pattern);
    expect(out.mutation).toBe('none');
    expect(log.rpcs).toEqual([]);
  });

  test('no chat pessoal nunca altera o foco', async () => {
    const { client, log } = fake({ work_focus: [], work_items: items() });
    const out = await run('Use 56a74a19 como foco do trabalho', client, false);
    expect(out.mutation).toBe('none');
    expect(out.text).toMatch(/Usar como foco/);
    expect(log.rpcs).toEqual([]);
  });

  test('falha da RPC não declara sucesso', async () => {
    const { client } = fake({ work_focus: [], work_items: items() }, { rpcError: true });
    const out = await run('Use 56a74a19 como foco do trabalho', client, true);
    expect(out.mutation).toBe('none');
    expect(out.text).toMatch(/Nada foi alterado/);
  });
});

describe('limpeza explícita de foco', () => {
  test('sem a flag (migration não implantada): informa e não chama a RPC', async () => {
    const { client, log } = fake({ work_focus: [], work_items: items() });
    const out = await run('Limpe o foco do trabalho', client, true, {});
    expect(out.mutation).toBe('none');
    expect(out.text).toMatch(/ainda não está disponível/);
    expect(log.rpcs).toEqual([]);
  });

  test('com a flag: chama clear_work_focus e reporta; idempotente quando já estava limpo', async () => {
    const env = { ANIMA_CLEAR_WORK_FOCUS_ENABLED: '1' };
    const a = fake({ work_focus: [], work_items: items() }, { clearReturns: true });
    const done = await run('Limpe o foco do trabalho', a.client, true, env);
    expect(done).toMatchObject({ mutation: 'focus-clear', focusChangedTo: '' });
    expect(a.log.rpcs).toEqual([{ name: 'clear_work_focus', args: undefined }]);
    const b = fake({ work_focus: [], work_items: items() }, { clearReturns: false });
    const again = await run('Limpe o foco do trabalho', b.client, true, env);
    expect(again.mutation).toBe('none');
    expect(again.text).toMatch(/Não havia trabalho em foco/);
  });

  test('chat pessoal nunca limpa', async () => {
    const { client, log } = fake({ work_focus: [], work_items: items() });
    const out = await run('Limpe o foco do trabalho', client, false, { ANIMA_CLEAR_WORK_FOCUS_ENABLED: '1' });
    expect(out.mutation).toBe('none');
    expect(log.rpcs).toEqual([]);
  });

  test('serviço: sem flag não toca na RPC; erro 42501 vira orchestration_not_enabled', async () => {
    const off = fake({});
    expect(isClearWorkFocusEnabled({})).toBe(false);
    expect(await clearWorkFocus(off.client, {})).toEqual({ ok: false, code: 'not_enabled' });
    expect(off.log.rpcs).toEqual([]);
    const denied = fake({}, { rpcError: true });
    expect(await clearWorkFocus(denied.client, { ANIMA_CLEAR_WORK_FOCUS_ENABLED: '1' })).toEqual({ ok: false, code: 'orchestration_not_enabled' });
  });
});

describe('fronteira da rota do chat', () => {
  const source = readFileSync(resolve(__dirname, '../../app/api/ai/chat/route.ts'), 'utf8');
  const start = source.indexOf('const focusIntent = classifyWorkFocusIntent(message)');
  const end = source.indexOf('// Mandato estreito do Dev');
  const branch = source.slice(start, end);

  test('a intenção de foco é tratada antes de detectores, seletor e provider', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(start).toBeLessThan(source.indexOf('detectActivities(message'));
    expect(start).toBeLessThan(source.indexOf('streamChatProvider({'));
    expect(start).toBeLessThan(source.indexOf("kind:'focus_confirmation_required'"));
  });

  test('o ramo não anexa contexto nem grava mensagens diretamente', () => {
    expect(branch).not.toMatch(/attachContext|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
    expect(branch).toContain('handleWorkFocusIntent');
    expect(branch).toContain('developmentMode');
  });

  test('o seletor só nasce da continuação explícita (isWorkContinuation estrito)', () => {
    const picker = source.indexOf("else if(interpretation.kind==='conversation'&&isWorkContinuation(message))");
    expect(picker).toBeGreaterThan(start);
  });
});
