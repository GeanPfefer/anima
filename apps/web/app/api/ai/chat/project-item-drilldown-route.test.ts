import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('fronteira read-only do item drill-down', () => {
  const source = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');
  const start = source.indexOf('if (isProjectItemDrilldownQuestion(message) || isConversationalItemReferenceQuestion(message))');
  const end = source.indexOf('// SELF_UNDERSTANDING / PROJECT_ADVISOR_V0');
  const branch = source.slice(start, end);

  test('executa antes do Advisor global e dos detectores/gravadores do chat', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(start).toBeLessThan(source.indexOf('detectActivities(message'));
  });

  test('a bifurcação contém somente leituras Supabase e declara mutation none', () => {
    expect(branch).toContain(".from('work_items').select(");
    expect(branch).toContain(".from('work_events').select(");
    expect(branch).toContain(".from('work_focus').select(");
    expect(branch).not.toMatch(/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
    expect(branch).toContain("'X-Anima-Mutation': 'none'");
  });

  test('payload bruto nunca é adicionado diretamente ao contexto do provider', () => {
    expect(branch).toContain('buildProjectAdvisorContext(projectResolvedItemQuestion(projection.itemRef)');
    expect(branch).not.toContain('buildProjectAdvisorContext(message');
    expect(branch).toContain('projectItemDrilldownStateForContext(projection)');
    expect(branch).toContain('projectItemDrilldownEvidenceForContext(projection)');
    expect(branch).not.toMatch(/content:\s*(?:eventRows|itemRow|projection\.timeline)/);
  });

  test('item invisível ou inexistente devolve erro JSON compreensível para a UI', () => {
    expect(branch).toContain("return Response.json({ error: 'Não encontrei um item visível e inequívoco");
    expect(branch).toContain('status: 404');
  });

  test('referência contextual é validada antes da leitura e RLS continua na leitura fresh', () => {
    expect(branch).toContain('parsePresentedItemReferences(requestedPresentedItemReferences)');
    expect(branch).toContain('resolveConversationalItemReference(message, presented)');
    expect(branch).toContain(".eq('user_id', user.id).eq('id', resolution.itemId).single()");
    expect(branch).toContain("itemRead.error?.code === 'PGRST116'");
    expect(branch).toContain('não está mais visível para esta conta');
    expect(branch).toContain("resolution.basis === 'conversational_reference'");
  });
});

describe('fronteira read-only do Project Advisor global', () => {
  const source = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');
  const start = source.indexOf('if (isProjectAdvisorQuestion(message))');
  const end = source.indexOf('// ── Contexto do usuário');
  const branch = source.slice(start, end);

  test('bifurca antes do provider pessoal, detectores e persistência do chat', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(start).toBeLessThan(source.indexOf('detectActivities(message'));
    expect(start).toBeLessThan(source.indexOf(".from('ai_conversations')"));
  });

  test('usa somente projeções read-only e não aciona backlog, foco ou coder', () => {
    expect(branch).toContain(".from('work_items')");
    expect(branch).toContain(".from('work_events')");
    expect(branch).toContain(".from('work_focus')");
    expect(branch).not.toMatch(/\.(?:insert|update|upsert|delete|rpc)\s*\(/);
    expect(branch).not.toContain(".from('ai_conversations')");
    expect(branch).not.toMatch(/coder|supervisor|backlog/i);
    expect(branch).toContain("'X-Anima-Mutation': 'none'");
  });
});
