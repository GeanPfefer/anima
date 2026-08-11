import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkPresentationView } from './WorkProposalCard';
import { ChatClient } from './ChatClient';

jest.mock('next/navigation',()=>({useRouter:()=>({refresh:jest.fn()})}));
jest.mock('react-markdown',()=>({__esModule:true,default:({children}:{children:string})=><>{children}</>}));

describe('hidratação conversacional',()=>{
  beforeEach(()=>{global.fetch=jest.fn();Element.prototype.scrollIntoView=jest.fn();});
  afterEach(()=>jest.restoreAllMocks());

  test('bloqueia envio até reconstruir mensagens, cartões e foco persistidos',async()=>{
    let resolveHistory!:(value:{ok:boolean;json:()=>Promise<unknown>})=>void;
    (global.fetch as jest.Mock).mockImplementation((input:string)=>{
      const url=String(input);
      if(url==='/api/ai/history')return new Promise(resolve=>{resolveHistory=resolve;});
      return Promise.resolve({ok:true,json:async()=>({ok:true,value:null})});
    });
    render(<ChatClient isFirstTime={false} userName="Ana"/>);
    expect(screen.getByRole('textbox')).toBeDisabled();
    resolveHistory({ok:true,json:async()=>[]});
    await waitFor(()=>expect(screen.getByRole('textbox')).toBeEnabled());
  });

  test('falha de hidratação mantém o envio fechado e explica a lacuna',async()=>{
    (global.fetch as jest.Mock).mockImplementation((input:string)=>String(input)==='/api/ai/history'?Promise.reject(new Error('offline')):Promise.resolve({ok:true,json:async()=>({ok:true,value:null})}));
    render(<ChatClient isFirstTime={false} userName="Ana"/>);
    expect(await screen.findByText(/Não foi possível reconstruir a conversa persistida/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});

describe('UX-04 — histórico e retomada pela conversa', () => {
  const baseItem = { userId:'user', sourceMessageId:'src', impactLevel:'low', capability:'programming', originalRequest:'pedido', intent:{}, proposal:{schemaVersion:1,data:{summary:'',objective:'obj',includedScope:[],excludedScope:[],expectedEffects:[],risks:[]}}, proposalVersion:1, createdAt:'2026-07-31T00:00:00Z', updatedAt:'2026-07-31T00:00:00Z' } as const;
  const reviewView = { item:{...baseItem,id:'item-review',state:'review',proposal:{...baseItem.proposal,data:{...baseItem.proposal.data,summary:'Trabalho pausado reencontrado'}}}, latestResult:{eventId:'e1',proposalVersion:1,author:'executor' as const,summary:'Resultado autônomo em revisão',references:[],validations:null,limitations:null,handoffReference:'runner:hx'}, acceptedResult:null, latestEventType:'result_submitted' as const, availableActions:['accept_result','request_result_changes'] as const } as unknown as WorkPresentationView;
  const completedView = { item:{...baseItem,id:'item-done',state:'completed',proposal:{...baseItem.proposal,data:{...baseItem.proposal.data,summary:'Trabalho concluído (só histórico)'}}}, latestResult:null, acceptedResult:{eventId:'e2',proposalVersion:1,author:'executor' as const,summary:'Aceito',references:[],validations:null,limitations:null,handoffReference:null}, latestEventType:'result_accepted' as const, availableActions:[] as const } as unknown as WorkPresentationView;

  function chatResponse(headers: Record<string,string>) {
    let sent = false;
    return { ok:true, headers:{ get:(k:string)=>headers[k] ?? null }, json:async()=>({}),
      body:{ getReader:()=>({ read: async () => sent ? { done:true, value:undefined } : (sent = true, { done:false, value:new TextEncoder().encode('ok') }) }) } } as unknown as Response;
  }

  function mountWithHistory(presentations: WorkPresentationView[]) {
    (global.fetch as jest.Mock).mockImplementation((input: string) => {
      const url = String(input);
      if (url === '/api/ai/history') return Promise.resolve({ ok:true, json: async () => [] });
      if (url === '/api/work-orchestration/focus') return Promise.resolve({ ok:true, json: async () => ({ ok:true, value:null }) });
      if (url === '/api/ai/chat') return Promise.resolve(chatResponse({ 'X-Source-Message-Id':'msg-1', 'X-Work-Orchestration': encodeURIComponent(JSON.stringify({ kind:'work_history', sourceMessageId:'msg-1', presentations })) }));
      return Promise.resolve({ ok:true, json: async () => ({ ok:true, value:null }) });
    });
  }

  beforeEach(()=>{ global.fetch=jest.fn(); Element.prototype.scrollIntoView=jest.fn(); });
  afterEach(()=>jest.restoreAllMocks());

  test('uma consulta lista os trabalhos abertos reencontrados como cartões acionáveis', async () => {
    mountWithHistory([reviewView, completedView]);
    render(<ChatClient isFirstTime={false} userName="Ana"/>);
    await waitFor(()=>expect(screen.getByRole('textbox')).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target:{ value:'quais trabalhos tenho em aberto?' } });
    fireEvent.click(screen.getByRole('button',{ name:'↑' }));
    // O trabalho pausado reencontrado aparece com a ação real de revisão…
    expect(await screen.findByText('Trabalho pausado reencontrado')).toBeInTheDocument();
    expect(screen.getByRole('button',{ name:'Aceitar resultado v1' })).toBeInTheDocument();
    // …e o item terminal reaparece como histórico, sem ação repetível.
    expect(screen.getByText('Trabalho concluído (só histórico)')).toBeInTheDocument();
    expect(screen.queryByRole('button',{ name:/Aceitar resultado v1/ })).toBeInTheDocument(); // do item em review
    expect(screen.queryByRole('button',{ name:/Aceitar resultado v2/ })).not.toBeInTheDocument();
  });

  test('lista vazia não inventa cartão', async () => {
    mountWithHistory([]);
    render(<ChatClient isFirstTime={false} userName="Ana"/>);
    await waitFor(()=>expect(screen.getByRole('textbox')).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target:{ value:'meus trabalhos' } });
    fireEvent.click(screen.getByRole('button',{ name:'↑' }));
    await waitFor(()=>expect(global.fetch).toHaveBeenCalledWith('/api/ai/chat', expect.objectContaining({ method:'POST' })));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

describe('correção 3 — turno órfão e retry idempotente', () => {
  function chatOk(headers: Record<string,string>) {
    let sent = false;
    return { ok:true, headers:{ get:(k:string)=>headers[k] ?? null }, json:async()=>({}),
      body:{ getReader:()=>({ read: async () => sent ? { done:true, value:undefined } : (sent = true, { done:false, value:new TextEncoder().encode('resposta') }) }) } } as unknown as Response;
  }
  beforeEach(()=>{ global.fetch=jest.fn(); Element.prototype.scrollIntoView=jest.fn(); });
  afterEach(()=>jest.restoreAllMocks());

  test('reload com mensagem órfã: reconstrói do servidor e oferece retry pelo id (sem duplicar)', async () => {
    const chatBodies: Record<string, unknown>[] = [];
    (global.fetch as jest.Mock).mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/ai/history') return Promise.resolve({ ok:true, json: async () => [{ id:'u1', role:'user', content:'pergunta órfã' }] });
      if (url === '/api/work-orchestration/focus') return Promise.resolve({ ok:true, json: async () => ({ ok:true, value:null }) });
      if (url.startsWith('/api/work-orchestration/items/by-source/')) return Promise.resolve({ ok:true, json: async () => ({ ok:true, value:[] }) });
      if (url === '/api/ai/chat') { chatBodies.push(JSON.parse(String(init?.body))); return Promise.resolve(chatOk({ 'X-Source-Message-Id':'u1' })); }
      return Promise.resolve({ ok:true, json: async () => ({ ok:true, value:null }) });
    });
    render(<ChatClient isFirstTime={false} userName="Ana"/>);
    // O turno órfão é reconstruído do servidor: a mensagem segue visível e há retry.
    expect(await screen.findByText('pergunta órfã')).toBeInTheDocument();
    const retryBtn = await screen.findByRole('button', { name: 'Tentar responder novamente' });
    fireEvent.click(retryBtn);
    await waitFor(() => expect(chatBodies.length).toBe(1));
    // Retry idempotente: reenvia o MESMO turno pelo id — não cria nova mensagem.
    expect(chatBodies[0]).toMatchObject({ message: 'pergunta órfã', retryMessageId: 'u1' });
  });

  test('falha no chat mantém a mensagem do usuário e oferece retry (sem silêncio)', async () => {
    (global.fetch as jest.Mock).mockImplementation((input: string) => {
      const url = String(input);
      if (url === '/api/ai/history') return Promise.resolve({ ok:true, json: async () => [] });
      if (url === '/api/work-orchestration/focus') return Promise.resolve({ ok:true, json: async () => ({ ok:true, value:null }) });
      if (url === '/api/ai/chat') return Promise.resolve({ ok:false, json: async () => ({ error: 'provedor indisponível' }) });
      if (url === '/api/ai/turns/abandon') return Promise.resolve({ ok:true, json: async () => ({}) });
      return Promise.resolve({ ok:true, json: async () => ({ ok:true, value:null }) });
    });
    render(<ChatClient isFirstTime={false} userName="Ana"/>);
    await waitFor(()=>expect(screen.getByRole('textbox')).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target:{ value:'minha pergunta' } });
    fireEvent.click(screen.getByRole('button',{ name:'↑' }));
    // A mensagem do usuário permanece; erro e retry visíveis — nunca fica órfã em silêncio.
    expect(await screen.findByText('minha pergunta')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Tentar responder novamente' })).toBeInTheDocument();
  });
});

describe('superfície de autodesenvolvimento do Anima', () => {
  beforeEach(() => { global.fetch = jest.fn(); Element.prototype.scrollIntoView = jest.fn(); });
  afterEach(() => jest.restoreAllMocks());

  const chatStream = (headers: Record<string, string> = {}) => {
    let sent = false;
    return { ok: true, headers: { get: (k: string) => headers[k] ?? null }, json: async () => ({}),
      body: { getReader: () => ({ read: async () => sent ? { done: true, value: undefined } : (sent = true, { done: false, value: new TextEncoder().encode('ok') }) }) } } as unknown as Response;
  };

  function mount(devAuthorized: boolean, chatBodies: Record<string, unknown>[]) {
    (global.fetch as jest.Mock).mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/ai/history') return Promise.resolve({ ok: true, json: async () => [] });
      if (url === '/api/work-orchestration/focus') return Promise.resolve({ ok: true, json: async () => ({ ok: true, value: null }) });
      if (url === '/api/ai/chat') { chatBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>); return Promise.resolve(chatStream({ 'X-Source-Message-Id': 'u1' })); }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, value: null }) });
    });
    render(<ChatClient isFirstTime={false} userName="Ana" devAuthorized={devAuthorized} />);
  }

  test('não autorizado (padrão): o modo não existe na UI', async () => {
    mount(false, []);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    expect(screen.queryByRole('button', { name: /Dev do Anima/ })).not.toBeInTheDocument();
  });

  test('autorizado: ativar mostra o aviso e envia developmentMode:true + GPT somente nessa superfície', async () => {
    const bodies: Record<string, unknown>[] = [];
    mount(true, bodies);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    // O aviso só aparece após uma ação humana consciente.
    expect(screen.queryByText(/Modo desenvolvimento do Anima ativo/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dev do Anima/ }));
    expect(await screen.findByText(/Modo desenvolvimento do Anima ativo/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Refatore uma função pura no código do core.' } });
    fireEvent.click(screen.getByRole('button', { name: '↑' }));
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0]).toMatchObject({ developmentMode: true, provider: 'openai' });
  });

  test('autorizado com o modo desligado: chat comum, nunca envia developmentMode', async () => {
    const bodies: Record<string, unknown>[] = [];
    mount(true, bodies);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Como estão meus pilares?' } });
    fireEvent.click(screen.getByRole('button', { name: '↑' }));
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0]?.developmentMode).toBeUndefined();
  });
});
