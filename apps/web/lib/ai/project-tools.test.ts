import { executeProjectTool } from './project-tools';

describe('ferramentas locais do projeto', () => {
  const originalRoot = process.env.ANIMA_PROJECT_ROOT;

  beforeAll(() => {
    process.env.ANIMA_PROJECT_ROOT = 'G:\\anima';
  });

  afterAll(() => {
    if (originalRoot === undefined) delete process.env.ANIMA_PROJECT_ROOT;
    else process.env.ANIMA_PROJECT_ROOT = originalRoot;
  });

  test('lê um trecho limitado de um arquivo autorizado', async () => {
    const raw = await executeProjectTool('project_read_file', JSON.stringify({
      path: 'AGENTS.md',
      start_line: 1,
      end_line: 5,
    }));
    const body = JSON.parse(raw) as { ok: boolean; result?: { path: string; endLine: number; text: string } };
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ path: 'AGENTS.md', endLine: 5 });
    expect(body.result?.text).toContain('1:');
  });

  test('bloqueia arquivos de ambiente mesmo quando estão dentro do projeto', async () => {
    const raw = await executeProjectTool('project_read_file', JSON.stringify({
      path: 'apps/web/.env.local',
      start_line: 1,
      end_line: 10,
    }));
    expect(JSON.parse(raw)).toMatchObject({ ok: false, error: expect.stringContaining('bloqueado') });
  });

  test('recusa travessia para fora da raiz autorizada', async () => {
    const raw = await executeProjectTool('project_read_file', JSON.stringify({
      path: '../outro/segredo.txt',
      start_line: 1,
      end_line: 10,
    }));
    expect(JSON.parse(raw)).toMatchObject({ ok: false, error: expect.stringContaining('fora do projeto') });
  });

  test('busca na raiz usa o projeto como alvo e não fica esperando stdin', async () => {
    const raw = await executeProjectTool('project_search', JSON.stringify({
      query: 'roteador operacional',
      path: null,
    }));
    const body = JSON.parse(raw) as { ok: boolean; result?: { matches?: string[] } };
    expect(body.ok).toBe(true);
    expect(body.result?.matches?.some(match => match.includes('AGENTS.md'))).toBe(true);
  });
});
