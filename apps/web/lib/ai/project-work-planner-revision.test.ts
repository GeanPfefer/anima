import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkItem } from '@anima/core';
import { includedScopeAnchoredInProject, parseProposal, type ProjectWorkPlanner } from './project-work-planner-shared';
import { planExecutableProjectWorkRevision } from './project-work-planner';

// Barreira real (2026-09-25, item 2c7afe1d, pedido GET /api/dev-readiness): a ancoragem
// recusava todo arquivo novo em PASTA nova (rota Next.js), então o planner recuava para
// arquivos existentes não relacionados (identity/*, items/route.ts). A revisão pedida
// pelo humano (escopo real, 1 tentativa) era impossível de expressar honestamente.

describe('includedScopeAnchoredInProject — topologia real', () => {
  const root = mkdtempSync(join(tmpdir(), 'anima-anchor-'));
  mkdirSync(join(root, 'apps', 'web', 'app', 'api', 'identity', 'status'), { recursive: true });
  writeFileSync(join(root, 'apps', 'web', 'app', 'api', 'identity', 'status', 'route.ts'), '');

  test('arquivo existente e arquivo novo em pasta existente continuam aceitos', () => {
    expect(includedScopeAnchoredInProject(['apps/web/app/api/identity/status/route.ts'], root)).toBe(true);
    expect(includedScopeAnchoredInProject(['apps/web/app/api/identity/status/route.test.ts'], root)).toBe(true);
  });
  test('rota nova: arquivo e teste em UMA pasta nova sob diretório existente são aceitos', () => {
    expect(includedScopeAnchoredInProject([
      'apps/web/app/api/dev-readiness/route.ts', 'apps/web/app/api/dev-readiness/route.test.ts',
    ], root)).toBe(true);
  });
  test('pasta inventada em mais de um nível continua recusada', () => {
    expect(includedScopeAnchoredInProject(['apps/web/app/api/nova/sub/route.ts'], root)).toBe(false);
  });
  test('pasta nova na raiz do repositório continua recusada (ex.: src/parser.ts copiado de exemplo)', () => {
    expect(includedScopeAnchoredInProject(['src/parser.ts'], root)).toBe(false);
  });
  test('path inseguro continua recusado antes da topologia', () => {
    expect(includedScopeAnchoredInProject(['../fora.ts'], root)).toBe(false);
  });
});

describe('parseProposal — max_attempts estrutural', () => {
  const base = {
    summary: 's', objective: 'o', included_scope: ['apps/web/a.ts'], excluded_scope: ['x'], expected_effects: ['e'], risks: ['r'],
    validation_label: 'v', validation_command: 'npm test -- a.test.ts', validation_covers: ['e'], additional_validations: [],
  };
  test('aceita 1–3 e ausência (default do host)', () => {
    expect(parseProposal(JSON.stringify({ ...base, max_attempts: 1 }))?.max_attempts).toBe(1);
    expect(parseProposal(JSON.stringify(base))?.max_attempts).toBeUndefined();
  });
  test('recusa teto fora da faixa', () => {
    expect(parseProposal(JSON.stringify({ ...base, max_attempts: 0 }))).toBeNull();
    expect(parseProposal(JSON.stringify({ ...base, max_attempts: 5 }))).toBeNull();
  });
});

describe('planExecutableProjectWorkRevision — ciclo v1 → correção → v2', () => {
  const v1: WorkItem = {
    id: 'w1', userId: 'u', sourceMessageId: 'm1', state: 'proposed', impactLevel: 'structural', capability: 'programming',
    originalRequest: 'Quero implementar GET /api/dev-readiness',
    intent: { execution_spec: { validation_criteria: [{ label: 'build', command: 'npm run build' }], limits: { max_attempts: 3, max_duration_minutes: 30 } } },
    proposal: { schemaVersion: 1, data: {
      summary: 'v1', objective: 'Criar GET /api/dev-readiness', includedScope: ['apps/web/app/api/identity/status/route.ts', 'apps/web/cli/identity.ts'],
      excludedScope: ['apps/mobile'], expectedEffects: ['rota responde'], risks: ['r'],
    } },
    proposalVersion: 1, createdAt: new Date(), updatedAt: new Date(),
  } as WorkItem;
  const feedback = 'Inclua a rota e o teste corretos; máximo de 1 attempt; teste focal.';
  const revisedArgs = {
    summary: 'v2', objective: 'Criar GET /api/dev-readiness com teste focal',
    included_scope: ['apps/web/app/api/work-orchestration/items/route.ts'], // existente ⇒ ancorado no checkout real
    excluded_scope: ['apps/mobile'], expected_effects: ['rota responde'], risks: ['r'],
    validation_label: 'teste focal', validation_command: 'npm test -- route.test.ts', validation_covers: ['rota responde'],
    validation_claim_kind: 'substantive', validation_target_paths: [], max_attempts: 1, additional_validations: [],
  };
  const fakePlanner = (args: unknown): ProjectWorkPlanner & { messages: string[] } => {
    const messages: string[] = [];
    return { id: 'fake', messages, proposeArguments: async (message: string) => { messages.push(message); return { ok: true, rawArguments: JSON.stringify(args) }; } };
  };

  test('o planner recebe o pedido original, a proposta v1 e o feedback humano', async () => {
    const planner = fakePlanner(revisedArgs);
    await planExecutableProjectWorkRevision(v1, feedback, planner);
    const [message] = planner.messages;
    expect(message).toContain('Quero implementar GET /api/dev-readiness');
    expect(message).toContain('Proposta anterior (v1)');
    expect(message).toContain('apps/web/cli/identity.ts');
    expect(message).toContain(feedback);
  });

  test('materializa uma revisão real: escopo novo e max_attempts pedido no CAMPO estruturado', async () => {
    const result = await planExecutableProjectWorkRevision(v1, feedback, fakePlanner(revisedArgs));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision.requestedChanges).toBe(feedback);
    expect(result.revision.proposal.data.includedScope).toEqual(['apps/web/app/api/work-orchestration/items/route.ts']);
    expect(result.revision.intent).toMatchObject({ execution_spec: { limits: { max_attempts: 1 } } });
  });

  test('reenviar a MESMA proposta não gera nova versão (e não destrói v1)', async () => {
    const same = {
      ...revisedArgs, summary: 'v1', objective: 'Criar GET /api/dev-readiness',
      included_scope: ['apps/web/app/api/work-orchestration/items/route.ts'], max_attempts: 3,
      validation_label: 'build', validation_command: 'npm run build', validation_covers: ['rota responde'],
    };
    const first = await planExecutableProjectWorkRevision(v1, feedback, fakePlanner(same));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const current = { ...v1, intent: first.revision.intent, proposal: first.revision.proposal } as WorkItem;
    const again = await planExecutableProjectWorkRevision(current, feedback, fakePlanner(same));
    expect(again).toEqual({ ok: false, message: expect.stringContaining('mesma proposta') });
  });

  test('falha do planner devolve erro sem produzir revisão (v1 e pedido intactos no caller)', async () => {
    const failing: ProjectWorkPlanner = { id: 'fail', proposeArguments: async () => ({ ok: false, message: 'modelo indisponível' }) };
    await expect(planExecutableProjectWorkRevision(v1, feedback, failing)).resolves.toEqual({ ok: false, message: 'modelo indisponível' });
  });
});
