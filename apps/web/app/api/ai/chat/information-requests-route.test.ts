import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyWorkFocusIntent, interpretWorkRequest, isWorkContinuation } from '@anima/core';
import { classifyDevelopmentChatIntent } from '@/lib/ai/development-chat-intent';
import { buildDevelopmentSystemPrompt } from '@/lib/ai/chat-dev-prompt';

// ACC-01-FIX-04 — consultas não mutam: classificação do Chat Dev + fronteira da rota.
const LIVE_PROOF_QUESTION =
  'Quero analisar o desenvolvimento do ANIMA como um todo. Quais trabalhos continuam abertos, quais estão em revisão e quais dependem de alguma decisão minha? Consulte os registros disponíveis, explique as prioridades e diferencie fatos confirmados de recomendações.';

const QUERIES = [
  LIVE_PROOF_QUESTION,
  'Quais trabalhos precisam da minha aprovação?',
  'O que devemos implementar primeiro?',
  'Como corrigiríamos esse problema?',
  'Compare Codex e Claude Code.',
  'Qual trabalho está em foco?',
] as const;

describe('consultas do Chat Dev nunca produzem trabalho novo, comando de fila ou mutação de foco', () => {
  test.each(QUERIES)('%s', message => {
    const intent = classifyDevelopmentChatIntent({ message });
    expect(intent.kind).not.toBe('new_work_request');
    expect(intent.kind).not.toBe('autonomous_queue_command');
    expect(interpretWorkRequest(message, 'src').kind).toBe('conversation');
    expect(isWorkContinuation(message)).toBe(false);
    const focus = classifyWorkFocusIntent(message);
    expect(focus.kind === 'none' || focus.kind === 'focus_query').toBe(true);
  });
});

describe('pedidos explícitos seguem no caminho governado de proposta', () => {
  test.each([
    'Crie uma proposta para corrigir o bug do parser no código da api.',
    'Prepare um mandato para implementar o endpoint de readiness na api.',
  ])('%s', message => {
    expect(classifyDevelopmentChatIntent({ message }).kind).toBe('new_work_request');
  });

  test('"Continue o trabalho X" é continuação (existing_item_command/referência), nunca novo trabalho', () => {
    const intent = classifyDevelopmentChatIntent({ message: 'Continue o trabalho fad07a1f' });
    expect(intent.kind).not.toBe('new_work_request');
    expect(isWorkContinuation('Continue o trabalho fad07a1f')).toBe(true);
  });
});

describe('fronteira da rota do chat', () => {
  const source = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');

  test('createProposal só existe dentro do ramo work_candidate e uma única vez', () => {
    expect(source.match(/createProposal\(/g)).toHaveLength(1);
    const create = source.indexOf('createProposal(');
    const gate = source.lastIndexOf("if (interpretation.kind === 'work_candidate')", create);
    expect(gate).toBeGreaterThan(0);
    expect(create - gate).toBeLessThan(900);
  });

  test('o planner (provider pago) só roda para work_candidate', () => {
    const planner = source.indexOf('planExecutableProjectWork(');
    const guard = source.lastIndexOf("rawInterpretation.kind === 'work_candidate'", planner);
    expect(guard).toBeGreaterThan(0);
    expect(planner - guard).toBeLessThan(900);
  });

  test('o ramo de consulta (conversation) não cria, aprova, executa nem anexa contexto', () => {
    const history = source.indexOf("} else if(interpretation.kind==='conversation'&&isWorkHistoryQuery(message))");
    const continuation = source.indexOf("else if(interpretation.kind==='conversation'&&isWorkContinuation(message))");
    expect(history).toBeGreaterThan(0);
    const readBranch = source.slice(history, continuation);
    expect(readBranch).not.toMatch(/createProposal|attachContext|resolveApproval|startWork|\.rpc\(|\.insert\(/);
  });
});

describe('formatação das respostas do Chat Dev', () => {
  test('o prompt proíbe tabelas Markdown (o chat renderiza CommonMark sem GFM)', () => {
    const prompt = buildDevelopmentSystemPrompt({ name: 'Gean', brief: '' });
    expect(prompt).toMatch(/NÃO use tabelas Markdown/);
  });

  test('defeito demonstrado: react-markdown 10 sem remark-gfm não está configurado para tabelas', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../../package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.['react-markdown']).toBeDefined();
    expect(pkg.dependencies?.['remark-gfm']).toBeUndefined();
    const client = readFileSync(resolve(__dirname, '../../../(app)/chat/_components/ChatClient.tsx'), 'utf8');
    expect(client).toContain('<ReactMarkdown>{m.content}</ReactMarkdown>');
  });
});
