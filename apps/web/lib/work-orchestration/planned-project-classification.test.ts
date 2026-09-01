import { ensurePlannedProjectClassification } from './planned-project-classification';

const item={state:'approved',proposal_version:3,impact_level:'low',capability:'programming',intent:{planner:'openai_project_tools_v1',execution_spec:{target:{kind:'project',reference:'anima'},permissions:['workspace_read','workspace_write_isolated'],validation_criteria:[{label:'test',command:'npm test'}],limits:{max_attempts:3,max_duration_minutes:30}}}};

test('registra somente a classificação ausente sem iniciar claim ou attempt',async()=>{
  const maybeSingle=jest.fn().mockResolvedValue({data:item,error:null});
  const eq=jest.fn(()=>({maybeSingle}));const select=jest.fn(()=>({eq}));const from=jest.fn(()=>({select}));
  const rpc=jest.fn().mockImplementation((name:string)=>name==='current_work_intelligence_classification'?Promise.resolve({data:null,error:null}):Promise.resolve({data:{},error:null}));
  await expect(ensurePlannedProjectClassification({from,rpc} as never,'item',3,()=>new Date('2026-08-25T00:00:00Z'))).resolves.toEqual({ok:true,replayed:false});
  expect(rpc.mock.calls.map(call=>call[0])).toEqual(['current_work_intelligence_classification','record_work_intelligence_classification']);
  expect(rpc.mock.calls[1][1].p_classification).toMatchObject({risk:'low',reversibility:'reversible'});
  expect(from).toHaveBeenCalledWith('work_items');
});

test('falha fechado fora do envelope planejado',async()=>{
  const maybeSingle=jest.fn().mockResolvedValue({data:{...item,state:'in_progress'},error:null});
  const client={from:jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle}))}))})),rpc:jest.fn()};
  await expect(ensurePlannedProjectClassification(client as never,'item',3)).resolves.toMatchObject({ok:false,code:'classification_policy_not_applicable',message:expect.stringContaining('in_progress')});
  expect(client.rpc).not.toHaveBeenCalled();
});

test('classifica conservadoramente proposta estrutural já aprovada pelo humano',async()=>{
  const maybeSingle=jest.fn().mockResolvedValue({data:{...item,impact_level:'structural'},error:null});
  const rpc=jest.fn().mockImplementation((name:string)=>name==='current_work_intelligence_classification'?Promise.resolve({data:null,error:null}):Promise.resolve({data:{action:'recorded'},error:null}));
  const client={from:jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle}))}))})),rpc};
  await expect(ensurePlannedProjectClassification(client as never,'item',3,()=>new Date('2026-08-25T00:00:00Z'))).resolves.toEqual({ok:true,replayed:false});
  expect(rpc.mock.calls[1][1].p_classification).toMatchObject({complexity:'bounded',risk:'moderate',reversibility:'conditionally_reversible',planClarity:'clear',urgency:'normal'});
});

test('reconhece proveniência canônica válida após revisão humana sem depender da metadata do planner',async()=>{
  const canonical={...item,intent:{
    planner:'operator_revision_after_local_planner_v1',
    canonical_provenance:{kind:'canonical_backlog',sourceId:'PIN-02',document:'docs/planos/006-project-intake-v0.md',heading:'PIN-02 — Codec persistível puro',canonicalObjective:'Codec persistível puro',planningGeneration:1,materializationReason:'selected_ready'},
    execution_spec:item.intent.execution_spec,
  }};
  const maybeSingle=jest.fn().mockResolvedValue({data:canonical,error:null});
  const rpc=jest.fn().mockImplementation((name:string)=>name==='current_work_intelligence_classification'?Promise.resolve({data:null,error:null}):Promise.resolve({data:{},error:null}));
  const client={from:jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle}))}))})),rpc};
  await expect(ensurePlannedProjectClassification(client as never,'pin-02',3,()=>new Date('2026-09-01T00:00:00Z'))).resolves.toEqual({ok:true,replayed:false});
  expect(rpc.mock.calls[1][1].p_classification.provenance.classifierId).toBe('canonical_backlog_v1-bridge');
});

test('não confia em proveniência canônica malformada para substituir planner desconhecido',async()=>{
  const malformed={...item,intent:{planner:'operator_revision',canonical_provenance:{kind:'canonical_backlog',sourceId:'PIN-02'},execution_spec:item.intent.execution_spec}};
  const maybeSingle=jest.fn().mockResolvedValue({data:malformed,error:null});
  const client={from:jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle}))}))})),rpc:jest.fn()};
  await expect(ensurePlannedProjectClassification(client as never,'pin-02',3)).resolves.toMatchObject({ok:false,code:'classification_policy_not_applicable'});
  expect(client.rpc).not.toHaveBeenCalled();
});

test('reconcilia corrida de escrita como replay sem duplicar classificação',async()=>{
  const maybeSingle=jest.fn().mockResolvedValue({data:item,error:null});let reads=0;
  const rpc=jest.fn().mockImplementation((name:string)=>name==='record_work_intelligence_classification'?Promise.resolve({data:null,error:{code:'55000',message:'revision changed'}}):Promise.resolve({data:++reads===1?null:{classification:{schemaVersion:1}},error:null}));
  const client={from:jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle}))}))})),rpc};
  await expect(ensurePlannedProjectClassification(client as never,'item',3)).resolves.toEqual({ok:true,replayed:true});
  expect(rpc.mock.calls.map(call=>call[0])).toEqual(['current_work_intelligence_classification','record_work_intelligence_classification','current_work_intelligence_classification']);
});

test('classifica successor governado pela lineage sem adulterar o intent aprovado',async()=>{
  const successor={...item,intent:{execution_spec:{...item.intent.execution_spec,resume_from_checkpoint:{base_sha:'a'.repeat(40),branch:'anima-work/attempt',commit_sha:'b'.repeat(40)}}}};
  const maybeSingles=[
    {data:successor,error:null},
    {data:{original_work_item_id:'original'},error:null},
    {data:{intent:{planner:'openai_project_tools_v1'}},error:null},
  ];
  const fromNames:string[]=[];
  const from=jest.fn((name:string)=>{fromNames.push(name);return {select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle:jest.fn().mockImplementation(()=>Promise.resolve(maybeSingles.shift()))}))}))};});
  const rpc=jest.fn().mockImplementation((name:string)=>name==='current_work_intelligence_classification'?Promise.resolve({data:null,error:null}):Promise.resolve({data:{},error:null}));
  await expect(ensurePlannedProjectClassification({from,rpc} as never,'successor',3,()=>new Date('2026-08-29T00:00:00Z'))).resolves.toEqual({ok:true,replayed:false});
  expect(fromNames).toEqual(['work_items','work_recovery_lineage','work_items']);
  expect(rpc.mock.calls[1][1].p_classification.provenance.classifierId).toBe('openai_project_tools_v1-bridge');
  expect(successor.intent).not.toHaveProperty('planner');
});

test('não confia em resume_from_checkpoint sem lineage persistida',async()=>{
  const successor={...item,intent:{execution_spec:{...item.intent.execution_spec,resume_from_checkpoint:{base_sha:'a'.repeat(40),branch:'anima-work/attempt',commit_sha:'b'.repeat(40)}}}};
  const maybeSingles=[{data:successor,error:null},{data:null,error:null}];
  const from=jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle:jest.fn().mockImplementation(()=>Promise.resolve(maybeSingles.shift()))}))}))}));
  const rpc=jest.fn();
  await expect(ensurePlannedProjectClassification({from,rpc} as never,'orphan',3)).resolves.toMatchObject({ok:false,code:'classification_policy_not_applicable'});
  expect(rpc).not.toHaveBeenCalled();
});
