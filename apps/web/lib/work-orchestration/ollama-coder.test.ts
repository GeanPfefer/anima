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
  test('preserva identidade local e aceita identidade remota explícita', () => {
    expect(new OllamaCoderBackend({ model: 'x' }).id).toBe('ollama:x');
    expect(new OllamaCoderBackend({ model: 'x', backendId: 'ollama:remote/runpod-a40:x' }).id)
      .toBe('ollama:remote/runpod-a40:x');
  });
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

  test('prompt ensina search e lineRange como modos exclusivos para localizar e ampliar contexto', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl, sentBodies } = scriptedFetch([readReq, editReq(bigSha)]);

    await new OllamaCoderBackend({ model: 'x', fetchImpl })
      .edit(request, workspace, new AbortController().signal);

    const firstCall = sentBodies[0]!;
    expect(firstCall).toContain('LOCALIZAR');
    expect(firstCall).toContain('LER INTERVALO');
    expect(firstCall).toContain('search e lineRange são modos EXCLUSIVOS');
    expect(firstCall).toContain('Use search para localizar a linha');
    expect(firstCall).toContain('reserve leitura para cada um');
    expect(firstCall).toContain('Nunca use create_file em exists=true');
  });

  test('repair recebe evidência concreta do gate e relê o estado atual sem declarar sucesso', async () => {
    const broken = `${bigDoc}\nexport const invented = candidate.location;`;
    const workspace = memoryWorkspace({ 'docs/a.md': broken });
    const { fetchImpl, sentBodies } = scriptedFetch([
      JSON.stringify({ action: 'read', reads: [{ path: 'docs/a.md', search: 'candidate.location' }] }),
      JSON.stringify({
        action: 'edit',
        operations: [{
          kind: 'replace_exact',
          path: 'docs/a.md',
          expected_file_sha256: sha256(broken),
          before: 'export const invented = candidate.location;',
          after: 'export const repaired = true;',
          expected_occurrences: 1,
        }],
      }),
    ]);

    await new OllamaCoderBackend({ model: 'x', fetchImpl }).edit({
      ...request,
      hostValidationFeedback: {
        kind: 'gate-failure',
        failedGate: { label: 'typecheck', command: 'npm run typecheck', exitCode: 2, timedOut: false, cancelled: false },
        retryIndex: 1,
        retryLimit: 1,
        changedFiles: ['docs/a.md'],
        diffSha256: 'b'.repeat(64),
        diagnostic: "Property 'location' does not exist on type Candidate",
      },
    }, workspace, new AbortController().signal);

    const prompt = sentBodies[0]!;
    expect(prompt).toContain('FASE DE REPARO');
    expect(prompt).toContain('exitCode=2');
    expect(prompt).toContain("Property 'location' does not exist");
    expect(prompt).toContain('docs/a.md');
    expect(prompt).toContain('diffSha256=bbbb');
    expect(prompt).toContain('O host reexecutará os gates');
    expect(workspace.files.get('docs/a.md')).toContain('export const repaired = true;');
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

  test('leitura repetida é deduplicada e recebe diagnóstico explícito de progresso antes da volta final', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl, sentBodies } = scriptedFetch([readReq, readReq, readReq, editReq(bigSha)]);

    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl })
      .edit(request, workspace, new AbortController().signal);

    expect(result.touchedResources).toEqual(['docs/a.md']);
    const finalPrompt = sentBodies.at(-1)!;
    expect(finalPrompt).toContain('requests=3; novos=1; repetidos=2');
    expect(finalPrompt).toContain('Repetições idênticas não foram duplicadas');
    expect(finalPrompt).toContain('docs/a.md (search)');
    expect(finalPrompt.match(/Linha ALVO unica para editar/g)).toHaveLength(1);
  });

  test('guard de progresso não confunde regiões diferentes do mesmo arquivo', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const secondRead = JSON.stringify({
      action: 'read',
      reads: [{ path: 'docs/a.md', search: 'Cabeçalho', contextBefore: 0, contextAfter: 0, maxLines: 10 }],
    });
    const { fetchImpl, sentBodies } = scriptedFetch([readReq, secondRead, editReq(bigSha)]);

    await new OllamaCoderBackend({ model: 'x', fetchImpl })
      .edit(request, workspace, new AbortController().signal);

    const editPrompt = sentBodies.at(-1)!;
    expect(editPrompt).toContain('requests=2; novos=2; repetidos=0');
    expect(editPrompt).not.toContain('Repetições idênticas');
    expect(editPrompt).toContain('Linha ALVO unica para editar');
    expect(editPrompt).toContain('# Cabeçalho');
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

  test('a última volta exige edição e não repete a oferta de leitura; editar nela é aceito', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    // Três leituras servidas nas voltas com orçamento e a EDIÇÃO na volta final (roundsLeft=0).
    const { fetchImpl, sentBodies } = scriptedFetch([readReq, readReq, readReq, editReq(bigSha)]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(request, workspace, new AbortController().signal);

    // Editar na volta final (sem rodadas restantes) é aceito, não recusado.
    expect(result.touchedResources).toEqual(['docs/a.md']);
    expect(workspace.files.get('docs/a.md')).toContain('Linha ALVO EDITADA');

    // A volta final EXIGE edição e não repete a oferta de leitura (frases sem
    // aspas, porque o corpo enviado é JSON e as aspas do prompt vêm escapadas).
    const finalPrompt = sentBodies[sentBodies.length - 1]!;
    expect(finalPrompt).toContain('0 rodadas de leitura restantes');
    expect(finalPrompt).toContain('DEVE responder agora');
    expect(finalPrompt).toContain('Um novo pedido de leitura será recusado');
    // A primeira volta ofereceu leitura normalmente; a penúltima avisou ser a última.
    expect(sentBodies[0]).toContain('3 rodadas de leitura restantes');
    expect(sentBodies[0]).not.toContain('DEVE responder agora');
    expect(sentBodies[2]).toContain('a última');
  });

  test('reparo que estoura o orçamento é recusado ANTES da 2ª chamada (mede o payload real, não o prompt original)', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': 'linha única' });
    // Objetivo com padding deixa o prompt original perto do teto do orçamento
    // pequeno; o eco do reparo (clip 500) + a instrução empurram o payload do
    // reparo além do teto, enquanto a volta original ainda cabe. Antes da correção
    // o reparo reavaliava o prompt original e passava — mandando um payload maior
    // que o Ollama truncaria em silêncio.
    const objective = 'reconciliar'; // o SYSTEM expandido deixa o prompt original perto deste teto estreito
    const bigInvalid = `{"lixo":"${'x'.repeat(700)}"}`; // schema inválido e grande (eco clip=500)
    const { fetchImpl, sentBodies } = scriptedFetch([bigInvalid, editReq(sha256('linha única'))]);
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl, operationalContextCap: 1280 })
      .edit({ objective, includedScope: ['docs/a.md'], excludedScope: ['x'] }, workspace, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_context_budget_exceeded' });
    // A 1ª chamada (prompt original) foi enviada; o reparo foi barrado antes da 2ª.
    expect(sentBodies.length).toBe(1);
  });

  test('reparo truncado pelo modelo vira ollama_prompt_truncated (guarda do payload do reparo)', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    // 1ª chamada: schema inválido, avaliada por inteiro (sem truncamento) → reparo.
    // 2ª chamada (reparo): resposta válida, mas o modelo avaliou pouquíssimos tokens
    // do payload do reparo — truncamento que a correção agora detecta.
    let call = 0;
    const fetchImpl = (async (_url: unknown, _init: { body: string }) => {
      call += 1;
      const first = call === 1;
      return { ok: true, status: 200, json: async () => ({
        message: { content: first ? '{"nao":"é protocolo"}' : editReq(bigSha) },
        prompt_eval_count: first ? 100_000 : 5,
        eval_count: 50, done_reason: 'stop',
      }) };
    }) as unknown as typeof fetch;
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(request, workspace, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_prompt_truncated' });
  });
  test('R2 fica DESLIGADO por default: nao anuncia anchor e replace_anchor e recusado', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const forged = JSON.stringify({
      action: 'edit',
      operations: [{
        kind: 'replace_anchor',
        anchor_id: 'r2a_' + 'a'.repeat(64),
        after: 'Linha ALVO EDITADA',
      }],
    });
    const { fetchImpl, sentBodies } = scriptedFetch([readReq, forged]);

    await expect(
      new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(
        request,
        workspace,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'ollama_invalid_response_schema' });

    expect(sentBodies.join('\n')).not.toContain('replace_anchor');
    expect(sentBodies.join('\n')).not.toContain('Âncoras experimentais R2');
    expect(workspace.files.get('docs/a.md')).toBe(bigDoc);
  });

  test('R2 opt-in anuncia anchorId servido e aceita replace_anchor sem path/SHA/range vindos do modelo', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const sentBodies: string[] = [];
    let call = 0;

    const fetchImpl = (async (_url: unknown, init: { body: string }) => {
      sentBodies.push(init.body);
      call += 1;

      if (call === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              content: JSON.stringify({
                action: 'read',
                reads: [{
                  path: 'docs/a.md',
                  lineRange: [199, 201],
                  contextBefore: 0,
                  contextAfter: 0,
                  maxLines: 10,
                }],
              }),
            },
            prompt_eval_count: 100_000,
            eval_count: 50,
            done_reason: 'stop',
          }),
        };
      }

      const match = /r2a_[a-f0-9]{64}/.exec(init.body);
      if (!match) throw new Error('teste esperava anchorId anunciado pelo host');

      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            content: JSON.stringify({
              action: 'edit',
              operations: [{
                kind: 'replace_anchor',
                anchor_id: match[0],
                after: [
                  'linha 199',
                  'Linha ALVO EDITADA VIA R2',
                  'linha 201',
                ].join('\n'),
              }],
            }),
          },
          prompt_eval_count: 100_000,
          eval_count: 50,
          done_reason: 'stop',
        }),
      };
    }) as unknown as typeof fetch;

    const backend = new OllamaCoderBackend({
      model: 'x',
      fetchImpl,
      experimentalAnchorMode: {
        kind: 'r2-host-mediated-v1',
        cycleId: 'phase-b-unit-test',
      },
    });

    const result = await backend.edit(
      request,
      workspace,
      new AbortController().signal,
    );

    expect(result.touchedResources).toEqual(['docs/a.md']);
    expect(workspace.files.get('docs/a.md')).toContain('Linha ALVO EDITADA VIA R2');
    expect(workspace.files.get('docs/a.md')).toContain('SENTINELA_LONGE');

    const allSent = sentBodies.join('\n');
    expect(allSent).toContain('replace_anchor');
    expect(allSent).toContain('Âncoras experimentais R2');
    expect(allSent).toMatch(/r2a_[a-f0-9]{64}/);
    expect(allSent).not.toContain('SENTINELA_LONGE');
  });

});
