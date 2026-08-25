import { ensurePlannedProjectClassification } from './planned-project-classification';

const item={state:'approved',proposal_version:3,impact_level:'low',capability:'programming',intent:{planner:'openai_project_tools_v1',execution_spec:{target:{kind:'project',reference:'anima'},permissions:['workspace_read','workspace_write_isolated'],validation_criteria:[{label:'test',command:'npm test'}],limits:{max_attempts:3,max_duration_minutes:30}}}};

test('registra somente a classificação ausente sem iniciar claim ou attempt',async()=>{
  const maybeSingle=jest.fn().mockResolvedValue({data:item,error:null});
  const eq=jest.fn(()=>({maybeSingle}));const select=jest.fn(()=>({eq}));const from=jest.fn(()=>({select}));
  const rpc=jest.fn().mockImplementation((name:string)=>name==='current_work_intelligence_classification'?Promise.resolve({data:null,error:null}):Promise.resolve({data:{},error:null}));
  await expect(ensurePlannedProjectClassification({from,rpc} as never,'item',3,()=>new Date('2026-08-25T00:00:00Z'))).resolves.toEqual({ok:true,replayed:false});
  expect(rpc.mock.calls.map(call=>call[0])).toEqual(['current_work_intelligence_classification','record_work_intelligence_classification']);
  expect(from).toHaveBeenCalledWith('work_items');
});

test('falha fechado fora do envelope planejado',async()=>{
  const maybeSingle=jest.fn().mockResolvedValue({data:{...item,state:'in_progress'},error:null});
  const client={from:jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle}))}))})),rpc:jest.fn()};
  await expect(ensurePlannedProjectClassification(client as never,'item',3)).resolves.toEqual({ok:false,code:'classification_policy_not_applicable'});
  expect(client.rpc).not.toHaveBeenCalled();
});
