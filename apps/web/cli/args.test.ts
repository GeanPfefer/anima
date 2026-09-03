import { parseArgs } from './args';

describe('parser de argumentos da CLI', () => {
  test('sem argumentos → help', () => {
    expect(parseArgs([])).toEqual({ ok: true, command: { kind: 'help' } });
  });

  test('status com --json', () => {
    expect(parseArgs(['status', '--json'])).toEqual({ ok: true, command: { kind: 'status', json: true } });
  });

  test('work list sem json', () => {
    expect(parseArgs(['work', 'list'])).toEqual({ ok: true, command: { kind: 'work-list', json: false } });
  });

  test('work show <id>', () => {
    expect(parseArgs(['work', 'show', 'abc'])).toEqual({ ok: true, command: { kind: 'work-show', id: 'abc', json: false } });
  });

  test('work show sem id → uso inválido', () => {
    expect(parseArgs(['work', 'show'])).toEqual({ ok: false, error: 'Uso: anima work show <id>' });
  });

  test('work correct <id>', () => {
    expect(parseArgs(['work', 'correct', 'abc', '--json'])).toEqual({ ok: true, command: { kind: 'work-correct', id: 'abc', json: true } });
  });

  test('work correct sem id → uso inválido', () => {
    expect(parseArgs(['work', 'correct'])).toEqual({ ok: false, error: 'Uso: anima work correct <id>' });
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

  test('work retry <id> (deriva o resto do estado persistido)', () => {
    expect(parseArgs(['work', 'retry', 'abc', '--json'])).toEqual({ ok: true, command: { kind: 'work-retry', id: 'abc', json: true } });
    expect(parseArgs(['work', 'retry'])).toEqual({ ok: false, error: 'Uso: anima work retry <id>' });
  });

  test('work authorize-resume <id> (deriva o resto do estado persistido)', () => {
    expect(parseArgs(['work', 'authorize-resume', 'abc'])).toEqual({ ok: true, command: { kind: 'work-authorize-resume', id: 'abc', planPath: null, json: false } });
    expect(parseArgs(['work', 'authorize-resume'])).toEqual({ ok: false, error: 'Uso: anima work authorize-resume <id> [--plan arquivo.json]' });
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

  test('comando de topo desconhecido → uso inválido', () => {
    expect(parseArgs(['bogus'])).toEqual({ ok: false, error: 'Comando desconhecido: bogus' });
  });
});
