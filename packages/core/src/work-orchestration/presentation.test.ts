import { availableWorkActions, presentWorkItem, type WorkEvent, type WorkItem } from '.';
const item={id:'i',userId:'u',sourceMessageId:'m',state:'review',impactLevel:'low',capability:'planning',originalRequest:'x',intent:{},proposal:{schemaVersion:1,data:{summary:'s',objective:'o',includedScope:[],excludedScope:[],expectedEffects:[],risks:[]}},proposalVersion:2,createdAt:new Date(),updatedAt:new Date()} satisfies WorkItem;
const event={id:'r',workItemId:'i',type:'result_submitted',author:'executor',proposalVersion:2,payload:{schema_version:1,data:{summary:'feito',result_references:['commit:a']}},occurredAt:new Date()} satisfies WorkEvent;
describe('projeção de apresentação do trabalho',()=>{
  test('expõe evidência e ações da versão revisada',()=>expect(presentWorkItem(item,[event])).toMatchObject({latestResult:{eventId:'r',proposalVersion:2,author:'executor',summary:'feito',references:['commit:a']},availableActions:['accept_result','request_result_changes']}));
  test('não permite aceite sem resultado correspondente',()=>expect(availableWorkActions(item,null)).toEqual([]));
  test('não permite aceite de resultado de versão anterior',()=>expect(presentWorkItem(item,[{...event,proposalVersion:1,payload:{schema_version:1,data:{summary:'antigo',result_references:[]}}}]).availableActions).toEqual([]));
});
