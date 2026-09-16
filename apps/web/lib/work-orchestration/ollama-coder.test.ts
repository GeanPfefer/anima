/** @jest-environment node */
import {
  DEFAULT_CODER_HARNESS_POLICY_V1,
  STRONG_REMOTE_AGENTIC_RUNTIME_PROFILE_V1,
  resolveAgenticRuntimePolicy,
  resolveCommandExecutionPolicy,
  supervisedWorkspaceAccessPolicy,
  validCoderTranscripts,
  type CoderTranscript,
} from '@anima/core';
import type { CoderWorkspace, WorkspaceExecResult, WorkspaceListResult, WorkspaceSearchResult } from './coder-backend';
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

  test('PRÉ-CODER: a política canônica do harness entra no prompt ANTES da inferência (também cobre OpenAI, que delega ao Ollama)', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl, sentBodies } = scriptedFetch([readReq, editReq(bigSha)]);
    await new OllamaCoderBackend({ model: 'x', fetchImpl })
      .edit({ ...request, harnessPolicy: DEFAULT_CODER_HARNESS_POLICY_V1 }, workspace, new AbortController().signal);
    const firstCall = sentBodies[0]!;
    expect(firstCall).toContain('CONTRATO DO HARNESS');
    expect(firstCall).toContain('jest');
    expect(firstCall).toContain('vitest');
    expect(firstCall).toContain('entry.coderBackend');
  });

  test('sem harnessPolicy, o prompt não injeta o contrato (compat retroativa)', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl, sentBodies } = scriptedFetch([readReq, editReq(bigSha)]);
    await new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(request, workspace, new AbortController().signal);
    expect(sentBodies[0]!).not.toContain('CONTRATO DO HARNESS');
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
    expect(prompt).toContain('não repita o patch já presente');
    expect(prompt).toContain('Operação idempotente é no-progress');
    expect(prompt).toContain('Preserve TypeScript strict');
    expect(prompt).toContain('explicitamente null-safe');
    expect(prompt).toContain('diagnóstico do gate e os critérios do objetivo como autoridade');
    expect(prompt).toContain('sem substituir o comportamento exigido');
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
    expect(finalPrompt).toContain('0 rodadas de investigação restantes');
    expect(finalPrompt).toContain('DEVE responder agora');
    expect(finalPrompt).toContain('Novo pedido de leitura/busca/execução será recusado');
    // A primeira volta ofereceu leitura normalmente; a penúltima avisou ser a última.
    expect(sentBodies[0]).toContain('3 rodadas de investigação restantes');
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
    // Cap re-calibrado ao SYSTEM atual (que ganhou a instrução `in_lines`): o prompt
    // original (~898 tokens) cabe no inputBudget (=cap/2=950), mas o payload do reparo
    // (eco clip 500 + instrução, ~1080 tokens) o estoura — a invariante testada é essa,
    // não o tamanho absoluto do prompt.
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl, operationalContextCap: 1900 })
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

// Recuperação BOUNDED de âncora ambígua na MESMA tentativa (sem nova recovery):
// o host devolve as ocorrências e pede in_lines; o modelo reapresenta e converge.
describe('OllamaCoderBackend — âncora ambígua é recuperável dentro do budget', () => {
  const dupReq = { objective: 'editar bloco B', includedScope: ['docs/a.md'], excludedScope: [] };
  // 'const x = compute(a);' ocorre nas linhas 2 e 4 → âncora globalmente ambígua.
  const dupDoc = ['# head', '  const x = compute(a);', '  mid', '  const x = compute(a);', '  tail'].join('\n');
  const dupSha = sha256(dupDoc);
  const readDup = '{"action":"read","reads":[{"path":"docs/a.md","lineRange":[1,5],"maxLines":10}]}';
  const editAmbiguous = JSON.stringify({ action: 'edit', operations: [{ kind: 'replace_exact', path: 'docs/a.md', expected_file_sha256: dupSha, before: '  const x = compute(a);', after: '  const x = compute(b);' }] });
  const editScoped = JSON.stringify({ action: 'edit', operations: [{ kind: 'replace_exact', path: 'docs/a.md', expected_file_sha256: dupSha, before: '  const x = compute(a);', after: '  const x = compute(b);', in_lines: [4, 4] }] });

  test('ambíguo → host devolve ocorrências e pede in_lines → o modelo reapresenta e a edição converge', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': dupDoc });
    const { fetchImpl, sentBodies } = scriptedFetch([readDup, editAmbiguous, editScoped]);
    const result = await new OllamaCoderBackend({ model: 'qwen2.5-coder:14b', fetchImpl }).edit(dupReq, workspace, new AbortController().signal);
    expect(result.touchedResources).toEqual(['docs/a.md']);
    const out = workspace.files.get('docs/a.md')!;
    // Só a ocorrência da linha 4 mudou; a da linha 2 permanece.
    expect(out.split('const x = compute(b);').length - 1).toBe(1);
    expect(out.split('const x = compute(a);').length - 1).toBe(1);
    // O feedback do host (ambiguidade + in_lines) chegou ao modelo antes da 2ª edição.
    const feedback = sentBodies[2] ?? '';
    expect(feedback).toContain('âncora ambígua');
    expect(feedback).toContain('in_lines');
    expect(feedback).toContain('linha 2');
    expect(feedback).toContain('linha 4');
  });

  test('nenhuma mutação parcial no turno ambíguo (o arquivo fica intacto até a edição unívoca)', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': dupDoc });
    // read, ambíguo, ambíguo, ambíguo — nunca resolve.
    const { fetchImpl } = scriptedFetch([readDup, editAmbiguous, editAmbiguous, editAmbiguous, editAmbiguous]);
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl, maxReadRounds: 5 }).edit(dupReq, workspace, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_ambiguous_replacement' });
    // Fail-closed: o arquivo permaneceu byte a byte igual (nenhuma escrita parcial).
    expect(workspace.files.get('docs/a.md')).toBe(dupDoc);
  });

  test('reapresentação é BOUNDED: esgotado o teto de feedbacks, a ambiguidade vira terminal', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': dupDoc });
    // maxReadRounds alto isola o TETO de feedbacks (2) como causa terminal, não o limite de rodadas.
    const { fetchImpl, sentBodies } = scriptedFetch([readDup, editAmbiguous, editAmbiguous, editAmbiguous, editScoped]);
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl, maxReadRounds: 6 }).edit(dupReq, workspace, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_ambiguous_replacement' });
    // Houve read + 3 tentativas de edição (2 reapresentações + a 3ª já terminal); a 4ª (editScoped) nunca é pedida.
    expect(sentBodies.length).toBe(4);
  });
});

// Múltiplas leituras numa mesma rodada, com termos de busca distintos que existem
// no bigDoc (linhas numeradas). start desloca a janela para evitar dedupe entre rodadas.
const manyReads = (n: number, start = 5): string => JSON.stringify({
  action: 'read',
  reads: Array.from({ length: n }, (_, i) => ({
    path: 'docs/a.md', search: `linha ${start + i}`, contextBefore: 0, contextAfter: 0, maxLines: 3,
  })),
});

describe('OllamaCoderBackend — comportamento agêntico do Coding Harness V3', () => {
  test('>8 leituras numa rodada são servidas até o orçamento e o excedente é DEFERIDO — o laço continua e edita (não falha)', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl, sentBodies } = scriptedFetch([manyReads(10), editReq(bigSha)]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(request, workspace, new AbortController().signal);
    // Antes do V3 isto reprovava com ollama_invalid_response_schema ANTES de qualquer edit.
    expect(result.touchedResources).toEqual(['docs/a.md']);
    expect(workspace.files.get('docs/a.md')).toContain('Linha ALVO EDITADA');
    // A rodada de edição vê o aviso de deferência da rodada de leitura anterior.
    expect(sentBodies.at(-1)!).toContain('DEFERIDAS');
  });

  test('perfil remoto forte serve muitas leituras numa ÚNICA rodada sem deferir e sem falhar (correção do gargalo pago)', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl, sentBodies } = scriptedFetch([manyReads(12), editReq(bigSha)]);
    const policy = resolveAgenticRuntimePolicy({ mode: 'supervised', profile: STRONG_REMOTE_AGENTIC_RUNTIME_PROFILE_V1 });
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: policy })
      .edit(request, workspace, new AbortController().signal);
    expect(result.touchedResources).toEqual(['docs/a.md']);
    // 12 <= 24 (orçamento forte por rodada) ⇒ nada é deferido.
    expect(sentBodies.at(-1)!).not.toContain('DEFERIDAS');
  });

  test('leituras acumulam entre rodadas acima do orçamento por rodada sem falhar (READ→READ→EDIT)', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const { fetchImpl } = scriptedFetch([manyReads(5, 5), manyReads(5, 30), editReq(bigSha)]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl })
      .edit(request, workspace, new AbortController().signal);
    // 10 leituras servidas em 2 rodadas (> orçamento de 8 por rodada), depois edita.
    expect(result.touchedResources).toEqual(['docs/a.md']);
  });

  test('o teto de leituras da SESSÃO é uma fronteira: esgotado sem editar, encerra com read_round_limit', async () => {
    const workspace = memoryWorkspace({ 'docs/a.md': bigDoc });
    const policy = resolveAgenticRuntimePolicy({
      mode: 'autonomous',
      overrides: { readServingBudgetPerRound: 2, maxReadRounds: 10, maxTotalServedReads: 4 },
    });
    const { fetchImpl } = scriptedFetch([manyReads(2, 5), manyReads(2, 30), manyReads(2, 60)]);
    await expect(
      new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: policy })
        .edit(request, workspace, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ollama_read_round_limit' });
  });
});

// Workspace COM busca/listagem host-executada em memória (host-side): search varre
// os arquivos e retorna TODOS os matches (inclusive fora do read scope) — a filtragem
// ao escopo de LEITURA é responsabilidade do laço, exatamente como em produção.
function searchableWorkspace(initial: Record<string, string>): CoderWorkspace & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async path => files.get(path.replace(/\\/g, '/')) ?? null,
    writeFile: async (path, content) => { files.set(path.replace(/\\/g, '/'), content); return true; },
    async search(input): Promise<WorkspaceSearchResult> {
      const matches: { path: string; line: number; preview: string }[] = [];
      for (const [path, content] of files) {
        content.split('\n').forEach((text, i) => {
          if (text.includes(input.query)) matches.push({ path, line: i + 1, preview: text });
        });
      }
      const capped = matches.slice(0, input.maxResults);
      return { matches: capped, truncated: matches.length > capped.length };
    },
    async list(input): Promise<WorkspaceListResult> {
      const paths = [...files.keys()].filter(p => input.pattern === '**/*' || p.endsWith(input.pattern.replace(/^\*+/, '')));
      const capped = paths.slice(0, input.maxResults);
      return { paths: capped, truncated: paths.length > capped.length };
    },
  };
}

const searchAction = (query: string, maxResults = 20) => JSON.stringify({ action: 'search', query, maxResults });
const globAction = (pattern: string, maxResults = 40) => JSON.stringify({ action: 'glob', pattern, maxResults });
const readAction = (path: string, search: string) => JSON.stringify({ action: 'read', reads: [{ path, search, contextBefore: 0, contextAfter: 0, maxLines: 5 }] });
const editFileAction = (path: string, sha: string, before: string, after: string) => JSON.stringify({
  action: 'edit',
  operations: [{ kind: 'replace_exact', path, expected_file_sha256: sha, before, after, expected_occurrences: 1 }],
});

describe('OllamaCoderBackend — SEARCH host-side + READ amplo / WRITE estreito (V3)', () => {
  const targetContent = 'export const target = 1;\nconst usaSimbolo = SIMBOLO_X;\n';
  const depContent = 'export function helper() {\n  return SIMBOLO_X;\n}\n';
  const secretContent = 'export const SIMBOLO_X = 42;\n';
  const wsFiles = () => ({ 'src/target.ts': targetContent, 'src/dep.ts': depContent, 'src/secret.ts': secretContent });
  // LER: todo o workspace; ESCREVER: só src/target.ts; EXCLUÍDO: src/secret.ts.
  const policy = supervisedWorkspaceAccessPolicy(['src/target.ts'], ['src/secret.ts']);
  const req = () => ({
    objective: 'Usar SIMBOLO_X corretamente', includedScope: ['src/target.ts'], excludedScope: ['src/secret.ts'],
    workspaceAccessPolicy: policy,
  });
  const strong = resolveAgenticRuntimePolicy({ mode: 'supervised', overrides: { maxReadRounds: 8 } });

  test('SEARCH por símbolo FORA do write scope, READ do arquivo encontrado, e EDIT nele é RECUSADO (write fora do escopo)', async () => {
    const ws = searchableWorkspace(wsFiles());
    const { fetchImpl } = scriptedFetch([
      searchAction('SIMBOLO_X'),
      readAction('src/dep.ts', 'SIMBOLO_X'),
      editFileAction('src/dep.ts', sha256(depContent), 'SIMBOLO_X', 'SIMBOLO_Y'),
    ]);
    await expect(
      new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: strong }).edit(req(), ws, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ollama_edit_outside_scope' });
    // dep.ts (fora do write scope) permaneceu intacto.
    expect(ws.files.get('src/dep.ts')).toBe(depContent);
  });

  test('SEARCH -> READ -> EDIT dentro do write scope funciona numa sessão', async () => {
    const ws = searchableWorkspace(wsFiles());
    const { fetchImpl } = scriptedFetch([
      searchAction('SIMBOLO_X'),
      readAction('src/target.ts', 'target'),
      editFileAction('src/target.ts', sha256(targetContent), 'export const target = 1;', 'export const target = 2;'),
    ]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: strong }).edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(ws.files.get('src/target.ts')).toContain('target = 2');
  });

  test('resultados de SEARCH sao filtrados ao escopo de LEITURA: excluido nunca aparece; legivel fora do write scope aparece', async () => {
    const ws = searchableWorkspace(wsFiles());
    const { fetchImpl, sentBodies } = scriptedFetch([
      searchAction('SIMBOLO_X'),
      editFileAction('src/target.ts', sha256(targetContent), 'export const target = 1;', 'export const target = 2;'),
    ]);
    await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: strong }).edit(req(), ws, new AbortController().signal);
    const afterSearch = sentBodies[1]!; // prompt da rodada seguinte carrega o bloco da busca
    // Linhas de match têm o formato "<path>:<linha>:"; o header ecoa "src/secret.ts"
    // (sem ":") em "Fora do escopo", então checamos a forma de MATCH (com ":").
    expect(afterSearch).toContain('src/dep.ts:');       // legível fora do write scope, aparece como match
    expect(afterSearch).not.toContain('src/secret.ts:'); // excluído — filtrado pelo host, nunca vira match
  });

  test('SEARCH nunca vaza caminho fora do workspace (traversal filtrado pelo laco)', async () => {
    const ws = searchableWorkspace({ ...wsFiles(), '../evil.ts': 'SIMBOLO_X leaked\n' });
    const { fetchImpl, sentBodies } = scriptedFetch([
      searchAction('SIMBOLO_X'),
      editFileAction('src/target.ts', sha256(targetContent), 'export const target = 1;', 'export const target = 2;'),
    ]);
    await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: strong }).edit(req(), ws, new AbortController().signal);
    expect(sentBodies[1]!).not.toContain('evil');
  });

  test('multiplas buscas/leituras antes do edit funcionam (SEARCH->GLOB->READ->READ->EDIT)', async () => {
    const ws = searchableWorkspace(wsFiles());
    const { fetchImpl } = scriptedFetch([
      searchAction('SIMBOLO_X'),
      globAction('**/*'),
      readAction('src/dep.ts', 'SIMBOLO_X'),
      readAction('src/target.ts', 'target'),
      editFileAction('src/target.ts', sha256(targetContent), 'export const target = 1;', 'export const target = 2;'),
    ]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: strong }).edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
  });

  test('resultado grande de SEARCH e truncado explicitamente, sem derrubar a sessao', async () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`src/f${i}.ts`, 'SIMBOLO_X aqui\n']));
    const ws = searchableWorkspace({ ...wsFiles(), ...many });
    const { fetchImpl, sentBodies } = scriptedFetch([
      searchAction('SIMBOLO_X', 5), // pede só 5 -> host trunca
      editFileAction('src/target.ts', sha256(targetContent), 'export const target = 1;', 'export const target = 2;'),
    ]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: strong }).edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(sentBodies[1]!).toContain('truncado');
  });

  test('sem capacidade de busca no workspace, o prompt NAO anuncia search (retrocompat)', async () => {
    const ws = memoryWorkspace({ 'src/target.ts': targetContent });
    const { fetchImpl, sentBodies } = scriptedFetch([editFileAction('src/target.ts', sha256(targetContent), 'export const target = 1;', 'export const target = 2;')]);
    await new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(
      { objective: 'x', includedScope: ['src/target.ts'], excludedScope: [] }, ws, new AbortController().signal,
    );
    expect(sentBodies[0]!).not.toContain('INVESTIGAÇÃO AMPLA');
    expect(sentBodies[0]!).not.toContain('"action":"search"');
  });
});

// Workspace COM exec host-executado (fake determinístico): simula test/typecheck/git
// read-only sem processo real. npm test "passa" iff o alvo contém FIXED — provando
// TEST(exit1) -> EDIT -> TEST(exit0) recuperável.
function execWorkspace(initial: Record<string, string>): CoderWorkspace & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async path => files.get(path.replace(/\\/g, '/')) ?? null,
    writeFile: async (path, content) => { files.set(path.replace(/\\/g, '/'), content); return true; },
    async search(input): Promise<WorkspaceSearchResult> {
      const matches: { path: string; line: number; preview: string }[] = [];
      for (const [path, content] of files) content.split('\n').forEach((t, i) => { if (t.includes(input.query)) matches.push({ path, line: i + 1, preview: t }); });
      return { matches: matches.slice(0, input.maxResults), truncated: false };
    },
    async exec(input): Promise<WorkspaceExecResult> {
      const { program, args } = input;
      const ok = (files.get('src/target.ts') ?? '').includes('FIXED');
      if (program === 'npm' && args[0] === 'test') {
        return { exitCode: ok ? 0 : 1, stdout: ok ? 'Tests: 1 passed' : 'Tests: 1 failed — Expected FIXED', stderr: '', timedOut: false, durationMs: 5 };
      }
      if (program === 'npm' && args[0] === 'run') return { exitCode: 0, stdout: 'typecheck ok', stderr: '', timedOut: false, durationMs: 5 };
      if (program === 'git' && args[0] === 'status') return { exitCode: 0, stdout: ' M src/target.ts', stderr: '', timedOut: false, durationMs: 2 };
      if (program === 'git' && args[0] === 'diff') return { exitCode: 0, stdout: '--- a/src/target.ts\n+++ b/src/target.ts\n+FIXED', stderr: '', timedOut: false, durationMs: 2 };
      if (program === 'node' && args[0] === 'huge') return { exitCode: 0, stdout: 'x'.repeat(50000), stderr: '', timedOut: false, durationMs: 2 };
      if (program === 'node' && args[0] === 'slow') return { exitCode: -1, stdout: '', stderr: 'process killed by timeout', timedOut: true, durationMs: 999999 };
      return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, durationMs: 1 };
    },
  };
}

const execAction = (program: string, args: readonly string[] = []) => JSON.stringify({ action: 'exec', program, args });
const submitAction = () => JSON.stringify({ action: 'submit' });

describe('OllamaCoderBackend — EXEC/TEST/GIT governados + loop iterativo (V3, 3ª fatia)', () => {
  const initial = 'export const target = 1;\n';
  const fixEdit = editFileAction('src/target.ts', sha256(initial), 'export const target = 1;', 'export const target = 1; // FIXED');
  const policy = supervisedWorkspaceAccessPolicy(['src/target.ts'], ['src/secret.ts']);
  const cmd = resolveCommandExecutionPolicy('supervised');
  const runtime = resolveAgenticRuntimePolicy({ mode: 'supervised', overrides: { maxReadRounds: 12 } });
  const req = () => ({ objective: 'Corrigir', includedScope: ['src/target.ts'], excludedScope: ['src/secret.ts'], workspaceAccessPolicy: policy, commandPolicy: cmd });
  const backend = (fetchImpl: typeof fetch) => new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: runtime });

  test('EXEC permitido roda e captura stdout/exitCode; observação chega ao modelo', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const { fetchImpl, sentBodies } = scriptedFetch([execAction('npm', ['run', 'typecheck']), fixEdit, submitAction()]);
    const result = await backend(fetchImpl).edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(sentBodies[1]!).toContain('exitCode=0');
    expect(sentBodies[1]!).toContain('typecheck ok');
  });

  test('TEST exit 1 volta como observação recuperável; TEST -> EDIT -> TEST -> submit chega a exit 0', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const { fetchImpl, sentBodies } = scriptedFetch([execAction('npm', ['test']), fixEdit, execAction('npm', ['test']), submitAction()]);
    const result = await backend(fetchImpl).edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(ws.files.get('src/target.ts')).toContain('FIXED');
    // 1ª execução falhou (exit 1), sessão continuou; última execução passou (exit 0).
    expect(sentBodies[1]!).toContain('exitCode=1');
    expect(sentBodies[3]!).toContain('exitCode=0');
  });

  test('comando fora da allowlist é recusado pela política (observação), sem execução', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const { fetchImpl, sentBodies } = scriptedFetch([execAction('curl', ['http://x']), fixEdit, submitAction()]);
    const result = await backend(fetchImpl).edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(sentBodies[1]!).toContain('recusado pela política');
  });

  test('args com shell chaining não ganham execução (recusados pela política)', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const { fetchImpl, sentBodies } = scriptedFetch([execAction('npm', ['test', '&&', 'rm']), fixEdit, submitAction()]);
    const result = await backend(fetchImpl).edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(sentBodies[1]!).toContain('recusado pela política');
  });

  test('git status/diff (read-only) são permitidos; git commit/reset/push são recusados', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const { fetchImpl, sentBodies } = scriptedFetch([
      execAction('git', ['status']), execAction('git', ['diff']),
      execAction('git', ['commit']), execAction('git', ['push']), execAction('git', ['reset']),
      fixEdit, submitAction(),
    ]);
    const result = await backend(fetchImpl).edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(sentBodies[1]!).toContain('M src/target.ts');            // status servido
    expect(sentBodies[2]!).toContain('+FIXED');                     // diff servido
    expect(sentBodies[3]!).toContain('recusado pela política');     // commit recusado
    expect(sentBodies[4]!).toContain('recusado pela política');     // push recusado
    expect(sentBodies[5]!).toContain('recusado pela política');     // reset recusado
  });

  test('timeout volta como observação (timedOut) e a sessão continua', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const { fetchImpl, sentBodies } = scriptedFetch([execAction('node', ['slow']), fixEdit, submitAction()]);
    const result = await backend(fetchImpl).edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(sentBodies[1]!).toContain('TIMEOUT');
  });

  test('saída grande é truncada explicitamente, sem derrubar a sessão', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const { fetchImpl, sentBodies } = scriptedFetch([execAction('node', ['huge']), fixEdit, submitAction()]);
    const result = await backend(fetchImpl).edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(sentBodies[1]!).toContain('saída truncada');
  });

  test('write fora do escopo de escrita é recusado como observação (arquivo intacto), a sessão continua e conclui', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial, 'src/other.ts': 'export const other = 0;\n' });
    const badEdit = editFileAction('src/other.ts', sha256('export const other = 0;\n'), 'export const other = 0;', 'export const other = 9;');
    const { fetchImpl, sentBodies } = scriptedFetch([badEdit, fixEdit, submitAction()]);
    const result = await backend(fetchImpl).edit(req(), ws, new AbortController().signal);
    // A edição fora do escopo NÃO foi aplicada; a válida foi.
    expect(ws.files.get('src/other.ts')).toBe('export const other = 0;\n');
    expect(ws.files.get('src/target.ts')).toContain('FIXED');
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(sentBodies[1]!).toContain('Edição recusada (ollama_edit_outside_scope)');
  });

  test('SEARCH -> READ -> TEST -> EDIT -> TEST -> DIFF -> submit funciona numa sessão', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const { fetchImpl } = scriptedFetch([
      searchAction('target'),
      readAction('src/target.ts', 'target'),
      execAction('npm', ['test']),        // exit 1
      fixEdit,
      execAction('npm', ['test']),        // exit 0
      execAction('git', ['diff']),
      submitAction(),
    ]);
    const result = await backend(fetchImpl).edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(ws.files.get('src/target.ts')).toContain('FIXED');
  });

  test('submit sem nenhuma edição aplicada falha fechado', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const { fetchImpl } = scriptedFetch([execAction('npm', ['test']), submitAction()]);
    await expect(backend(fetchImpl).edit(req(), ws, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_no_effective_edits' });
  });

  test('validation command + edits: submit é recusado até teste focal verde e git diff pós-edit', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const validationCommands = [{ label: 'teste focal', program: 'npm', args: ['test'] }] as const;
    const { fetchImpl, sentBodies } = scriptedFetch([
      fixEdit,
      submitAction(),
      execAction('npm', ['test']),
      submitAction(),
      execAction('git', ['diff']),
      submitAction(),
    ]);
    const result = await backend(fetchImpl).edit({ ...req(), validationCommands }, ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(sentBodies[2]!).toContain('Submit recusado');
    expect(sentBodies[4]!).toContain('git diff');
  });

  test('TEST focal exit1 bloqueia submit; EDIT invalida prova antiga; TEST exit0 + diff liberam submit', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const firstEdit = editFileAction('src/target.ts', sha256(initial), 'export const target = 1;', 'export const target = 2;');
    const afterFirst = 'export const target = 2;\n';
    const secondEdit = editFileAction('src/target.ts', sha256(afterFirst), 'export const target = 2;', 'export const target = 2; // FIXED');
    const validationCommands = [{ label: 'teste focal', program: 'npm', args: ['test'] }] as const;
    const { fetchImpl, sentBodies } = scriptedFetch([
      firstEdit,
      execAction('npm', ['test']),
      submitAction(),
      secondEdit,
      execAction('npm', ['test']),
      execAction('git', ['diff']),
      submitAction(),
    ]);
    const result = await backend(fetchImpl).edit({ ...req(), validationCommands }, ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(sentBodies[2]!).toContain('submit permanece bloqueado');
    expect(sentBodies[3]!).toContain('Submit recusado');
    expect(sentBodies[5]!).toContain('exitCode=0');
  });

  test('validation commands concretos e contract discovery são expostos; SEARCH → READ → EDIT continua geral', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial, 'src/contracts.ts': "export type Source = 'real';\n" });
    const validationCommands = [{ label: 'teste focal', program: 'npm', args: ['test', '--', 'target.test.ts'] }] as const;
    const { fetchImpl, sentBodies } = scriptedFetch([
      searchAction('Source'),
      readAction('src/contracts.ts', 'Source'),
      fixEdit,
      execAction('npm', ['test', '--', 'target.test.ts']),
      execAction('git', ['diff', '--', 'src/target.ts']),
      submitAction(),
    ]);
    await backend(fetchImpl).edit({ ...req(), validationCommands }, ws, new AbortController().signal);
    expect(sentBodies[0]!).toContain('teste focal: npm test -- target.test.ts');
    expect(sentBodies[0]!).toContain('DESCOBERTA DE CONTRATO');
    expect(sentBodies[0]!).toContain('Placeholder temporário não pode sobreviver');
  });

  test('sem validation command, task mantém submit normal após edit', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const { fetchImpl } = scriptedFetch([fixEdit, submitAction()]);
    await expect(backend(fetchImpl).edit(req(), ws, new AbortController().signal))
      .resolves.toMatchObject({ touchedResources: ['src/target.ts'] });
  });

  test('fixture 7143d697: edits no fim do budget não podem concluir implicitamente sem gate focal', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const strictRuntime = resolveAgenticRuntimePolicy({ mode: 'supervised', overrides: { maxReadRounds: 1 } });
    const validationCommands = [{ label: 'gate focal', program: 'npm', args: ['test'] }] as const;
    const { fetchImpl } = scriptedFetch([
      readAction('src/target.ts', 'target'),
      fixEdit,
      submitAction(), submitAction(), submitAction(), submitAction(), submitAction(),
    ]);
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: strictRuntime })
      .edit({ ...req(), validationCommands }, ws, new AbortController().signal))
      .rejects.toThrow('validação focal verde e git diff são obrigatórios');
  });

  test('sem command policy, EXEC não é anunciado e edit permanece terminal (retrocompat)', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    // Sem commandPolicy no request → execMode desligado; edit encerra o turno.
    const { fetchImpl, sentBodies } = scriptedFetch([fixEdit]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl }).edit(
      { objective: 'x', includedScope: ['src/target.ts'], excludedScope: [], workspaceAccessPolicy: policy },
      ws, new AbortController().signal,
    );
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(sentBodies[0]!).not.toContain('EXECUÇÃO GOVERNADA');
  });

  // ===== Máquina de estados de submit (V3): SUBMIT só existe em READY_TO_SUBMIT =====
  const afterFix = 'export const target = 1; // FIXED\n';
  const vcmd = [{ label: 'teste focal', program: 'npm', args: ['test'] }] as const;

  test('T1: READ→EDIT→submit prematuro recusado SEM consumir reserva→TEST→DIFF→SUBMIT válido', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const strict = resolveAgenticRuntimePolicy({ mode: 'supervised', overrides: { maxReadRounds: 1 } });
    let captured: import('@anima/core').CoderTranscript | undefined;
    const { fetchImpl } = scriptedFetch([
      readAction('src/target.ts', 'target'),
      fixEdit,
      submitAction(), submitAction(),               // prematuros: bloqueados, não consomem reserva
      execAction('npm', ['test']),                   // exit0 → validado
      execAction('git', ['diff']),                   // diff → revisado
      submitAction(),                                // agora disponível
    ]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: strict })
      .edit({ ...req(), validationCommands: vcmd, onTranscript: t => { captured = t; } }, ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    const kinds = (captured?.runtimeEvents ?? []).map(e => e.kind);
    expect(kinds.filter(k => k === 'submit_blocked')).toHaveLength(2);
    expect(kinds).toContain('submit_allowed');
  });

  test('T2: EDIT→TEST verde→novo EDIT invalida prova→RETEST→DIFF→SUBMIT', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const edit2 = editFileAction('src/target.ts', sha256(afterFix), 'export const target = 1; // FIXED', 'export const target = 1; // FIXED2');
    const { fetchImpl, sentBodies } = scriptedFetch([
      fixEdit,                       // rev1
      execAction('npm', ['test']),   // exit0 → rev1 validada
      edit2,                         // rev2 → INVALIDA a prova da rev1
      submitAction(),                // recusado (rev2 não validada)
      execAction('npm', ['test']),   // exit0 → rev2 validada
      execAction('git', ['diff']),   // rev2 revisada
      submitAction(),                // válido
    ]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: runtime })
      .edit({ ...req(), validationCommands: vcmd, onTranscript: () => {} }, ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    // O submit após o 2º edit foi recusado (rev2 não validada); o feedback aparece no
    // próximo prompt. A nova edição invalidou a prova verde da rev1.
    expect(sentBodies[4]!).toContain('Submit recusado');
  });

  test('T3-6: SUBMIT filtrado por estado — anunciado só em READY_TO_SUBMIT', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const { fetchImpl, sentBodies } = scriptedFetch([
      fixEdit,                       // → dirty_unvalidated
      execAction('npm', ['test']),   // → dirty_validated
      execAction('git', ['diff']),   // → ready_to_submit
      submitAction(),
    ]);
    await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: runtime })
      .edit({ ...req(), validationCommands: vcmd }, ws, new AbortController().signal);
    // Prompt após EDIT: estado dirty_unvalidated, submit NÃO anunciado (linha termina em "edit").
    expect(sentBodies[1]!).toContain('estado dirty_unvalidated');
    expect(sentBodies[1]!).toContain('edit. Responda com UMA delas');
    // Prompt após TEST verde: dirty_validated, submit ainda NÃO anunciado.
    expect(sentBodies[2]!).toContain('estado dirty_validated');
    expect(sentBodies[2]!).toContain('edit. Responda com UMA delas');
    // Prompt após DIFF: ready_to_submit, submit ANUNCIADO.
    expect(sentBodies[3]!).toContain('estado ready_to_submit');
    expect(sentBodies[3]!).toContain('edit, submit. Responda com UMA delas');
  });

  test('T7: READ tardio após EDIT (orçamento esgotado) NÃO conclui sem provas', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const strict = resolveAgenticRuntimePolicy({ mode: 'supervised', overrides: { maxReadRounds: 1 } });
    const { fetchImpl } = scriptedFetch([fixEdit, readAction('src/target.ts', 'target')]); // repete read após orçamento
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: strict })
      .edit({ ...req(), validationCommands: vcmd }, ws, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_submit_gate_unsatisfied' });
  });

  test('T8: erro de EDIT recuperável esgotado após edição válida NÃO conclui sem provas', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial, 'src/other.ts': 'export const other = 0;\n' });
    const badEdit = editFileAction('src/other.ts', sha256('export const other = 0;\n'), 'export const other = 0;', 'x'); // fora do write scope
    const { fetchImpl } = scriptedFetch([fixEdit, badEdit]); // repete badEdit até esgotar editFeedbacks
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: runtime })
      .edit({ ...req(), validationCommands: vcmd }, ws, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_submit_gate_unsatisfied' });
    // A edição válida permaneceu; a fora de escopo nunca foi aplicada.
    expect(ws.files.get('src/target.ts')).toContain('FIXED');
    expect(ws.files.get('src/other.ts')).toBe('export const other = 0;\n');
  });

  test('T9: esgotamento total de rodadas produtivas sem provas → falha específica', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const strict = resolveAgenticRuntimePolicy({ mode: 'supervised', overrides: { maxReadRounds: 1 } });
    const { fetchImpl } = scriptedFetch([fixEdit, execAction('git', ['status'])]); // status (não focal, não diff) repete
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: strict })
      .edit({ ...req(), validationCommands: vcmd }, ws, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_submit_gate_unsatisfied' });
  });

  test('T10: transcript registra TEST/GIT/SUBMIT bloqueado/permitido + estado e revisões', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    let captured: import('@anima/core').CoderTranscript | undefined;
    const { fetchImpl } = scriptedFetch([
      fixEdit, submitAction(), execAction('npm', ['test']), execAction('git', ['diff']), submitAction(),
    ]);
    await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: runtime })
      .edit({ ...req(), validationCommands: vcmd, onTranscript: t => { captured = t; } }, ws, new AbortController().signal);
    const ev = captured?.runtimeEvents ?? [];
    const kinds = ev.map(e => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['edit_applied', 'submit_blocked', 'test', 'git_diff', 'submit_allowed']));
    // Cada evento fotografa o estado e as revisões; o submit_allowed acontece em ready_to_submit.
    expect(ev.find(e => e.kind === 'submit_allowed')?.state).toBe('ready_to_submit');
    expect(ev.find(e => e.kind === 'submit_blocked')?.state).toBe('dirty_unvalidated');
    expect(ev.find(e => e.kind === 'test')?.detail).toBe('npm test');
    // detail é não-sensível (sem args de caminho).
    for (const e of ev) expect(e.detail).not.toMatch(/target\.ts/);
  });

  test('T11: tarefa SEM validationCommands mantém comportamento compatível (submit já disponível pós-edit)', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const { fetchImpl, sentBodies } = scriptedFetch([fixEdit, submitAction()]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: runtime })
      .edit(req(), ws, new AbortController().signal); // req() sem validationCommands
    expect(result.touchedResources).toEqual(['src/target.ts']);
    // Sem gate executável, após o edit o submit é anunciado (ready_to_submit), sem deadlock.
    expect(sentBodies[1]!).toContain('estado ready_to_submit');
  });

  test('T12: perfil remoto forte garante caminho pós-edit suficiente (budget esgotado → EDIT→TEST→DIFF→SUBMIT)', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const strong = resolveAgenticRuntimePolicy({ mode: 'supervised', profile: STRONG_REMOTE_AGENTIC_RUNTIME_PROFILE_V1 });
    const reads = Array.from({ length: strong.maxReadRounds }, () => readAction('src/target.ts', 'target'));
    const { fetchImpl } = scriptedFetch([
      ...reads,                       // consome TODO o orçamento de leitura
      fixEdit, execAction('npm', ['test']), execAction('git', ['diff']), submitAction(),
    ]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: strong })
      .edit({ ...req(), validationCommands: vcmd }, ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
  });
});

describe('OllamaCoderBackend — observabilidade EXEC/TEST/GIT (V3, Parte A)', () => {
  const initial = 'export const target = 1;\n';
  const fixEdit = editFileAction('src/target.ts', sha256(initial), 'export const target = 1;', 'export const target = 1; // FIXED');
  const policy = supervisedWorkspaceAccessPolicy(['src/target.ts'], ['src/secret.ts']);
  const cmd = resolveCommandExecutionPolicy('supervised');
  const runtime = resolveAgenticRuntimePolicy({ mode: 'supervised', overrides: { maxReadRounds: 12 } });
  const req = () => ({ objective: 'Corrigir', includedScope: ['src/target.ts'], excludedScope: ['src/secret.ts'], workspaceAccessPolicy: policy, commandPolicy: cmd });
  const backend = (fetchImpl: typeof fetch) => new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: runtime });
  const obs = (t?: CoderTranscript) => t?.commandObservations ?? [];
  const vcmd = [{ label: 'gate', program: 'npm', args: ['test'] }] as const;

  test('captura comando + exit + stdout de TEST vermelho e verde e do git diff, por editRevision', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    let captured: CoderTranscript | undefined;
    const { fetchImpl } = scriptedFetch([
      execAction('npm', ['test']),   // pré-edit, exit 1 (editRevision 0)
      fixEdit,
      execAction('npm', ['test']),   // pós-edit, exit 0 (editRevision 1)
      execAction('git', ['diff']),
      submitAction(),
    ]);
    await backend(fetchImpl).edit({ ...req(), validationCommands: vcmd, onTranscript: t => { captured = t; } }, ws, new AbortController().signal);
    const tests = obs(captured).filter(e => e.kind === 'test');
    expect(tests.length).toBe(2);
    expect(tests[0]!.outcome).toBe('exit_nonzero'); expect(tests[0]!.exitCode).toBe(1);
    expect(tests[0]!.editRevision).toBe(0); expect(tests[0]!.command).toContain('npm test');
    expect(tests[0]!.stdout).toContain('failed'); expect(tests[0]!.cwd).toBe('worktree');
    expect(tests[1]!.outcome).toBe('exit0'); expect(tests[1]!.exitCode).toBe(0);
    expect(tests[1]!.editRevision).toBe(1); // nova prova amarrada à revisão nova
    const diffs = obs(captured).filter(e => e.kind === 'git_diff');
    expect(diffs.length).toBe(1);
    expect(diffs[0]!.stdout).toContain('+FIXED');            // diff preserva caminho/conteúdo p/ reconstrução
    expect(diffs[0]!.outputSha256).toMatch(/^[a-f0-9]{64}$/); // fingerprint da revisão
    expect(validCoderTranscripts([captured!])).toBe(true);
  });

  test('redação de segredos: stdout/stderr com credenciais são persistidos redigidos, sem valores crus', async () => {
    const secretStdout = [
      'Running tests…',
      'api_key=sk-live-SUPERSECRETVALUE1234',
      'Authorization: Bearer sk-live-abcdefgh12345678ZZZZ',
      'jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    ].join('\n');
    const ws: CoderWorkspace = {
      readFile: async p => (p.replace(/\\/g, '/') === 'src/target.ts' ? initial : null),
      writeFile: async () => true,
      exec: async () => ({ exitCode: 0, stdout: secretStdout, stderr: 'password=hunter2SECRETXYZ', timedOut: false, durationMs: 3 }),
    };
    let captured: CoderTranscript | undefined;
    const { fetchImpl } = scriptedFetch([execAction('node', ['probe']), fixEdit, submitAction()]);
    await backend(fetchImpl).edit({ ...req(), onTranscript: t => { captured = t; } }, ws, new AbortController().signal);
    const e = obs(captured).find(x => x.command.includes('node probe'))!;
    expect(e).toBeDefined();
    expect(e.stdout).toContain('<redacted>'); expect(e.stderr).toContain('<redacted>');
    expect(e.stdout).not.toContain('SUPERSECRETVALUE');
    expect(e.stdout).not.toContain('abcdefgh12345678');
    expect(e.stdout).not.toContain('SflKxwRJSMeK');
    expect(e.stderr).not.toContain('hunter2SECRETXYZ');
    // Nenhum segredo em NENHUM lugar do transcript serializado; e o transcript é persist-válido.
    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain('SUPERSECRETVALUE');
    expect(serialized).not.toContain('hunter2SECRETXYZ');
    expect(serialized).not.toContain('SflKxwRJSMeK');
    expect(validCoderTranscripts([captured!])).toBe(true);
  });

  test('saída enorme é truncada com indicador explícito e dentro do teto persistível', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial }); // node huge → 50000 chars
    let captured: CoderTranscript | undefined;
    const { fetchImpl } = scriptedFetch([execAction('node', ['huge']), fixEdit, submitAction()]);
    await backend(fetchImpl).edit({ ...req(), onTranscript: t => { captured = t; } }, ws, new AbortController().signal);
    const e = obs(captured).find(x => x.command.includes('node huge'))!;
    expect(e).toBeDefined();
    expect(e.outputTruncated).toBe(true);
    expect(e.stdout.length).toBeLessThanOrEqual(6000);
    expect(validCoderTranscripts([captured!])).toBe(true);
  });

  test('comando recusado pela política registra observação refused com motivo, sem execução', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    let captured: CoderTranscript | undefined;
    const { fetchImpl } = scriptedFetch([execAction('curl', ['http://x']), fixEdit, submitAction()]);
    await backend(fetchImpl).edit({ ...req(), onTranscript: t => { captured = t; } }, ws, new AbortController().signal);
    const e = obs(captured).find(x => x.outcome === 'refused')!;
    expect(e).toBeDefined();
    expect(e.exitCode).toBeNull();
    expect(e.refusedReason && e.refusedReason.length > 0).toBe(true);
    expect(e.command).toContain('curl');
    expect(validCoderTranscripts([captured!])).toBe(true);
  });
});

describe('OllamaCoderBackend — reserva pós-edit ANCORADA (V3, Parte B)', () => {
  const initial = 'export const target = 1;\n';
  const wip = 'export const target = 1; // WIP\n';
  const editToWip = editFileAction('src/target.ts', sha256(initial), 'export const target = 1;', 'export const target = 1; // WIP');
  const editToFixed = editFileAction('src/target.ts', sha256(wip), 'export const target = 1; // WIP', 'export const target = 1; // FIXED');
  const fixEdit = editFileAction('src/target.ts', sha256(initial), 'export const target = 1;', 'export const target = 1; // FIXED');
  const policy = supervisedWorkspaceAccessPolicy(['src/target.ts'], ['src/secret.ts']);
  const cmd = resolveCommandExecutionPolicy('supervised');
  const vcmd = [{ label: 'gate', program: 'npm', args: ['test'] }] as const;
  const req = () => ({ objective: 'Corrigir', includedScope: ['src/target.ts'], excludedScope: ['src/secret.ts'], workspaceAccessPolicy: policy, commandPolicy: cmd, validationCommands: vcmd });

  test('B1: git diff pré-edit ALÉM da exploração é reorientado (não consome a reserva) e o reparo completo ainda cabe', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    // maxReadRounds=2: 1 read + 1 search esgotam a exploração; o git diff seguinte é PRÉ-EDIT
    // com orçamento 0 → reorientado (não toca a reserva pós-edit).
    const runtime2 = resolveAgenticRuntimePolicy({ mode: 'supervised', overrides: { maxReadRounds: 2 } });
    const { fetchImpl, sentBodies } = scriptedFetch([
      readAction('src/target.ts', 'target'),   // exploração 1/2
      searchAction('target'),                   // exploração 2/2 (orçamento esgotado)
      execAction('git', ['diff']),              // PRÉ-EDIT sem orçamento → reorientado
      editToWip,                                // 1ª edição material → ANCORA reserva (8 íntegra)
      execAction('npm', ['test']),              // vermelho
      editToFixed,                              // reparo
      execAction('npm', ['test']),              // verde
      execAction('git', ['diff']),              // self-review
      submitAction(),
    ]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: runtime2 })
      .edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(ws.files.get('src/target.ts')).toContain('FIXED');
    // O git diff pré-edit foi reorientado (não executado como self-review).
    expect(sentBodies.some(b => b.includes('orçamento de investigação esgotado'))).toBe(true);
  });

  test('B2: EDIT→TEST(vermelho)→EDIT→RETEST(verde)→DIFF→SUBMIT cabe na reserva', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const runtime = resolveAgenticRuntimePolicy({ mode: 'supervised', overrides: { maxReadRounds: 4 } });
    const { fetchImpl } = scriptedFetch([
      editToWip, execAction('npm', ['test']), editToFixed, execAction('npm', ['test']), execAction('git', ['diff']), submitAction(),
    ]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: runtime })
      .edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(ws.files.get('src/target.ts')).toContain('FIXED');
  });

  test('B3: submits prematuros (inválidos) pós-edit não drenam a reserva; TEST→DIFF→SUBMIT ainda conclui', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const runtime = resolveAgenticRuntimePolicy({ mode: 'supervised', overrides: { maxReadRounds: 2 } });
    const { fetchImpl } = scriptedFetch([
      fixEdit, submitAction(), submitAction(), submitAction(),   // 3 submits prematuros (bloqueados, não consomem rodada)
      execAction('npm', ['test']), execAction('git', ['diff']), submitAction(),
    ]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: runtime })
      .edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
  });

  test('B4: laço de ações inválidas pós-edit é BOUNDED e falha específico (não trava)', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const runtime = resolveAgenticRuntimePolicy({ mode: 'supervised', overrides: { maxReadRounds: 2 } });
    // Após a edição, só comandos recusados: reorientação bounded → conclui-ou-falha sem prova.
    const { fetchImpl } = scriptedFetch([
      fixEdit, execAction('curl', ['x']), execAction('curl', ['x']), execAction('curl', ['x']),
      execAction('curl', ['x']), execAction('curl', ['x']), execAction('curl', ['x']),
    ]);
    await expect(new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: runtime })
      .edit(req(), ws, new AbortController().signal))
      .rejects.toMatchObject({ code: 'ollama_submit_gate_unsatisfied' });
  });

  test('B5: tarefa SEM validationCommands preserva compat (submit disponível pós-edit)', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const runtime = resolveAgenticRuntimePolicy({ mode: 'supervised', overrides: { maxReadRounds: 3 } });
    const { fetchImpl } = scriptedFetch([fixEdit, submitAction()]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: runtime })
      .edit({ objective: 'x', includedScope: ['src/target.ts'], excludedScope: ['src/secret.ts'], workspaceAccessPolicy: policy, commandPolicy: cmd }, ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
  });

  test('B6: mesma lógica compartilhada (perfil REMOTO FORTE = OpenAI): reserva ancorada após exaurir leitura', async () => {
    const ws = execWorkspace({ 'src/target.ts': initial });
    const strong = resolveAgenticRuntimePolicy({ mode: 'supervised', profile: STRONG_REMOTE_AGENTIC_RUNTIME_PROFILE_V1 });
    const reads = Array.from({ length: strong.maxReadRounds }, () => readAction('src/target.ts', 'target'));
    const { fetchImpl } = scriptedFetch([
      ...reads,                                 // exaure TODO o orçamento de leitura
      editToWip, execAction('npm', ['test']),   // vermelho, já com exploração zerada
      editToFixed, execAction('npm', ['test']), // verde (reserva ancorada garante o caminho)
      execAction('git', ['diff']), submitAction(),
    ]);
    const result = await new OllamaCoderBackend({ model: 'x', fetchImpl, agenticRuntimePolicy: strong })
      .edit(req(), ws, new AbortController().signal);
    expect(result.touchedResources).toEqual(['src/target.ts']);
    expect(ws.files.get('src/target.ts')).toContain('FIXED');
  });
});
