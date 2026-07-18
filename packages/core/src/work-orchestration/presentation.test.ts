import { availableWorkActions, buildProposalRevision, parseWorkResultValidations, presentWorkItem, projectAcceptedWorkResult, projectLatestWorkResult, reconstructWorkPresentation, type WorkEvent, type WorkItem } from '.';
const item={id:'i',userId:'u',sourceMessageId:'m',state:'review',impactLevel:'low',capability:'planning',originalRequest:'x',intent:{},proposal:{schemaVersion:1,data:{summary:'s',objective:'o',includedScope:[],excludedScope:[],expectedEffects:[],risks:[]}},proposalVersion:2,createdAt:new Date(),updatedAt:new Date()} satisfies WorkItem;
const event={id:'r',workItemId:'i',type:'result_submitted',author:'executor',proposalVersion:2,payload:{schema_version:1,data:{summary:'feito',result_references:['commit:a']}},occurredAt:new Date()} satisfies WorkEvent;
describe('projeção de apresentação do trabalho',()=>{
  test('expõe evidência e ações da versão revisada',()=>expect(presentWorkItem(item,[event])).toMatchObject({latestResult:{eventId:'r',proposalVersion:2,author:'executor',summary:'feito',references:['commit:a']},availableActions:['accept_result','request_result_changes']}));
  test('não permite aceite sem resultado correspondente',()=>expect(availableWorkActions(item,null)).toEqual([]));
  test('não permite aceite de resultado de versão anterior',()=>expect(presentWorkItem(item,[{...event,proposalVersion:1,payload:{schema_version:1,data:{summary:'antigo',result_references:[]}}}]).availableActions).toEqual([]));
  test('marca validações e limitações ausentes como não informadas',()=>expect(projectLatestWorkResult([event])).toMatchObject({validations:null,limitations:null}));
  test('projeta validações e limitações tipadas',()=>expect(projectLatestWorkResult([{...event,payload:{schema_version:1,data:{summary:'feito',result_references:[],validations:[{label:'npm test',outcome:'passed'}],limitations:['sem teste e2e']}}}])).toMatchObject({validations:[{label:'npm test',outcome:'passed'}],limitations:['sem teste e2e']}));
  test('validações malformadas não viram evidência',()=>expect(projectLatestWorkResult([{...event,payload:{schema_version:1,data:{summary:'feito',result_references:[],validations:[{label:'x',outcome:'inventado'}],limitations:['ok',42]}}}])).toMatchObject({validations:null,limitations:null}));
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
