import type { WorkPresentationView } from './WorkProposalCard';
import { groupWorkPresentationsBySource, presentWorkReencounter, replaceWorkPresentation } from './work-item-presentation';

const source='afd1b102-d157-44d9-ac93-6d651e7c6929';
const one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222',three='33333333-3333-4333-8333-333333333333';
function view(id:string,dependsOn:string[]=[]):WorkPresentationView{return {item:{id,userId:'u',sourceMessageId:source,state:'approved',impactLevel:'low',capability:'programming',originalRequest:'x',intent:{execution_spec:{schema_version:1,target:{kind:'project',reference:'G:/anima'},permissions:['read','write'],validation_criteria:[{label:'typecheck',command:'npm run typecheck'}],limits:{max_attempts:1,max_duration_minutes:30},depends_on_work_item_ids:dependsOn}},proposal:{schemaVersion:1,data:{summary:id,objective:'obj',includedScope:['x'],excludedScope:['cloud'],expectedEffects:['x'],risks:[]}},proposalVersion:2,createdAt:'2026-08-24T00:00:00Z',updatedAt:'2026-08-24T00:00:00Z'},availableActions:['start'],latestResult:null,acceptedResult:null,latestEventType:'work_approved',autonomousReadiness:{eligible:dependsOn.length===0,blockingDependencyIds:dependsOn,reason:dependsOn.length?'blocked_by_dependency':'eligible'}} as unknown as WorkPresentationView;}

test('agrupa três siblings pela fonte sem sobrescrever identidade',()=>{
  const values=[view(one),view(two,[one]),view(three,[two])];
  const grouped=groupWorkPresentationsBySource(values);
  expect(grouped[source]?.map(value=>value.item.id)).toEqual([one,two,three]);
  expect(replaceWorkPresentation(values,{...values[1]!,item:{...values[1]!.item,state:'in_progress'}})).toHaveLength(3);
});

test('projeta elegibilidade e bloqueios em ordem determinística',()=>{
  const rows=presentWorkReencounter([view(one),view(two,[one]),view(three,[two])]);
  expect(rows.map(row=>[row.presentation.item.id,row.autonomousEligible,row.blockingDependencyIds])).toEqual([
    [one,true,[]],[two,false,[one]],[three,false,[two]],
  ]);
});
