import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkPresentationView } from './WorkProposalCard';
import { WorkProposalCard } from './WorkProposalCard';
const item = { id:'item',userId:'user',sourceMessageId:'message',state:'proposed',impactLevel:'significant',capability:'programming',originalRequest:'pedido',intent:{},proposal:{schemaVersion:1,data:{summary:'Construir tela',objective:'Criar uma tela segura',includedScope:['Tela'],excludedScope:['Execução'],expectedEffects:['Proposta'],risks:['Escopo']}},proposalVersion:2,createdAt:'2026-07-14T00:00:00Z',updatedAt:'2026-07-14T00:00:00Z' } as const;
const presentation = (overrides: Partial<WorkPresentationView> = {}): WorkPresentationView => ({ item, latestResult:null, acceptedResult:null, latestEventType:null, availableActions:['approve','reject','defer','revise_proposal'], ...overrides });
const result = { eventId:'e1', proposalVersion:2, author:'user' as const, summary:'Resumo apresentado', references:['docs/prova.md'], validations:null, limitations:null, handoffReference:null };
describe('WorkProposalCard', () => {
  beforeEach(() => { global.fetch = jest.fn().mockResolvedValue({ ok:true, json:async()=>({ok:true,value:{presentation:presentation()}}) }) as jest.Mock; });
  test('renderiza proposta e versão apresentadas', () => { render(<WorkProposalCard presentation={presentation()} onChange={jest.fn()} />); expect(screen.getByText('Construir tela')).toBeInTheDocument(); expect(screen.getByText('proposed · v2')).toBeInTheDocument(); expect(screen.getByText('Aguardando sua decisão.')).toBeInTheDocument(); });
  test('envia aprovação uma única vez enquanto carrega', async () => { let resolveResponse!: (value: unknown) => void; (global.fetch as jest.Mock).mockReturnValue(new Promise(resolve => { resolveResponse = resolve; })); render(<WorkProposalCard presentation={presentation()} onChange={jest.fn()} />); const button=screen.getByRole('button',{name:'Aprovar'}); fireEvent.click(button); fireEvent.click(button); expect(global.fetch).toHaveBeenCalledTimes(1); await waitFor(()=>expect(button).toBeDisabled()); resolveResponse({ok:true,json:async()=>({ok:true,value:{presentation:presentation()}})}); });
  test('ações vêm da projeção e não do estado local', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'approved'},availableActions:['start']})} onChange={jest.fn()} />); expect(screen.queryByRole('button',{name:'Aprovar'})).not.toBeInTheDocument(); expect(screen.getByRole('button',{name:'Iniciar execução manual'})).toBeInTheDocument(); });
  test('inicia a execução manual aprovada', async () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'approved'},availableActions:['start']})} onChange={jest.fn()} />); fireEvent.click(screen.getByRole('button',{name:'Iniciar execução manual'})); await waitFor(()=>expect(global.fetch).toHaveBeenCalledWith('/api/work-orchestration/start',expect.objectContaining({method:'POST'}))); });
  test('explica que o ciclo manual não será assumido pelo Supervisor', () => {
    render(<WorkProposalCard presentation={presentation({item:{...item,state:'approved'},availableActions:['start']})} onChange={jest.fn()} />);
    expect(screen.getByText(/No modo manual, você executa o trabalho e registra o resultado aqui/)).toBeInTheDocument();
    expect(screen.getByText(/O Supervisor não assumirá esse ciclo depois de iniciado/)).toBeInTheDocument();
  });
  test('orienta a concluir um trabalho manual já iniciado pelo registro de resultado', () => {
    render(<WorkProposalCard presentation={presentation({item:{...item,state:'in_progress'},availableActions:['submit_result']})} onChange={jest.fn()} />);
    expect(screen.getByText(/Execução manual em andamento/)).toHaveTextContent('registre o resultado abaixo');
    expect(screen.getByRole('button',{name:'Registrar resultado'})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Executar autonomamente'})).not.toBeInTheDocument();
  });
  test('inicia somente o trabalho e a versão explícitos no modo autônomo', async () => {
    const autonomousItem={...item,state:'approved' as const,intent:{execution_spec:{schema_version:1,target:{kind:'project',reference:'sup04-live'},permissions:['workspace_read','workspace_write_isolated'],validation_criteria:[{label:'npm test',command:'npm test'}],limits:{max_attempts:1,max_duration_minutes:5}}}};
    render(<WorkProposalCard presentation={presentation({item:autonomousItem,availableActions:['start']})} onChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button',{name:'Executar autonomamente'}));
    await waitFor(()=>expect(global.fetch).toHaveBeenCalledWith('/api/work-orchestration/supervisor-turn',expect.objectContaining({
      method:'POST',body:JSON.stringify({workItemId:'item',expectedProposalVersion:2}),
    })));
  });
  test('não oferece execução autônoma quando faltam alvos, permissões ou limites aprovados', () => {
    render(<WorkProposalCard presentation={presentation({item:{...item,state:'approved'},availableActions:['start']})} onChange={jest.fn()} />);
    expect(screen.queryByRole('button',{name:'Executar autonomamente'})).not.toBeInTheDocument();
  });
  test('exibe resumo, autoria, referências e versão do resultado antes do aceite', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:result,availableActions:['accept_result','request_result_changes']})} onChange={jest.fn()} />); expect(screen.getByText('Resumo apresentado')).toBeInTheDocument(); expect(screen.getByText('user')).toBeInTheDocument(); expect(screen.getByText('docs/prova.md')).toBeInTheDocument(); expect(screen.getByRole('button',{name:'Aceitar resultado v2'})).toBeInTheDocument(); });
  test('aceite referencia o evento exato do resultado revisado', async () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:result,availableActions:['accept_result','request_result_changes']})} onChange={jest.fn()} />); fireEvent.click(screen.getByRole('button',{name:'Aceitar resultado v2'})); await waitFor(()=>expect(global.fetch).toHaveBeenCalledWith('/api/work-orchestration/reviews',expect.objectContaining({method:'POST',body:expect.stringContaining('"reviewedResultEventId":"e1"')}))); });
  test('exibe a referência de handoff do resultado autônomo em revisão (UX-03)', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:{...result,author:'executor' as const,handoffReference:'runner-bundle:ux03'},availableActions:['accept_result','request_result_changes']})} onChange={jest.fn()} />); expect(screen.getByText('Handoff')).toBeInTheDocument(); expect(screen.getByText('runner-bundle:ux03')).toBeInTheDocument(); });
  test('declara a ausência de referência de handoff sem inventá-la (UX-03)', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:result,availableActions:['accept_result','request_result_changes']})} onChange={jest.fn()} />); expect(screen.getByText('Nenhuma referência de handoff')).toBeInTheDocument(); });
  test('pedir correções no resultado exige texto e envia a decisão versionada (UX-03)', async () => {
    render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:result,availableActions:['accept_result','request_result_changes']})} onChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button',{name:'Pedir correções no resultado'}));
    const confirm=screen.getByRole('button',{name:'Confirmar correções'});
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Correções necessárias'),{target:{value:'Ajustar o tratamento de erro'}});
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(()=>expect(global.fetch).toHaveBeenCalledWith('/api/work-orchestration/reviews',expect.objectContaining({method:'POST',body:expect.stringContaining('"reviewedResultEventId":"e1"')})));
    const body=JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body.decision).toEqual({type:'request_changes',requestedChanges:'Ajustar o tratamento de erro'});
  });
  test('não permite aceitar sem resultado correspondente à versão', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:null,availableActions:[]})} onChange={jest.fn()} />); expect(screen.queryByRole('button',{name:/Aceitar resultado/})).not.toBeInTheDocument(); });
  test('declara ausência de validações, limitações e distingue relato de evidência', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:result,availableActions:['accept_result','request_result_changes']})} onChange={jest.fn()} />); expect(screen.getByText('Nenhuma validação registrada')).toBeInTheDocument(); expect(screen.getByText('Nenhuma limitação declarada')).toBeInTheDocument(); expect(screen.getByText(/não verificado automaticamente/)).toBeInTheDocument(); });
  test('exibe validações tipadas e riscos da proposta antes do aceite', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:{...result,validations:[{label:'npm test',outcome:'passed' as const},{label:'build web',outcome:'failed' as const}],limitations:['sem cobertura e2e']},availableActions:['accept_result','request_result_changes']})} onChange={jest.fn()} />); expect(screen.getByText('npm test — passou; build web — falhou')).toBeInTheDocument(); expect(screen.getByText('sem cobertura e2e')).toBeInTheDocument(); expect(screen.getByText('Escopo')).toBeInTheDocument(); });
  test('trabalho concluído preserva as evidências do resultado aceito', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'completed'},acceptedResult:{...result,validations:[{label:'npm test',outcome:'passed' as const}],limitations:['sem e2e']},availableActions:[]})} onChange={jest.fn()} />); expect(screen.getByText('Resultado aceito · v2')).toBeInTheDocument(); expect(screen.getByText('Resumo apresentado')).toBeInTheDocument(); expect(screen.getByText('docs/prova.md')).toBeInTheDocument(); expect(screen.getByText('npm test — passou')).toBeInTheDocument(); expect(screen.getByText('Resultado aceito e trabalho concluído; evidências preservadas acima.')).toBeInTheDocument(); });
  test('resultado aceito oferece decisões explícitas de integração',()=>{render(<WorkProposalCard presentation={presentation({item:{...item,state:'completed'},acceptedResult:result,availableActions:[],integration:{status:'awaiting_decision',acceptedResultEventId:'e1',decision:null,availableDecisions:['authorize','refuse']}})} onChange={jest.fn()}/>);expect(screen.getByRole('button',{name:'Autorizar integração'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Recusar integração'})).toBeInTheDocument();expect(screen.getByText(/não publica, envia, cria PR ou integra agora/)).toBeInTheDocument();});
  test.each([['Autorizar integração','authorize'],['Recusar integração','refuse']] as const)('%s envia resultado, versão e idempotência exatos',async(label,decision)=>{render(<WorkProposalCard presentation={presentation({item:{...item,state:'completed'},acceptedResult:result,availableActions:[],integration:{status:'awaiting_decision',acceptedResultEventId:'e1',decision:null,availableDecisions:['authorize','refuse']}})} onChange={jest.fn()}/>);fireEvent.click(screen.getByRole('button',{name:label}));await waitFor(()=>expect(global.fetch).toHaveBeenCalledWith('/api/work-orchestration/integration-decisions',expect.objectContaining({method:'POST'})));const body=JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);expect(body).toEqual({workItemId:'item',expectedProposalVersion:2,acceptedResultEventId:'e1',decision,decisionId:`integration:e1:${decision}`});});
  test('duplo clique envia uma única decisão enquanto a primeira está pendente',async()=>{let resolve!: (value:unknown)=>void;(global.fetch as jest.Mock).mockReturnValue(new Promise(value=>{resolve=value;}));render(<WorkProposalCard presentation={presentation({item:{...item,state:'completed'},acceptedResult:result,availableActions:[],integration:{status:'awaiting_decision',acceptedResultEventId:'e1',decision:null,availableDecisions:['authorize','refuse']}})} onChange={jest.fn()}/>);const button=screen.getByRole('button',{name:'Autorizar integração'});fireEvent.click(button);fireEvent.click(button);expect(global.fetch).toHaveBeenCalledTimes(1);resolve({ok:true,json:async()=>({ok:true,value:{}})});});
  test('autorização persistida não é exibida como integração concluída',()=>{render(<WorkProposalCard presentation={presentation({item:{...item,state:'completed'},acceptedResult:result,availableActions:[],integration:{status:'authorized',acceptedResultEventId:'e1',decision:'authorize',availableDecisions:[]}})} onChange={jest.fn()}/>);expect(screen.getByText(/aguardando publicação protegida/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:/integração/})).not.toBeInTheDocument();expect(screen.queryByText(/^Integrado$/)).not.toBeInTheDocument();});
  test('branch publicada mostra branch e SHA sem afirmar PR ou merge',()=>{render(<WorkProposalCard presentation={presentation({item:{...item,state:'completed'},acceptedResult:result,availableActions:[],integration:{status:'branch_published',acceptedResultEventId:'e1',decision:'authorize',availableDecisions:[],publication:{repositoryId:'repo',remoteName:'origin',remoteBranch:'anima-work/a1',commitSha:'b'.repeat(40)}}})} onChange={jest.fn()}/>);expect(screen.getByText('Branch publicada')).toBeInTheDocument();expect(screen.getByText(/anima-work\/a1.*bbbbbbb/)).toBeInTheDocument();expect(screen.getByText(/Nenhum PR foi criado/)).toBeInTheDocument();});
  test('review request criado mostra o PR sem afirmar merge e NUNCA nega o PR',()=>{render(<WorkProposalCard presentation={presentation({item:{...item,state:'completed'},acceptedResult:result,availableActions:[],integration:{status:'review_request_created',acceptedResultEventId:'e1',decision:'authorize',availableDecisions:[],publication:{repositoryId:'repo',remoteName:'origin',remoteBranch:'anima-work/a1',commitSha:'b'.repeat(40)},reviewRequest:{repositoryId:'repo',remoteName:'origin',reviewReference:'https://example.invalid/pull/42',reviewId:'42',sourceBranch:'anima-work/a1',sourceCommitSha:'b'.repeat(40),baseBranch:'main'}}})} onChange={jest.fn()}/>);expect(screen.getByText('Review request criado')).toBeInTheDocument();expect(screen.getByText(/pull\/42/)).toBeInTheDocument();expect(screen.getByText(/nada foi mergeado ou integrado/)).toBeInTheDocument();expect(screen.queryByText(/Nenhum PR foi criado/)).not.toBeInTheDocument();});
  test('falha HTTP não cria autorização otimista e reconcilia do servidor',async()=>{const current=presentation({item:{...item,state:'completed'},acceptedResult:result,availableActions:[],integration:{status:'awaiting_decision',acceptedResultEventId:'e1',decision:null,availableDecisions:['authorize','refuse']}});(global.fetch as jest.Mock).mockResolvedValueOnce({ok:false,json:async()=>({ok:false,error:{code:'version_conflict',message:'O item mudou.'}})}).mockResolvedValueOnce({ok:true,json:async()=>({ok:true,value:{presentation:current}})});const onChange=jest.fn();render(<WorkProposalCard presentation={current} onChange={onChange}/>);fireEvent.click(screen.getByRole('button',{name:'Autorizar integração'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('O item mudou.'));expect(onChange).toHaveBeenCalledWith(current);expect(global.fetch).toHaveBeenCalledTimes(2);});
  test('concluído sem evidências verificáveis não afirma sucesso com evidência', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'completed'},acceptedResult:null,availableActions:[]})} onChange={jest.fn()} />); expect(screen.getByText('Trabalho concluído, mas as evidências do resultado aceito não puderam ser verificadas.')).toBeInTheDocument(); expect(screen.queryByText(/Resultado aceito · v/)).not.toBeInTheDocument(); expect(screen.queryByText(/evidências preservadas/)).not.toBeInTheDocument(); });
  test('revisão com resultado não verificável declara o bloqueio do aceite', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:null,availableActions:[]})} onChange={jest.fn()} />); expect(screen.getByText('O resultado registrado não pôde ser verificado; o aceite permanece bloqueado até um novo envio.')).toBeInTheDocument(); expect(screen.queryByRole('button',{name:/Aceitar resultado/})).not.toBeInTheDocument(); });
  test('falha de execução nunca aparece como sucesso', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'failed'},availableActions:[]})} onChange={jest.fn()} />); expect(screen.getByText('A execução falhou; nenhum resultado foi aceito.')).toBeInTheDocument(); expect(screen.queryByText(/concluído/)).not.toBeInTheDocument(); expect(screen.queryByText(/Resultado aceito/)).not.toBeInTheDocument(); });
  test('resultado de versão anterior não habilita aceite mesmo presente na projeção', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:{...result,proposalVersion:1},availableActions:[]})} onChange={jest.fn()} />); expect(screen.queryByRole('button',{name:/Aceitar resultado/})).not.toBeInTheDocument(); });
  test('cartão em foco exibe o indicador e não oferece troca', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'in_progress'},availableActions:['submit_result']})} onChange={jest.fn()} focused onFocus={jest.fn()} />); expect(screen.getByText('Trabalho em foco')).toBeInTheDocument(); expect(screen.queryByRole('button',{name:'Usar como foco'})).not.toBeInTheDocument(); });
  test('cartão ativo fora de foco oferece troca explícita que aciona onFocus', () => { const onFocus=jest.fn(); render(<WorkProposalCard presentation={presentation({item:{...item,state:'in_progress'},availableActions:['submit_result']})} onChange={jest.fn()} onFocus={onFocus} />); fireEvent.click(screen.getByRole('button',{name:'Usar como foco'})); expect(onFocus).toHaveBeenCalledTimes(1); });
  test('cartão terminal não oferece troca de foco', () => { render(<WorkProposalCard presentation={presentation({item:{...item,state:'completed'},availableActions:[]})} onChange={jest.fn()} onFocus={jest.fn()} />); expect(screen.queryByRole('button',{name:'Usar como foco'})).not.toBeInTheDocument(); });
  test('decisão sobre versão obsoleta é recusada com mensagem e reconcilia para a versão vigente', async () => {
    const revised = presentation({ item: { ...item, proposalVersion: 3 }, availableActions: ['approve', 'reject', 'defer', 'revise_proposal'] });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false, error: { code: 'version_conflict', message: 'O item mudou desde a última leitura.' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, value: { presentation: revised } }) });
    const onChange = jest.fn();
    render(<WorkProposalCard presentation={presentation()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('O item mudou desde a última leitura.'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(revised));
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/work-orchestration/decisions', expect.objectContaining({ body: expect.stringContaining('"expectedProposalVersion":2') }));
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/work-orchestration/items/item');
  });
  test('cartão renderiza a versão exata recebida da projeção', () => {
    render(<WorkProposalCard presentation={presentation({ item: { ...item, proposalVersion: 3 } })} onChange={jest.fn()} />);
    expect(screen.getByText('proposed · v3')).toBeInTheDocument();
    expect(screen.getByLabelText('Trabalho, versão 3')).toBeInTheDocument();
  });
  test('correção envia somente o pedido, sem reescrever a proposta no cliente', async () => { render(<WorkProposalCard presentation={presentation()} onChange={jest.fn()} />); fireEvent.click(screen.getByRole('button',{name:'Pedir correção'})); fireEvent.change(screen.getByLabelText('O que deve mudar?'),{target:{value:'Reduzir o escopo'}}); fireEvent.click(screen.getByRole('button',{name:'Criar nova versão coerente'})); await waitFor(()=>expect(global.fetch).toHaveBeenCalledWith('/api/work-orchestration/proposal-corrections',expect.objectContaining({method:'POST',body:expect.stringContaining('"requestedChanges":"Reduzir o escopo"')}))); const body=JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string); expect(body.proposal).toBeUndefined(); expect(body.intent).toBeUndefined(); });
  const verification=(verdict:'verified'|'inconclusive'|'rejected',extra:Array<{code:string;severity:'ok'|'gap'|'violation';detail:string}>=[],rests=true)=>({schemaVersion:1 as const,verdict,workItemId:'item',attemptId:'attempt-1',approvedProposalVersion:2,findings:[{code:'correlation_verified',severity:'ok' as const,provenance:'independent' as const,detail:'ok'},...extra.map(f=>({...f,provenance:'attested' as const}))],summary:{violations:extra.filter(f=>f.severity==='violation').length,gaps:extra.filter(f=>f.severity==='gap').length,checks:1+extra.length,attested:extra.length,independent:1},restsOnAttestedEvidence:rests,advisory:true as const});
  test('exibe o parecer advisory sem alterar as ações de revisão', () => {
    render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:result,availableActions:['accept_result','request_result_changes'],verification:verification('verified') as unknown as WorkPresentationView['verification']})} onChange={jest.fn()} />);
    expect(screen.getByText(/Verificação independente \(advisory\)/)).toBeInTheDocument();
    expect(screen.getByText(/evidência suficiente e coerente/)).toBeInTheDocument();
    expect(screen.getByText(/não substitui a sua revisão/)).toBeInTheDocument();
    // Honestidade: verifica que o veredito repousa em evidência reportada pelo executor.
    expect(screen.getByText(/reportada pelo executor/)).toBeInTheDocument();
    expect(screen.getByText(/não é prova independente/)).toBeInTheDocument();
    // O parecer é read-only: as ações continuam vindo da projeção.
    expect(screen.getByRole('button',{name:'Aceitar resultado v2'})).toBeInTheDocument();
  });
  test('rejeição independente (ex.: correlação) não exibe o aviso de atestação', () => {
    render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:result,availableActions:['accept_result','request_result_changes'],verification:verification('rejected',[{code:'correlation_mismatch',severity:'violation',detail:'Correlação divergente.'}],false) as unknown as WorkPresentationView['verification']})} onChange={jest.fn()} />);
    expect(screen.queryByText(/reportada pelo executor/)).not.toBeInTheDocument();
  });
  test('parecer rejeitado lista as violações estruturadas', () => {
    render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:result,availableActions:['accept_result','request_result_changes'],verification:verification('rejected',[{code:'change_out_of_included_scope',severity:'violation',detail:'O arquivo "src/x.ts" foi alterado fora do escopo.'}]) as unknown as WorkPresentationView['verification']})} onChange={jest.fn()} />);
    expect(screen.getByText(/evidência de violação ou incoerência/)).toBeInTheDocument();
    expect(screen.getByText(/Violação: O arquivo "src\/x.ts" foi alterado fora do escopo\./)).toBeInTheDocument();
  });
  test('sem parecer, nenhum painel de verificação é exibido', () => {
    render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:result,availableActions:['accept_result','request_result_changes']})} onChange={jest.fn()} />);
    expect(screen.queryByText(/Verificação independente/)).not.toBeInTheDocument();
  });
  const resourceCost=(profiles:Array<{command:string;count:number;failureCount:number;durationMedianMs:number;predominantClass:'low'|'medium'|'high'|'unknown'}>)=>({
    distribution:{count:profiles.reduce((n,p)=>n+p.count,0),p50Ms:300,p90Ms:90000,maxMs:90000},
    profiles:profiles.map(p=>({key:{workloadKind:'gate' as const,command:p.command,repo:null},count:p.count,failureCount:p.failureCount,durationMedianMs:p.durationMedianMs,durationMaxMs:p.durationMedianMs,memObservedRange:null,predominantClass:p.predominantClass,lastObservedAt:'2026-08-17T12:00:00.000Z'})),
  });
  test('exibe o custo de recursos observado dos gates (read-only, sem alterar ações)', () => {
    render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:result,availableActions:['accept_result','request_result_changes'],resourceCost:resourceCost([{command:'npm run typecheck',count:9,failureCount:0,durationMedianMs:300,predominantClass:'low'},{command:'npm run test:e2e',count:3,failureCount:1,durationMedianMs:90000,predominantClass:'high'}]) as unknown as WorkPresentationView['resourceCost']})} onChange={jest.fn()} />);
    expect(screen.getByText(/Custo de recursos observado \(gates\)/)).toBeInTheDocument();
    expect(screen.getByText(/não decide, não bloqueia/)).toBeInTheDocument();
    expect(screen.getByText(/npm run typecheck — 9× · mediana 300 ms · custo baixo/)).toBeInTheDocument();
    expect(screen.getByText(/npm run test:e2e — 3× · mediana 90\.0 s · custo alto · 1 falha\(s\)/)).toBeInTheDocument();
    // Read-only: as ações continuam vindo da projeção.
    expect(screen.getByRole('button',{name:'Aceitar resultado v2'})).toBeInTheDocument();
  });
  test('sem custo observado (projeção ausente ou sem perfis), nenhum painel de custo aparece', () => {
    render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:result,availableActions:['accept_result']})} onChange={jest.fn()} />);
    expect(screen.queryByText(/Custo de recursos observado/)).not.toBeInTheDocument();
    render(<WorkProposalCard presentation={presentation({item:{...item,state:'review'},latestResult:result,availableActions:['accept_result'],resourceCost:resourceCost([]) as unknown as WorkPresentationView['resourceCost']})} onChange={jest.fn()} />);
    expect(screen.queryByText(/Custo de recursos observado/)).not.toBeInTheDocument();
  });
  const autonomousItem={...item,state:'approved' as const,intent:{execution_spec:{schema_version:1,target:{kind:'project',reference:'sup04-live'},permissions:['workspace_read','workspace_write_isolated'],validation_criteria:[{label:'npm test',command:'npm test'}],limits:{max_attempts:1,max_duration_minutes:5}}}};
  test('antes de qualquer execução autônoma, nenhum painel de advisory do governor aparece', () => {
    render(<WorkProposalCard presentation={presentation({item:autonomousItem,availableActions:['start']})} onChange={jest.fn()} />);
    expect(screen.queryByText(/Resource Governor \(advisory\)/)).not.toBeInTheDocument();
  });
  test('exibe o parecer do Resource Governor devolvido pela execução autônoma (read-only, transparência)', async () => {
    const governor={pressure:'high',distribution:{count:3,p50Ms:1,p90Ms:2,maxMs:3},snapshot:null,advisories:[{key:{workloadKind:'gate',command:'npm run test:e2e',repo:null},advisory:{recommendation:'machine_exclusive_recommended',rationale:'x',basis:{workloadClass:'high',machinePressure:'high',sampleCount:3,reserveActive:false}}}]};
    (global.fetch as jest.Mock).mockImplementation((url:string)=>typeof url==='string'&&url.includes('/supervisor-turn')
      ? Promise.resolve({ok:true,json:async()=>({ok:true,value:{outcome:'execution_completed'},resourceGovernor:governor})})
      : Promise.resolve({ok:true,json:async()=>({ok:true,value:{presentation:presentation({item:autonomousItem,availableActions:['start']})}})}));
    render(<WorkProposalCard presentation={presentation({item:autonomousItem,availableActions:['start']})} onChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button',{name:'Executar autonomamente'}));
    await waitFor(()=>expect(screen.getByText(/Resource Governor \(advisory\)/)).toBeInTheDocument());
    expect(screen.getByText(/Pressão da máquina agora: alta/)).toBeInTheDocument();
    expect(screen.getByText(/npm run test:e2e — custo alto: recomende uma janela de máquina exclusiva/)).toBeInTheDocument();
  });
});
