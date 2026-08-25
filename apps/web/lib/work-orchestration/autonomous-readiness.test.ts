import type { WorkItem } from '@anima/core';
import { projectAutonomousReadiness } from './autonomous-readiness';

const one='0cedae21-433d-4842-8fbd-9045c5128bcf',two='b2930e81-3f19-48f5-92ab-a27e10633896',three='1257f22f-03dd-464c-bafb-d90744c9f92e';
const item=(id:string,deps:string[]=[])=>({id,intent:{execution_spec:{depends_on_work_item_ids:deps}}}) as unknown as WorkItem;

test('projeta a fila autoritativa e explica dependências sem mutation',async()=>{
  const rpc=jest.fn().mockImplementation((name:string)=>name==='autonomous_work_queue'?Promise.resolve({data:[{work_item_id:one}],error:null}):Promise.resolve({data:{classification:{complexity:'bounded',risk:'low',reversibility:'reversible',planClarity:'clear',urgency:'normal'}},error:null}));
  const inFn=jest.fn().mockResolvedValue({data:[{id:one,state:'approved'},{id:two,state:'approved'}],error:null});
  const select=jest.fn(()=>({in:inFn}));const from=jest.fn(()=>({select}));
  const result=await projectAutonomousReadiness({rpc,from} as never,[item(one),item(two,[one]),item(three,[two])]);
  expect(result.get(one)).toMatchObject({eligible:true,reason:'eligible'});
  expect(result.get(two)).toEqual({eligible:false,blockingDependencyIds:[one],reason:'blocked_by_dependency'});
  expect(result.get(three)).toEqual({eligible:false,blockingDependencyIds:[two],reason:'blocked_by_dependency'});
  expect(rpc).toHaveBeenCalledWith('autonomous_work_queue');
  expect(from).toHaveBeenCalledTimes(1);
});

test('expõe classificação ausente sem transformar transparência em autorização',async()=>{
  const rpc=jest.fn().mockImplementation((name:string)=>name==='autonomous_work_queue'?Promise.resolve({data:[],error:null}):Promise.resolve({data:null,error:null}));
  const result=await projectAutonomousReadiness({rpc,from:jest.fn()} as never,[item(one)]);
  expect(result.get(one)).toEqual({eligible:false,blockingDependencyIds:[],reason:'work_intelligence_classification_missing'});
});
