import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyDevelopmentChatIntent } from '@/lib/ai/development-chat-intent';

const REAL_NEW_WORK_MESSAGES = [
  'Quero corrigir um bug de fronteira no getEraForLevel: abaixo de MIN_LEVEL deve continuar retornando a primeira era e acima de MAX_LEVEL deve retornar a última era. Adicione cobertura explícita para esses dois limites. Limite a mudança a packages/core/src/levels.ts e packages/core/src/levels.test.ts.',
  'Não estou me referindo a nenhum work item existente. Quero criar um novo trabalho de programação, independente dos itens anteriores, para corrigir o bug de fronteira em getEraForLevel. Abaixo de MIN_LEVEL deve continuar retornando a primeira era e acima de MAX_LEVEL deve retornar a última era. Adicione cobertura explícita para esses dois limites. Limite a mudança a packages/core/src/levels.ts e packages/core/src/levels.test.ts. Não reutilize, retome ou selecione nenhum item completed/cancelled existente. Crie uma nova proposta para este trabalho.',
] as const;

describe('fronteira read-only do item drill-down', () => {
  const source = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');
  const start = source.indexOf("developmentIntent?.kind === 'existing_item_reference'");
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

describe('seleção autônoma antes do drill-down conservador', () => {
  const source = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');
  const autonomous = source.indexOf("if (developmentIntent?.kind === 'autonomous_queue_command')");
  const drilldown = source.indexOf("developmentIntent?.kind === 'existing_item_reference'");
  const branch = source.slice(autonomous, drilldown);

  test('só habilita com Dev e não depende do provider GPT/Local', () => {
    expect(autonomous).toBeGreaterThan(0);
    expect(autonomous).toBeLessThan(drilldown);
    expect(branch).not.toMatch(/provider\s*===|createProjectAdvisor|streamChatProvider/);
  });

  test('é read-only e não dispara execução', () => {
    expect(branch).toContain("'X-Anima-Mutation': 'none'");
    expect(branch).not.toMatch(/\.(?:insert|update|upsert|delete)\s*\(/);
    expect(branch).not.toMatch(/claim|coder|startExecution|supervisor/);
  });
});

describe('fronteira read-only do Project Advisor global', () => {
  const source = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');
  const start = source.indexOf("if (developmentIntent?.kind === 'project_query'");
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

describe('governança conversacional precede providers sem virar execução', () => {
  const source = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');
  const governance = source.indexOf('const governedDecision = await processProjectConversationGovernance');
  test('boundary vem antes de drill-down, Advisor e chat pessoal', () => {
    expect(governance).toBeGreaterThan(0);
    expect(governance).toBeLessThan(source.indexOf("developmentIntent?.kind === 'existing_item_reference'"));
    expect(governance).toBeLessThan(source.indexOf("if (developmentIntent?.kind === 'project_query'"));
    expect(governance).toBeLessThan(source.indexOf('detectActivities(message'));
  });
  test('resposta governada retorna sem work item, foco, coder ou supervisor', () => {
    const end = source.indexOf('// Mandato estreito do Dev');
    const branch = source.slice(governance, end);
    expect(branch).toContain("'X-Anima-Mutation': 'project-decision-only'");
    expect(branch).not.toMatch(/work_items|work_focus|coder|supervisor|resolve_approval/i);
  });
});

describe('precedência semântica de nova solicitação Dev', () => {
  const source = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');

  test.each(REAL_NEW_WORK_MESSAGES)('mensagem real evita handlers existentes e segue ao planner: %s', message => {
    expect(classifyDevelopmentChatIntent({ message }).kind).toBe('new_work_request');
  });

  test('a route classifica uma vez antes dos handlers e reutiliza a interpretação apó persistir', () => {
    const classification = source.indexOf('const developmentIntent = developmentMode');
    const autonomous = source.indexOf("if (developmentIntent?.kind === 'autonomous_queue_command')");
    const drilldown = source.indexOf("developmentIntent?.kind === 'existing_item_reference'");
    const bindSource = source.indexOf("developmentIntent?.kind === 'new_work_request'");
    const planner = source.indexOf('const planned = await planExecutableProjectWork');
    const createProposal = source.indexOf('.createProposal(interpretation.command)');
    expect(classification).toBeGreaterThan(0);
    expect(classification).toBeLessThan(autonomous);
    expect(classification).toBeLessThan(drilldown);
    expect(bindSource).toBeGreaterThan(drilldown);
    expect(bindSource).toBeLessThan(planner);
    expect(planner).toBeLessThan(createProposal);
    expect(source).toContain("developmentIntent?.kind === 'autonomous_queue_command'");
    expect(source).toContain("developmentIntent?.kind === 'existing_item_reference'");
  });
});
