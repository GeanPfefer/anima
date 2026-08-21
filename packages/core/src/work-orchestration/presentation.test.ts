import { availableWorkActions, buildProposalRevision, deriveWorkProgressPhase, HUMAN_INTERRUPTION_REASONS, parseWorkResultValidations, presentWorkItem, projectAcceptedWorkResult, projectLatestWorkResult, projectPendingBudgetWait, projectPendingWorkDecision, projectWorkIntegration, projectWorkResourceCost, reconstructWorkPresentation, type AutonomousExecutionProjection, type WorkEvent, type WorkIntegrationProjection, type WorkItem } from '.';
const item={id:'i',userId:'u',sourceMessageId:'m',state:'review',impactLevel:'low',capability:'planning',originalRequest:'x',intent:{},proposal:{schemaVersion:1,data:{summary:'s',objective:'o',includedScope:[],excludedScope:[],expectedEffects:[],risks:[]}},proposalVersion:2,createdAt:new Date(),updatedAt:new Date()} satisfies WorkItem;
const event={id:'r',workItemId:'i',type:'result_submitted',author:'executor',proposalVersion:2,payload:{schema_version:1,data:{summary:'feito',result_references:['commit:a']}},occurredAt:new Date()} satisfies WorkEvent;
describe('projeção de apresentação do trabalho',()=>{
  test('expõe evidência e ações da versão revisada',()=>expect(presentWorkItem(item,[event])).toMatchObject({latestResult:{eventId:'r',proposalVersion:2,author:'executor',summary:'feito',references:['commit:a']},availableActions:['accept_result','request_result_changes']}));
  test('não permite aceite sem resultado correspondente',()=>expect(availableWorkActions(item,null)).toEqual([]));
  test('não permite aceite de resultado de versão anterior',()=>expect(presentWorkItem(item,[{...event,proposalVersion:1,payload:{schema_version:1,data:{summary:'antigo',result_references:[]}}}]).availableActions).toEqual([]));
  test('marca validações e limitações ausentes como não informadas',()=>expect(projectLatestWorkResult([event])).toMatchObject({validations:null,limitations:null}));
  test('projeta validações e limitações tipadas',()=>expect(projectLatestWorkResult([{...event,payload:{schema_version:1,data:{summary:'feito',result_references:[],validations:[{label:'npm test',outcome:'passed'}],limitations:['sem teste e2e']}}}])).toMatchObject({validations:[{label:'npm test',outcome:'passed'}],limitations:['sem teste e2e']}));
  test('validações malformadas não viram evidência',()=>expect(projectLatestWorkResult([{...event,payload:{schema_version:1,data:{summary:'feito',result_references:[],validations:[{label:'x',outcome:'inventado'}],limitations:['ok',42]}}}])).toMatchObject({validations:null,limitations:null}));
  test('projeta a referência de handoff persistida pelo terminal do executor (UX-03)',()=>expect(projectLatestWorkResult([{...event,payload:{schema_version:1,data:{summary:'feito',result_references:['commit:a'],handoff_reference:'runner-bundle:ux03'}}}])).toMatchObject({handoffReference:'runner-bundle:ux03'}));
  test('resultado sem referência de handoff declara a ausência com null',()=>expect(projectLatestWorkResult([event])).toMatchObject({handoffReference:null}));
  test('referência de handoff vazia ou malformada não vira evidência',()=>expect(projectLatestWorkResult([{...event,payload:{schema_version:1,data:{summary:'feito',result_references:[],handoff_reference:'   '}}}])).toMatchObject({handoffReference:null}));
  test('interpreta linhas de validação com prefixo tipado',()=>expect(parseWorkResultValidations('ok: npm test\nfalha: build web\nrevisão manual\n  \n')).toEqual([{label:'npm test',outcome:'passed'},{label:'build web',outcome:'failed'},{label:'revisão manual',outcome:'declared'}]));
});
describe('reconstrução fail-closed da proveniência',()=>{
  const makeEvent=(id:string,type:WorkEvent['type'],proposalVersion:number,payload:WorkEvent['payload']={schema_version:1,data:{}}):WorkEvent=>({id,workItemId:item.id,type,author:type==='work_approved'?'user':'anima',proposalVersion,payload,occurredAt:new Date()});
  const history=[makeEvent('p','work_proposed',1),makeEvent('c','context_attached',1),makeEvent('r2','proposal_revised',2),makeEvent('a','work_approved',2),event];
  const source=[{kind:'message',id:item.sourceMessageId}];
  test('reconstrói revisão, decisão e resultado da versão vigente',()=>expect(reconstructWorkPresentation(item,history,source)).toMatchObject({provenance:{status:'complete',issues:[]},latestResult:{eventId:'r'},availableActions:['accept_result','request_result_changes']}));
  test('bloqueia ações quando a referência ao pedido original está ausente',()=>expect(reconstructWorkPresentation(item,history,[])).toMatchObject({provenance:{status:'incomplete',issues:['missing_source_message_reference']},availableActions:[]}));
  test('bloqueia quando a decisão não aponta para a versão vigente',()=>expect(reconstructWorkPresentation(item,history.map(value=>value.id==='a'?{...value,proposalVersion:1}:value),source)).toMatchObject({provenance:{status:'incomplete',issues:expect.arrayContaining(['missing_versioned_decision'])},availableActions:[]}));
  test('exige que resultado de executor aponte para uma execução iniciada do mesmo id',()=>{const executionResult={...event,payload:{schema_version:1,data:{summary:'feito',result_references:[],execution_id:'exec-1'}}};expect(reconstructWorkPresentation(item,[...history.slice(0,-1),executionResult],source)).toMatchObject({provenance:{status:'incomplete',issues:expect.arrayContaining(['missing_execution_exec-1'])},availableActions:[]});});
  test('resultado aceito continua verificável depois da reconstrução',()=>{const accepted=makeEvent('accepted','result_accepted',2,{schema_version:1,data:{accepted_result_event_id:'r'}});expect(reconstructWorkPresentation({...item,state:'completed'},[...history,accepted],source)).toMatchObject({provenance:{status:'complete'},acceptedResult:{eventId:'r'},availableActions:[]});});
});
describe('revisão coerente de proposta',()=>{
  test('correção gera nova versão coerente preservando a proposta base',()=>{
    const revision=buildProposalRevision({...item,proposal:{schemaVersion:1,data:{...item.proposal.data,includedScope:['tela'],objective:'objetivo original'}}},'  Reduzir o escopo  ');
    expect(revision.requestedChanges).toBe('Reduzir o escopo');
    expect(revision.proposal.data.objective).toBe('objetivo original\n\nAjuste solicitado: Reduzir o escopo');
    expect(revision.proposal.data.includedScope).toEqual(['tela','Reduzir o escopo']);
    expect(revision.intent).toMatchObject({revision_feedback:'Reduzir o escopo'});
  });
  test('correção repetida não duplica o escopo incluído',()=>{
    const revised=buildProposalRevision({...item,proposal:{schemaVersion:1,data:{...item.proposal.data,includedScope:['Reduzir o escopo']}}},'Reduzir o escopo');
    expect(revised.proposal.data.includedScope).toEqual(['Reduzir o escopo']);
  });
});
describe('projeção do resultado aceito',()=>{
  const accepted={id:'a',workItemId:'i',type:'result_accepted',author:'user',proposalVersion:2,payload:{schema_version:1,data:{accepted_result_event_id:'r'}},occurredAt:new Date()} satisfies WorkEvent;
  test('reconstrói o resultado exato referenciado pelo aceite',()=>expect(projectAcceptedWorkResult([event,accepted])).toMatchObject({eventId:'r',summary:'feito',references:['commit:a']}));
  test('resultado aceito preserva a referência de handoff do resultado original (UX-03)',()=>expect(projectAcceptedWorkResult([{...event,payload:{schema_version:1,data:{summary:'feito',result_references:['commit:a'],handoff_reference:'runner-bundle:ux03'}}},accepted])).toMatchObject({handoffReference:'runner-bundle:ux03'}));
  test('presentWorkItem expõe o resultado aceito ao lado do último resultado',()=>expect(presentWorkItem({...item,state:'completed'},[event,accepted])).toMatchObject({acceptedResult:{eventId:'r'},availableActions:[]}));
  test('correlaciona ao evento referenciado mesmo com resultado mais novo',()=>{
    const newer={...event,id:'r2',payload:{schema_version:1,data:{summary:'outro',result_references:[]}}} satisfies WorkEvent;
    expect(projectAcceptedWorkResult([event,accepted,newer])).toMatchObject({eventId:'r',summary:'feito'});
  });
  test('aceite sem referência de evento não vira evidência',()=>expect(projectAcceptedWorkResult([event,{...accepted,payload:{schema_version:1,data:{}}}])).toBeNull());
  test('referência pendurada não vira evidência',()=>expect(projectAcceptedWorkResult([event,{...accepted,payload:{schema_version:1,data:{accepted_result_event_id:'inexistente'}}}])).toBeNull());
  test('referência para evento de outro tipo não vira evidência',()=>expect(projectAcceptedWorkResult([event,{...accepted,payload:{schema_version:1,data:{accepted_result_event_id:'a'}}}])).toBeNull());
  test('resultado referenciado com payload malformado não vira evidência',()=>expect(projectAcceptedWorkResult([{...event,payload:{schema_version:1,data:{summary:42}}},accepted])).toBeNull());
  test('sem evento de aceite não há resultado aceito',()=>expect(projectAcceptedWorkResult([event])).toBeNull());
});
describe('projeção da segunda decisão de integração',()=>{
  const integrationResult={...event,payload:{schema_version:1,data:{summary:'feito',result_references:['commit:a'],work_item_id:'i',attempt_id:'attempt-1',approved_proposal_version:2,handoff_reference:'worktree:attempt-1'}}} satisfies WorkEvent;
  const accepted={id:'accepted',workItemId:'i',type:'result_accepted',author:'user',proposalVersion:2,payload:{schema_version:1,data:{accepted_result_event_id:'r'}},occurredAt:new Date()} satisfies WorkEvent;
  const decided=(decision:'authorize'|'refuse'):WorkEvent=>({id:`decision-${decision}`,workItemId:'i',type:'integration_decided',author:'user',proposalVersion:2,payload:{schema_version:1,data:{work_item_id:'i',attempt_id:'attempt-1',approved_proposal_version:2,accepted_result_event_id:'r',decision,decision_id:`integration:r:${decision}`}},occurredAt:new Date()});
  test('só oferece authorize/refuse depois do resultado aceito',()=>{expect(projectWorkIntegration({...item,state:'review'},[integrationResult])).toBeNull();expect(projectWorkIntegration({...item,state:'completed'},[integrationResult,accepted])).toMatchObject({status:'awaiting_decision',acceptedResultEventId:'r',availableDecisions:['authorize','refuse']});});
  test.each([['authorize','authorized'],['refuse','refused']] as const)('decisão %s remove a affordance e projeta %s',(decision,status)=>expect(projectWorkIntegration({...item,state:'completed'},[integrationResult,accepted,decided(decision)])).toEqual({status,acceptedResultEventId:'r',decision,availableDecisions:[],publication:null}));
  test('branch_published correlacionado aparece sem afirmar PR ou integração',()=>{const publication:WorkEvent={id:'pub',workItemId:'i',type:'branch_published',author:'system',proposalVersion:2,payload:{schema_version:1,data:{authorization_decision_id:'integration:r:authorize',accepted_result_event_id:'r',attempt_id:'attempt-1',receipt:{kind:'branch_publication',receiptId:'receipt',idempotencyKey:`integration-publication:integration:r:authorize:${'b'.repeat(40)}:branch`,providerId:'git-branch-publication-v1',repositoryId:'repo',remoteName:'origin',remoteBranch:'anima-work/attempt-1',commitSha:'b'.repeat(40),baseBranch:'main',verifiedBaseSha:'a'.repeat(40),disposition:'created'}}},occurredAt:new Date()};expect(projectWorkIntegration({...item,state:'completed'},[integrationResult,accepted,decided('authorize'),publication])).toMatchObject({status:'branch_published',publication:{remoteBranch:'anima-work/attempt-1',commitSha:'b'.repeat(40)}});});
  test('versão ou ownership divergentes falham fechado',()=>{expect(projectWorkIntegration({...item,state:'completed',proposalVersion:3},[integrationResult,accepted])).toBeNull();expect(projectWorkIntegration({...item,id:'outro',state:'completed'},[integrationResult,accepted])).toBeNull();});
  const branchPublished:WorkEvent={id:'pub',workItemId:'i',type:'branch_published',author:'system',proposalVersion:2,payload:{schema_version:1,data:{authorization_decision_id:'integration:r:authorize',accepted_result_event_id:'r',attempt_id:'attempt-1',receipt:{kind:'branch_publication',receiptId:'receipt',idempotencyKey:`integration-publication:integration:r:authorize:${'b'.repeat(40)}:branch`,providerId:'git-branch-publication-v1',repositoryId:'repo',remoteName:'origin',remoteBranch:'anima-work/attempt-1',commitSha:'b'.repeat(40),baseBranch:'main',verifiedBaseSha:'a'.repeat(40),disposition:'created'}}},occurredAt:new Date()};
  const reviewCreated=(receiptOverrides:Record<string,unknown>={},dataOverrides:Record<string,unknown>={},author:WorkEvent['author']='system'):WorkEvent=>({id:'rev',workItemId:'i',type:'review_request_created',author,proposalVersion:2,payload:{schema_version:1,data:{authorization_decision_id:'integration:r:authorize',accepted_result_event_id:'r',attempt_id:'attempt-1',...dataOverrides,receipt:{kind:'review_request',receiptId:'rr',idempotencyKey:`integration-publication:integration:r:authorize:${'b'.repeat(40)}:review`,providerId:'git-branch-publication-v1',repositoryId:'repo',remoteName:'origin',reviewId:'42',reviewReference:'https://example.invalid/pull/42',state:'open',sourceBranch:'anima-work/attempt-1',sourceCommitSha:'b'.repeat(40),baseBranch:'main',verifiedBaseSha:'a'.repeat(40),disposition:'created',...receiptOverrides}}},occurredAt:new Date()});
  test('review_request_created correlacionado promove o estado posterior sem afirmar merge',()=>{const projection=projectWorkIntegration({...item,state:'completed'},[integrationResult,accepted,decided('authorize'),branchPublished,reviewCreated()]);expect(projection).toMatchObject({status:'review_request_created',publication:{remoteBranch:'anima-work/attempt-1'},reviewRequest:{reviewReference:'https://example.invalid/pull/42',reviewId:'42',sourceBranch:'anima-work/attempt-1',baseBranch:'main'}});});
  test.each([
    ['autor não-system',reviewCreated({},{},'executor')],
    ['tentativa divergente',reviewCreated({},{attempt_id:'attempt-outra'})],
    ['autorização divergente',reviewCreated({},{authorization_decision_id:'integration:r:outra'})],
    ['idempotencyKey de review adulterada',reviewCreated({idempotencyKey:`integration-publication:integration:r:authorize:${'c'.repeat(40)}:review`})],
  ] as const)('review_request_created com %s é ignorado e permanece branch_published',(_,forged)=>expect(projectWorkIntegration({...item,state:'completed'},[integrationResult,accepted,decided('authorize'),branchPublished,forged])).toMatchObject({status:'branch_published',reviewRequest:null}));
  // Um branch_published só promove a UI a "publicada" quando casa exatamente
  // autor=system, versão, autorização, resultado aceito, tentativa e a
  // idempotencyKey derivada do commit. Qualquer divergência é ignorada e a
  // projeção permanece em "autorizada" — um evento forjado/corrompido nunca
  // afirma publicação. Cada caso abaixo quebra uma guarda distinta.
  const publication=(dataOverrides:Record<string,unknown>={},receiptOverrides:Record<string,unknown>={},author:WorkEvent['author']='system'):WorkEvent=>({id:'pub',workItemId:'i',type:'branch_published',author,proposalVersion:2,payload:{schema_version:1,data:{authorization_decision_id:'integration:r:authorize',accepted_result_event_id:'r',attempt_id:'attempt-1',...dataOverrides,receipt:{kind:'branch_publication',receiptId:'receipt',idempotencyKey:`integration-publication:integration:r:authorize:${'b'.repeat(40)}:branch`,providerId:'git-branch-publication-v1',repositoryId:'repo',remoteName:'origin',remoteBranch:'anima-work/attempt-1',commitSha:'b'.repeat(40),baseBranch:'main',verifiedBaseSha:'a'.repeat(40),disposition:'created',...receiptOverrides}}},occurredAt:new Date()});
  test.each([
    ['autor não-system',publication({},{},'executor')],
    ['tentativa divergente',publication({attempt_id:'attempt-outra'})],
    ['autorização divergente',publication({authorization_decision_id:'integration:r:outra'})],
    ['idempotencyKey adulterada',publication({},{idempotencyKey:`integration-publication:integration:r:authorize:${'c'.repeat(40)}:branch`})],
  ] as const)('branch_published com %s é ignorado e permanece autorizada',(_,forged)=>expect(projectWorkIntegration({...item,state:'completed'},[integrationResult,accepted,decided('authorize'),forged])).toMatchObject({status:'authorized',publication:null}));
});
describe('projeção da decisão humana',()=>{
  const request=(reason:(typeof HUMAN_INTERRUPTION_REASONS)[number]):WorkEvent=>({id:`q-${reason}`,workItemId:'i',type:'input_requested',author:'anima',proposalVersion:2,occurredAt:new Date(),payload:{schema_version:1,data:{attempt_id:'attempt-1',reason,explanation:'Escolha necessária.',checkpoint_reference:'checkpoint-1',options:[{id:'seguir',label:'Seguir',effect:'resume'},{id:'parar',label:'Parar',effect:'cancel'}]}}});
  test.each(HUMAN_INTERRUPTION_REASONS)('projeta a razão fechada %s',reason=>expect(projectPendingWorkDecision({...item,state:'blocked'},[request(reason)])).toMatchObject({reason,requestEventId:`q-${reason}`,options:[{id:'seguir',effect:'resume'},{id:'parar',effect:'cancel'}]}));
  test('reconstrói após refresh a partir do InputRequestedPayloadV1 persistido',()=>{
    const persisted={...request('architectural_decision'),payload:{schema_version:1,data:{attempt_id:'attempt-1',
      input_request:{schema_version:1,reason:'architectural_decision',source_state:{work_state:'in_progress',proposal_version:2,checkpoint_reference:'checkpoint-1'},explanation:'Escolha persistida.'},
      options:[{id:'seguir',label:'Seguir',effect:'resume'},{id:'parar',label:'Parar',effect:'cancel'}],
      handoff:{schemaVersion:1,workItemId:'i',attemptId:'attempt-1',approvedProposalVersion:2,claimId:'claim-1',status:'paused',stopReason:'human_input_required'}}}};
    expect(presentWorkItem({...item,state:'blocked'},[persisted])).toMatchObject({pendingDecision:{reason:'architectural_decision',explanation:'Escolha persistida.',checkpointReference:'checkpoint-1'}});
  });
  test('a resposta ao evento exato remove a decisão pendente',()=>{const pending=request('scope_change');const answered:WorkEvent={id:'answer',workItemId:'i',type:'input_provided',author:'user',proposalVersion:2,occurredAt:new Date(),payload:{schema_version:1,data:{input_requested_event_id:pending.id,option_id:'seguir'}}};expect(projectPendingWorkDecision({...item,state:'approved'},[pending,answered])).toBeNull();});
  test('alternativas malformadas não são inventadas pela apresentação',()=>expect(projectPendingWorkDecision({...item,state:'blocked'},[{...request('scope_change'),payload:{schema_version:1,data:{attempt_id:'attempt-1',reason:'scope_change',explanation:'x',checkpoint_reference:'cp',options:[{id:'única',label:'Única',effect:'resume'}]}}}])).toBeNull());
});

describe('projeção de espera por orçamento (INTEL-04 coerência V0)',()=>{
  const blocked={...item,state:'blocked' as const};
  const budgetBlock=(reason:string,reachedLimit:string,extra:Record<string,unknown>={}):WorkEvent=>({id:`b-${reason}`,workItemId:'i',type:'work_blocked',author:'anima',proposalVersion:2,occurredAt:new Date(),payload:{schema_version:1,data:{work_item_id:'i',approved_proposal_version:2,reason,reached_limit:reachedLimit,resolution:'awaits_budget_window',...extra}}});
  test('projeta o bloqueio de orçamento pré-tentativa como espera temporal',()=>expect(projectPendingBudgetWait(blocked,[budgetBlock('user_attempt_budget_exhausted','attempts')])).toEqual({reason:'user_attempt_budget_exhausted',reachedLimit:'attempts'}));
  test('não colide com a projeção de decisão humana (não é um cartão de decisão)',()=>{const events=[budgetBlock('user_runtime_budget_exhausted','duration')];expect(projectPendingWorkDecision(blocked,events)).toBeNull();expect(projectPendingBudgetWait(blocked,events)).toMatchObject({reason:'user_runtime_budget_exhausted',reachedLimit:'duration'});});
  test('um bloqueio de decisão humana NÃO é espera de orçamento',()=>expect(projectPendingBudgetWait(blocked,[budgetBlock('human_input_required','attempts')])).toBeNull());
  test('uma interrupção EM tentativa (com attempt_id) NÃO cai nesta projeção',()=>expect(projectPendingBudgetWait(blocked,[budgetBlock('interactive_reserve_protected','resources',{attempt_id:'a1'})])).toBeNull());
  test('item não bloqueado nunca aguarda orçamento',()=>{expect(projectPendingBudgetWait({...item,state:'approved'},[budgetBlock('user_attempt_budget_exhausted','attempts')])).toBeNull();expect(projectPendingBudgetWait({...item,state:'review'},[])).toBeNull();});
  test('presentWorkItem expõe pendingBudgetWait e mantém pendingDecision nulo',()=>expect(presentWorkItem(blocked,[budgetBlock('interactive_reserve_protected','resources')])).toMatchObject({pendingBudgetWait:{reason:'interactive_reserve_protected',reachedLimit:'resources'},pendingDecision:null}));
});

describe('histórico de pareceres do Verifier na apresentação',()=>{
  const opinion={schemaVersion:1,workItemId:'i',attemptId:'a1',approvedProposalVersion:2,verifierVersion:'work-verifier-v1',verdict:'verified',restsOnAttestedEvidence:true,summary:{violations:0,gaps:0,checks:1,attested:1,independent:0},findings:[{code:'gates_passed',severity:'ok',provenance:'attested'}],evidenceBasis:{resultEventId:'r',observedEventId:null,observedGateEventId:null,coverage:{git:false,gates:false}}};
  const opinionEvent={id:'op1',workItemId:'i',type:'verifier_opinion_recorded',author:'system',proposalVersion:2,occurredAt:new Date(),payload:{schema_version:1,data:{work_item_id:'i',attempt_id:'a1',approved_proposal_version:2,origin:'verifier',verifier_version:'work-verifier-v1',verdict:'verified',opinion}}} satisfies WorkEvent;
  test('surfa o histórico persistido (read-only, auditoria) quando existe',()=>{const p=presentWorkItem(item,[event,opinionEvent]);expect(p.opinionHistory).toHaveLength(1);expect(p.opinionHistory?.[0]).toMatchObject({verdict:'verified',verifierVersion:'work-verifier-v1'});});
  test('sem parecer persistido, o campo é omitido (não polui a apresentação)',()=>expect(presentWorkItem(item,[event]).opinionHistory).toBeUndefined());
  test('surfar o parecer não altera as ações disponíveis (advisory)',()=>expect(presentWorkItem(item,[event,opinionEvent]).availableActions).toEqual(presentWorkItem(item,[event]).availableActions));
});

describe('evidência observada bruta na apresentação (auditoria)',()=>{
  const gitEv={schemaVersion:1,workItemId:'i',attemptId:'a1',approvedProposalVersion:2,baseSha:'a'.repeat(40),observedCommitSha:'b'.repeat(40),observedChangedFiles:['src/a.ts'],observedDiffSummary:{filesChanged:1,insertions:2,deletions:0,files:[{path:'src/a.ts',insertions:2,deletions:0}]},observedAt:'2026-08-16T10:00:00Z',coverage:{git:true,gates:false}};
  const gitEvent={id:'g',workItemId:'i',type:'host_observed_evidence_recorded',author:'system',proposalVersion:2,occurredAt:new Date(),payload:{schema_version:1,data:{work_item_id:'i',attempt_id:'a1',approved_proposal_version:2,origin:'host',evidence:gitEv}}} satisfies WorkEvent;
  const gateEv={schemaVersion:1,workItemId:'i',attemptId:'a1',approvedProposalVersion:2,gates:[{label:'unit',command:'npm test',exitCode:0,durationMs:1,timedOut:false,cancelled:false,outcome:'passed'}],observedAt:'2026-08-16T10:00:00Z',coverage:{gates:true}};
  const gateEvent={id:'ge',workItemId:'i',type:'host_observed_gate_evidence_recorded',author:'system',proposalVersion:2,occurredAt:new Date(),payload:{schema_version:1,data:{work_item_id:'i',attempt_id:'a1',approved_proposal_version:2,origin:'host',evidence:gateEv}}} satisfies WorkEvent;
  test('surfa os fatos brutos observados (git e gate) quando existem',()=>{const p=presentWorkItem(item,[event,gitEvent,gateEvent]);expect(p.observedEvidence?.git?.observedChangedFiles).toEqual(['src/a.ts']);expect(p.observedEvidence?.gates?.gates[0]).toMatchObject({label:'unit',outcome:'passed'});});
  test('só git observado ⇒ gates null, git presente',()=>{const p=presentWorkItem(item,[event,gitEvent]);expect(p.observedEvidence?.git).not.toBeNull();expect(p.observedEvidence?.gates).toBeNull();});
  test('sem evidência observada ⇒ campo omitido',()=>expect(presentWorkItem(item,[event]).observedEvidence).toBeUndefined());
  test('surfar evidência não altera as ações disponíveis',()=>expect(presentWorkItem(item,[event,gitEvent,gateEvent]).availableActions).toEqual(presentWorkItem(item,[event]).availableActions));
});
describe('Resource Governor V0 na presentation (custo derivado dos gates, read-only)',()=>{
  const resultEvent={id:'r',workItemId:'i',type:'result_submitted',author:'executor',proposalVersion:2,payload:{schema_version:1,data:{summary:'feito',result_references:['commit:a']}},occurredAt:new Date()} satisfies WorkEvent;
  // Um attempt com três gates de comandos distintos → a distribuição tem espalhamento real.
  const gateEv={schemaVersion:1,workItemId:'i',attemptId:'a1',approvedProposalVersion:2,gates:[
    {label:'typecheck',command:'npm run typecheck',exitCode:0,durationMs:300,timedOut:false,cancelled:false,outcome:'passed'},
    {label:'unit',command:'npm test',exitCode:0,durationMs:3000,timedOut:false,cancelled:false,outcome:'passed'},
    {label:'e2e',command:'npm run test:e2e',exitCode:0,durationMs:90000,timedOut:false,cancelled:false,outcome:'passed'},
  ],observedAt:'2026-08-17T10:00:00Z',coverage:{gates:true}};
  const gateEvent={id:'ge',workItemId:'i',type:'host_observed_gate_evidence_recorded',author:'system',proposalVersion:2,occurredAt:new Date(),payload:{schema_version:1,data:{work_item_id:'i',attempt_id:'a1',approved_proposal_version:2,origin:'host',evidence:gateEv}}} satisfies WorkEvent;
  test('deriva perfis por comando com classe relativa à distribuição do próprio item',()=>{
    const cost=projectWorkResourceCost([resultEvent,gateEvent]);
    expect(cost?.distribution).toMatchObject({count:3,maxMs:90000});
    const byCommand=Object.fromEntries((cost?.profiles??[]).map(p=>[p.key.command,p.predominantClass]));
    expect(byCommand['npm run typecheck']).toBe('low');
    expect(byCommand['npm run test:e2e']).toBe('high');
  });
  test('presentWorkItem surfa resourceCost quando há gate observado',()=>expect(presentWorkItem(item,[resultEvent,gateEvent]).resourceCost?.distribution.count).toBe(3));
  test('sem gate observado ⇒ resourceCost omitido',()=>expect(presentWorkItem(item,[resultEvent]).resourceCost).toBeUndefined());
  test('nenhum gate ⇒ projeção null (não inventa histórico)',()=>expect(projectWorkResourceCost([resultEvent])).toBeNull());
  test('surfar custo não altera as ações disponíveis (advisory, não decisão)',()=>expect(presentWorkItem(item,[resultEvent,gateEvent]).availableActions).toEqual(presentWorkItem(item,[resultEvent]).availableActions));

  // Custo do CODER host-observed no mesmo card: perfil SEPARADO do gate (chave por workloadKind).
  const coderEv={schemaVersion:1,workItemId:'i',attemptId:'a1',approvedProposalVersion:2,backendId:'ollama-coder',durationMs:84000,outcome:'succeeded',observedAt:'2026-08-17T10:05:00Z'};
  const coderEvent={id:'ce',workItemId:'i',type:'host_observed_coder_evidence_recorded',author:'system',proposalVersion:2,occurredAt:new Date(),payload:{schema_version:1,data:{work_item_id:'i',attempt_id:'a1',approved_proposal_version:2,origin:'host',evidence:coderEv}}} satisfies WorkEvent;
  test('coder e gate coexistem no card como perfis distintos por workloadKind',()=>{
    const cost=projectWorkResourceCost([resultEvent,gateEvent,coderEvent]);
    const kinds=(cost?.profiles??[]).map(p=>p.key.workloadKind);
    expect(kinds).toContain('gate');
    expect(kinds).toContain('coder');
    const coder=(cost?.profiles??[]).find(p=>p.key.workloadKind==='coder');
    expect(coder?.key.command).toBe('ollama-coder');
    expect(coder?.durationMedianMs).toBe(84000);
  });
  test('coder observado sozinho (sem gate) já surfa resourceCost',()=>expect(projectWorkResourceCost([resultEvent,coderEvent])?.profiles.some(p=>p.key.workloadKind==='coder')).toBe(true));
});

describe('deriveWorkProgressPhase — fase humana projetada de fatos',()=>{
  const base:Omit<WorkItem,'state'>={id:'i',userId:'u',sourceMessageId:'m',impactLevel:'low',capability:'programming',originalRequest:'x',intent:{},proposal:{schemaVersion:1,data:{summary:'s',objective:'o',includedScope:[],excludedScope:[],expectedEffects:[],risks:[]}},proposalVersion:1,createdAt:new Date(),updatedAt:new Date()};
  const withState=(state:WorkItem['state']):WorkItem=>({...base,state});
  const exec=(status:AutonomousExecutionProjection['status'],hasCheckpoint=false):AutonomousExecutionProjection=>({attemptId:'a',status,startedAt:'',executorId:null,providerRef:null,modelRef:null,effort:null,limits:{maxAttempts:null,maxDurationMinutes:null},latestCheckpoint:hasCheckpoint?{signalSequence:1,completedSteps:2,remainingSteps:1,nextStep:'gates'}:null,pendingControl:null,appliedControl:null,budgetBlock:null,canRequestControl:false});
  const integ=(status:WorkIntegrationProjection['status']):WorkIntegrationProjection=>({status,acceptedResultEventId:'r',decision:null,availableDecisions:[]});

  test('estados terminais do item têm precedência',()=>{
    expect(deriveWorkProgressPhase({item:withState('completed'),execution:null,integration:null})).toMatchObject({phase:'done',label:'Concluído',terminal:true});
    expect(deriveWorkProgressPhase({item:withState('rejected'),execution:null,integration:null}).phase).toBe('rejected');
    expect(deriveWorkProgressPhase({item:withState('cancelled'),execution:null,integration:null}).phase).toBe('cancelled');
    expect(deriveWorkProgressPhase({item:withState('failed'),execution:null,integration:null}).phase).toBe('failed');
  });

  test('execução em andamento: implementando sem checkpoint, testando com o checkpoint de pós-edição',()=>{
    expect(deriveWorkProgressPhase({item:withState('in_progress'),execution:exec('running',false),integration:null})).toMatchObject({phase:'implementing',active:true,terminal:false});
    expect(deriveWorkProgressPhase({item:withState('in_progress'),execution:exec('running',true),integration:null})).toMatchObject({phase:'testing',active:true});
  });

  test('submetido para revisão sem aceite → Revisando; com integração aguardando → Pronto para integrar',()=>{
    expect(deriveWorkProgressPhase({item:withState('review'),execution:exec('submitted_for_review'),integration:null}).phase).toBe('reviewing');
    expect(deriveWorkProgressPhase({item:withState('review'),execution:exec('submitted_for_review'),integration:integ('awaiting_decision')}).phase).toBe('ready_to_integrate');
  });

  test('integração pós-resultado tem precedência sobre completed → Pronto para integrar',()=>{
    // Um item ACEITO (completed) com integração pendente ainda espera a decisão humana:
    // a fase é `ready_to_integrate`, não `done` — senão a fase "Pronto para integrar" nunca apareceria.
    expect(deriveWorkProgressPhase({item:withState('completed'),execution:null,integration:integ('awaiting_decision')}).phase).toBe('ready_to_integrate');
    expect(deriveWorkProgressPhase({item:withState('completed'),execution:null,integration:integ('branch_published')}).phase).toBe('integrating');
    expect(deriveWorkProgressPhase({item:withState('completed'),execution:null,integration:integ('review_request_created')}).phase).toBe('integrating');
    // Recusada: o humano decidiu não integrar; o trabalho está concluído.
    expect(deriveWorkProgressPhase({item:withState('completed'),execution:null,integration:integ('refused')}).phase).toBe('done');
    // Concluído SEM fronteira de integração → done.
    expect(deriveWorkProgressPhase({item:withState('completed'),execution:null,integration:null}).phase).toBe('done');
  });

  test('espera humana / pré-execução: proposta, aprovado, revisão, bloqueado',()=>{
    expect(deriveWorkProgressPhase({item:withState('proposed'),execution:null,integration:null}).phase).toBe('proposal');
    expect(deriveWorkProgressPhase({item:withState('approved'),execution:null,integration:null}).phase).toBe('approved');
    expect(deriveWorkProgressPhase({item:withState('review'),execution:null,integration:null}).phase).toBe('reviewing');
    expect(deriveWorkProgressPhase({item:withState('blocked'),execution:null,integration:null}).phase).toBe('blocked');
  });

  test('presentWorkItem expõe a fase (projeção pura, read-only)',()=>{
    const p=presentWorkItem(withState('proposed'),[]);
    expect(p.progress).toMatchObject({phase:'proposal',label:'Proposta',active:false});
  });
});
