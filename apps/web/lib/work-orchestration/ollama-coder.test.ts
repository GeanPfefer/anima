/** @jest-environment node */
import type { CoderWorkspace } from './coder-backend';
import { OllamaCoderBackend } from './ollama-coder';
import { sha256 } from './ollama-protocol';

function memoryWorkspace(initial: Record<string, string> = {}): CoderWorkspace & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async path => files.get(path.replace(/\\/g, '/')) ?? null,
    writeFile: async (path, content) => { files.set(path.replace(/\\/g, '/'), content); return true; },
  };
}

/** Mock que toca um roteiro de respostas do protocolo e grava cada corpo enviado
 * (para provar que nenhum prompt carrega o conteúdo integral). prompt_eval_count
 * alto evita falso-positivo de truncamento. */
function scriptedFetch(responses: readonly string[]): { fetchImpl: typeof fetch; sentBodies: string[] } {
  const sentBodies: string[] = [];
  let i = 0;
  const fetchImpl = (async (_url: unknown, init: { body: string }) => {
    sentBodies.push(init.body);
    const content = responses[Math.min(i, responses.length - 1)] ?? '';
    i += 1;
    return { ok: true, status: 200, json: async () => ({ message: { content }, prompt_eval_count: 100_000, eval_count: 50, done_reason: 'stop' }) };
  }) as unknown as typeof fetch;
  return { fetchImpl, sentBodies };
}

const request = { objective: 'Reconciliar INT-03', includedScope: ['docs/a.md'], excludedScope: ['src/x.ts'] };

// Documento grande com um alvo único (linha 200) e um sentinela distante (linha 350).
const bigDoc = Array.from({ length: 400 }, (_, i) => {
  if (i === 0) return '# Cabeçalho';
  if (i === 199) return 'Linha ALVO unica para editar';
  if (i === 349) return 'corpo SENTINELA_LONGE que nao deve trafegar';
  return `linha ${i + 1}`;
}).join('\n');
const bigSha = sha256(bigDoc);

const readReq = '{"action":"read","reads":[{"path":"docs/a.md","search":"ALVO","contextBefore":1,"contextAfter":1,"maxLines":10}]}';
const editReq = (sha: string) => JSON.stringify({
  action: 'edit',
  operations: [{ kind: 'replace_exact', path: 'docs/a.md', expected_file_sha256: sha, before: 'Linha ALVO unica para editar', after: 'Linha ALVO EDITADA', expected_occurrences: 1 }],
});

describe('OllamaCoderBackend — protocolo limitado', () => {
  test('fluxo leitura → edição aplica a mudança e o backend id é preservado', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl } = scriptedFetch([readReq, editReq(bigSha)]);
    const backend = new OllamaCoderBackend({ model: 'qwen3-coder:latest', fetchImpl });
    const result = await backend.edit(request, workspace, new AbortController().signal);

    expect(result.touchedResources).toEqual(['docs/a.md']);
    expect(backend.id).toBe('ollama:qwen3-coder:latest');
    expect(workspace.files.get('docs/a.md')).toContain('Linha ALVO EDITADA');
    expect(workspace.files.get('docs/a.md')).not.toContain('Linha ALVO unica');
  });

  test('NENHUMA chamada carrega o conteúdo integral do documento grande', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl, sentBodies } = scriptedFetch([readReq, editReq(bigSha)]);
    await new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(request, workspace, new AbortController().signal);
    const allSent = sentBodies.join('\n');
    // A linha distante (não-heading, longe do match) nunca é trafegada…
    expect(allSent).not.toContain('SENTINELA_LONGE');
    expect(allSent).not.toContain('linha 399');
    // …mas o arquivo final preservou tudo que não foi tocado.
    expect(workspace.files.get('docs/a.md')).toContain('SENTINELA_LONGE');
    expect(workspace.files.get('docs/a.md')).toContain('linha 399');
  });

  test('um reparo só-de-schema recupera uma resposta fora do formato', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl, sentBodies } = scriptedFetch(['{"status":"completed","reviewed_by":"Gean"}', editReq(bigSha)]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(request, workspace, new AbortController().signal);
    expect(result.touchedResources).toEqual(['docs/a.md']);
    expect(sentBodies.length).toBe(2); // uma chamada + um reparo
  });

  test('schema errado persistente falha com código específico', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl } = scriptedFetch(['{"nao":"é protocolo"}']);
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(request, workspace, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_invalid_response_schema' });
  });

  test('esgotar as rodadas de leitura sem editar falha com ollama_read_round_limit', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl } = scriptedFetch([readReq, readReq, readReq]);
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl, maxReadRounds: 1 }).edit(request, workspace, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_read_round_limit' });
  });

  test('edição fora do escopo é recusada', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const outOfScope = JSON.stringify({ action: 'edit', operations: [{ kind: 'replace_exact', path: 'src/x.ts', expected_file_sha256: bigSha, before: 'a', after: 'b', expected_occurrences: 1 }] });
    const { fetchImpl } = scriptedFetch([outOfScope]);
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(request, workspace, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_edit_outside_scope' });
  });

  test('hash desatualizado é recusado sem escrever', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl } = scriptedFetch([editReq(sha256('conteúdo diferente'))]);
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(request, workspace, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_stale_file_hash' });
    expect(workspace.files.get('docs/a.md')).toBe(bigDoc); // intacto
  });

  test('resposta não-ok do servidor vira erro de transporte tipado', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const failing = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl: failing }).edit(request, workspace, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_transport_error' });
  });

  test('lote com create_file escreve o arquivo novo (rollback fica na worktree)', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const resp = JSON.stringify({ action: 'edit', operations: [
      { kind: 'replace_exact', path: 'docs/a.md', expected_file_sha256: bigSha, before: 'Linha ALVO unica para editar', after: 'Linha ALVO EDITADA', expected_occurrences: 1 },
      { kind: 'create_file', path: 'docs/novo.md', content: '# novo' },
    ] });
    const { fetchImpl } = scriptedFetch([resp]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(
      { objective: 'x', includedScope: ['docs/a.md', 'docs/novo.md'], excludedScope: ['y'] }, workspace, new AbortController().signal);
    expect([...result.touchedResources].sort()).toEqual(['docs/a.md', 'docs/novo.md']);
    expect(workspace.files.get('docs/novo.md')).toBe('# novo');
    expect(workspace.files.get('docs/a.md')).toContain('Linha ALVO EDITADA');
  });

  test('writeFile recusado pela guarda lança sem retornar sucesso parcial (restauração é da worktree)', async () => {
    const files = new Map([['docs/a.md', 'A0 ALVO fim'], ['docs/b.md', 'B0 aqui fim']]);
    const sA = sha256(files.get('docs/a.md')!);
    const sB = sha256(files.get('docs/b.md')!);
    const workspace = {
      files,
      readFile: async (p: string) => files.get(p.replace(/\\/g, '/')) ?? null,
      // a guarda recusa a escrita do 2º arquivo (simula guarda/IO):
      writeFile: async (p: string, c: string) => { const path = p.replace(/\\/g, '/'); if (path === 'docs/b.md' && c !== 'B0 aqui fim') return false; files.set(path, c); return true; },
    };
    const resp = JSON.stringify({ action: 'edit', operations: [
      { kind: 'replace_exact', path: 'docs/a.md', expected_file_sha256: sA, before: 'ALVO', after: 'X', expected_occurrences: 1 },
      { kind: 'replace_exact', path: 'docs/b.md', expected_file_sha256: sB, before: 'aqui', after: 'Y', expected_occurrences: 1 },
    ] });
    const { fetchImpl } = scriptedFetch([resp]);
    // O backend NÃO restaura (autoridade única é a worktree); ele apenas garante
    // que nenhum sucesso PARCIAL seja retornado — lança. A reversão do estado
    // transitório é provada em worktree.test / worktree-executor.test.
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(
      { objective: 'x', includedScope: ['docs/a.md', 'docs/b.md'], excludedScope: ['z'] }, workspace, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_edit_outside_scope' });
  });
});
