import { parseArgs } from './args';

describe('parser de argumentos da CLI', () => {
  test('sem argumentos → help', () => {
    expect(parseArgs([])).toEqual({ ok: true, command: { kind: 'help' } });
  });

  test('status com --json', () => {
    expect(parseArgs(['status', '--json'])).toEqual({ ok: true, command: { kind: 'status', json: true } });
  });

  test('budget status exige item e aceita --json', () => {
    expect(parseArgs(['budget', 'status', 'abc', '--json'])).toEqual({ ok: true, command: { kind: 'budget-status', id: 'abc', json: true } });
    expect(parseArgs(['budget', 'status'])).toEqual({ ok: false, error: 'Uso: anima budget status <id|REF>' });
  });

  test('work list sem json', () => {
    expect(parseArgs(['work', 'list'])).toEqual({ ok: true, command: { kind: 'work-list', json: false } });
  });

  test('work show <id|REF>', () => {
    expect(parseArgs(['work', 'show', 'abc'])).toEqual({ ok: true, command: { kind: 'work-show', id: 'abc', json: false } });
  });

  test('work show sem id → uso inválido', () => {
    expect(parseArgs(['work', 'show'])).toEqual({ ok: false, error: 'Uso: anima work show <id|REF>' });
  });

  test('work correct <id|REF>', () => {
    expect(parseArgs(['work', 'correct', 'abc', '--json'])).toEqual({ ok: true, command: { kind: 'work-correct', id: 'abc', requiredGates: [], json: true } });
    expect(parseArgs(['work', 'correct', 'abc', '--require-gate', 'npm run build --workspace=@anima/web'])).toEqual({ ok: true, command: { kind: 'work-correct', id: 'abc', requiredGates: ['npm run build --workspace=@anima/web'], json: false } });
    expect(parseArgs(['work', 'show', 'abc', '--require-gate', 'npm run build']).ok).toBe(false);
  });

  test('work correct sem id → uso inválido', () => {
    expect(parseArgs(['work', 'correct'])).toEqual({ ok: false, error: 'Uso: anima work correct <id|REF>' });
  });

  test('work approve e work accept são comandos distintos', () => {
    expect(parseArgs(['work', 'approve', 'abc'])).toEqual({ ok: true, command: { kind: 'work-approve', id: 'abc', json: false } });
    expect(parseArgs(['work', 'accept', 'abc'])).toEqual({ ok: true, command: { kind: 'work-accept', id: 'abc', json: false } });
  });

  test('work withdraw exige --reason não vazio', () => {
    expect(parseArgs(['work', 'withdraw', 'abc'])).toMatchObject({ ok: false });
    expect(parseArgs(['work', 'withdraw', 'abc', '--reason', 'plano obsoleto']))
      .toEqual({ ok: true, command: { kind: 'work-withdraw', id: 'abc', reason: 'plano obsoleto', json: false } });
  });

  test('work resolve-pending: request-changes exige --reason; cancel aceita motivo opcional', () => {
    expect(parseArgs(['work', 'resolve-pending', 'abc', 'request-changes'])).toMatchObject({ ok: false });
    expect(parseArgs(['work', 'resolve-pending', 'abc', 'verify'])).toMatchObject({ ok: false });
    expect(parseArgs(['work', 'resolve-pending', 'abc'])).toMatchObject({ ok: false });
    expect(parseArgs(['work', 'resolve-pending', 'abc', 'request-changes', '--reason', 'refazer']))
      .toEqual({ ok: true, command: { kind: 'work-resolve-pending', id: 'abc', decision: 'request_changes', reason: 'refazer', json: false } });
    expect(parseArgs(['work', 'resolve-pending', 'abc', 'cancel']))
      .toEqual({ ok: true, command: { kind: 'work-resolve-pending', id: 'abc', decision: 'cancel', reason: null, json: false } });
  });

  test('work retry <id|REF> (deriva o resto do estado persistido)', () => {
    expect(parseArgs(['work', 'retry', 'abc', '--json'])).toEqual({ ok: true, command: { kind: 'work-retry', id: 'abc', json: true } });
    expect(parseArgs(['work', 'retry'])).toEqual({ ok: false, error: 'Uso: anima work retry <id|REF>' });
  });

  test('work authorize-resume <id|REF> (deriva o resto do estado persistido)', () => {
    expect(parseArgs(['work', 'authorize-resume', 'abc'])).toEqual({ ok: true, command: { kind: 'work-authorize-resume', id: 'abc', planPath: null, json: false } });
    expect(parseArgs(['work', 'authorize-resume'])).toEqual({ ok: false, error: 'Uso: anima work authorize-resume <id|REF> [--plan arquivo.json]' });
  });
  test('work supervise/unsupervise exigem item',()=>{
    expect(parseArgs(['work','supervise','abc'])).toEqual({ok:true,command:{kind:'work-supervise',id:'abc',json:false}});
    expect(parseArgs(['work','unsupervise','abc','--json'])).toEqual({ok:true,command:{kind:'work-unsupervise',id:'abc',json:true}});
  });

  test('work authorize-resume com --plan e --json', () => {
    expect(parseArgs(['work', 'authorize-resume', 'abc', '--plan', 'auth.json', '--json']))
      .toEqual({ ok: true, command: { kind: 'work-authorize-resume', id: 'abc', planPath: 'auth.json', json: true } });
  });

  test('--plan só vale para work authorize-resume', () => {
    expect(parseArgs(['work', 'replan', 'abc', '--plan', 'auth.json'])).toMatchObject({ ok: false });
    expect(parseArgs(['status', '--plan', 'x'])).toMatchObject({ ok: false });
  });

  test('work request-changes exige --reason não vazio', () => {
    expect(parseArgs(['work', 'request-changes', 'abc'])).toMatchObject({ ok: false });
    expect(parseArgs(['work', 'request-changes', 'abc', '--reason', '   '])).toMatchObject({ ok: false });
  });

  test('work request-changes com --reason e --json', () => {
    expect(parseArgs(['work', 'request-changes', 'abc', '--json', '--reason', 'faltam provas']))
      .toEqual({ ok: true, command: { kind: 'work-request-changes', id: 'abc', reason: 'faltam provas', json: true } });
  });

  test('--reason=valor inline também é aceito e é trimado', () => {
    expect(parseArgs(['work', 'request-changes', 'abc', '--reason=  x  ']))
      .toEqual({ ok: true, command: { kind: 'work-request-changes', id: 'abc', reason: 'x', json: false } });
  });

  test('flag desconhecida → uso inválido', () => {
    expect(parseArgs(['status', '--bogus'])).toEqual({ ok: false, error: 'Flag desconhecida: --bogus' });
  });

  test('subcomando de work desconhecido → uso inválido', () => {
    expect(parseArgs(['work', 'frobnicate'])).toMatchObject({ ok: false });
  });

  test('work executors exige exatamente um id e recusa --reason e extras', () => {
    expect(parseArgs(['work', 'executors', 'abc'])).toEqual({ ok: true, command: { kind: 'work-executors', id: 'abc', json: false } });
    expect(parseArgs(['work', 'executors', 'abc', '--json'])).toEqual({ ok: true, command: { kind: 'work-executors', id: 'abc', json: true } });
    expect(parseArgs(['work', 'executors'])).toMatchObject({ ok: false });
    expect(parseArgs(['work', 'executors', 'a', 'b'])).toMatchObject({ ok: false });
    expect(parseArgs(['work', 'executors', 'a', '--reason', 'x'])).toMatchObject({ ok: false });
  });

  test('comando de topo desconhecido → uso inválido', () => {
    expect(parseArgs(['bogus'])).toEqual({ ok: false, error: 'Comando desconhecido: bogus' });
  });
});


test('work correct --rework único e repetido preserva lista e flags', () => {
  expect(parseArgs(['work', 'correct', 'abc', '--rework', 'a.ts'])).toEqual({
    ok: true, command: { kind: 'work-correct', id: 'abc', requiredGates: [], json: false, reworkPaths: ['a.ts'] },
  });
  const argv = ['work', 'correct', 'abc', '--rework', 'a.ts', '--require-gate', 'npm run build', '--rework', 'b.ts', '--json'];
  expect(parseArgs(argv)).toEqual({ ok: true, command: {
    kind: 'work-correct', id: 'abc', requiredGates: ['npm run build'], json: true, reworkPaths: ['a.ts', 'b.ts'],
  } });
  expect(parseArgs(argv)).toEqual(parseArgs(argv));
});

test.each([
  ['work', 'correct', 'abc', '--rework'],
  ['work', 'correct', 'abc', '--rework', ''],
  ['work', 'correct', 'abc', '--rework', '   '],
  ['work', 'correct', 'abc', '--rework', '--json'],
  ['work', 'correct', 'abc', '--rework', 'a.ts', '--rework'],
  ['work', 'show', 'abc', '--rework', 'a.ts'],
  ['work', 'retry', 'abc', '--rework', 'a.ts'],
  ['work', 'replan', 'abc', '--rework', 'a.ts'],
  ['status', '--rework', 'a.ts'],
  ['--rework', 'a.ts'],
])('--rework inválido ou fora de work correct: %j', (...argv) => {
  expect(parseArgs(argv)).toMatchObject({ ok: false });
});

test.each(['show', 'evidence', 'executors', 'approve'])('parser preserva a referência de work %s sem lookup', sub => {
  expect(parseArgs(['work', sub, 'SDC-01'])).toEqual({ ok: true, command: { kind: `work-${sub}`, id: 'SDC-01', json: false } });
});
test('parser deixa a validação da referência para a aplicação', () => {
  expect(parseArgs(['work', 'show', 'sdc-01'])).toEqual({ ok: true, command: { kind: 'work-show', id: 'sdc-01', json: false } });
});
