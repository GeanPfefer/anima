import { availableWorkActions, buildProposalRevision, HUMAN_INTERRUPTION_REASONS, parseWorkResultValidations, presentWorkItem, projectAcceptedWorkResult, projectLatestWorkResult, projectPendingWorkDecision, projectWorkIntegration, reconstructWorkPresentation, type WorkEvent, type WorkItem } from '.';
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

describe('histórico de pareceres do Verifier na apresentação',()=>{
  const opinion={schemaVersion:1,workItemId:'i',attemptId:'a1',approvedProposalVersion:2,verifierVersion:'work-verifier-v1',verdict:'verified',restsOnAttestedEvidence:true,summary:{violations:0,gaps:0,checks:1,attested:1,independent:0},findings:[{code:'gates_passed',severity:'ok',provenance:'attested'}],evidenceBasis:{resultEventId:'r',observedEventId:null,coverage:{git:false,gates:false}}};
  const opinionEvent={id:'op1',workItemId:'i',type:'verifier_opinion_recorded',author:'system',proposalVersion:2,occurredAt:new Date(),payload:{schema_version:1,data:{work_item_id:'i',attempt_id:'a1',approved_proposal_version:2,origin:'verifier',verifier_version:'work-verifier-v1',verdict:'verified',opinion}}} satisfies WorkEvent;
  test('surfa o histórico persistido (read-only, auditoria) quando existe',()=>{const p=presentWorkItem(item,[event,opinionEvent]);expect(p.opinionHistory).toHaveLength(1);expect(p.opinionHistory?.[0]).toMatchObject({verdict:'verified',verifierVersion:'work-verifier-v1'});});
  test('sem parecer persistido, o campo é omitido (não polui a apresentação)',()=>expect(presentWorkItem(item,[event]).opinionHistory).toBeUndefined());
  test('surfar o parecer não altera as ações disponíveis (advisory)',()=>expect(presentWorkItem(item,[event,opinionEvent]).availableActions).toEqual(presentWorkItem(item,[event]).availableActions));
});
