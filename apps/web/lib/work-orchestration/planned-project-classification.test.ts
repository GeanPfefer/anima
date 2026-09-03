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

test('recupera a proveniência CANÔNICA do original via lineage quando o planner do original não é suportado (successor com intent reduzido)',async()=>{
  // Cenário PIN-02/5b8e371d: o original canônico teve o planner trocado por metadata de
  // operador (não suportada), mas mantém canonical_provenance válida; o successor copia só
  // o execution_spec. A preparação deve recuperar a origem canônica do original pela lineage.
  const successor={...item,intent:{execution_spec:{...item.intent.execution_spec,resume_from_checkpoint:{base_sha:'a'.repeat(40),branch:'anima-work/attempt',commit_sha:'b'.repeat(40)}}}};
  const canonicalOriginal={intent:{
    planner:'operator_revision_after_local_planner_v1',
    canonical_provenance:{kind:'canonical_backlog',sourceId:'PIN-02',document:'docs/planos/006-project-intake-v0.md',heading:'PIN-02 — Codec persistível puro',canonicalObjective:'Codec persistível puro',planningGeneration:1,materializationReason:'selected_ready'},
    execution_spec:item.intent.execution_spec,
  }};
  const maybeSingles=[{data:successor,error:null},{data:{original_work_item_id:'original'},error:null},{data:canonicalOriginal,error:null}];
  const fromNames:string[]=[];
  const from=jest.fn((name:string)=>{fromNames.push(name);return {select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle:jest.fn().mockImplementation(()=>Promise.resolve(maybeSingles.shift()))}))}))};});
  const rpc=jest.fn().mockImplementation((name:string)=>name==='current_work_intelligence_classification'?Promise.resolve({data:null,error:null}):Promise.resolve({data:{},error:null}));
  await expect(ensurePlannedProjectClassification({from,rpc} as never,'successor',3,()=>new Date('2026-09-02T00:00:00Z'))).resolves.toEqual({ok:true,replayed:false});
  expect(fromNames).toEqual(['work_items','work_recovery_lineage','work_items']);
  expect(rpc.mock.calls[1][1].p_classification.provenance.classifierId).toBe('canonical_backlog_v1-bridge');
  expect(successor.intent).not.toHaveProperty('planner');
});

test('fail-closed: successor cujo original não tem planner suportado NEM proveniência canônica válida',async()=>{
  const successor={...item,intent:{execution_spec:{...item.intent.execution_spec,resume_from_checkpoint:{base_sha:'a'.repeat(40),branch:'anima-work/attempt',commit_sha:'b'.repeat(40)}}}};
  // Original com planner de operador e proveniência canônica MALFORMADA (faltam campos) ⇒ nenhuma origem governada.
  const badOriginal={intent:{planner:'operator_revision_after_local_planner_v1',canonical_provenance:{kind:'canonical_backlog',sourceId:'PIN-02'},execution_spec:item.intent.execution_spec}};
  // Após o ancestral direto sem origem governada, a subida pela linhagem não encontra
  // outro pai (órfão no topo) ⇒ fail-closed.
  const maybeSingles=[{data:successor,error:null},{data:{original_work_item_id:'original'},error:null},{data:badOriginal,error:null},{data:null,error:null}];
  const from=jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle:jest.fn().mockImplementation(()=>Promise.resolve(maybeSingles.shift()))}))}))}));
  const rpc=jest.fn();
  await expect(ensurePlannedProjectClassification({from,rpc} as never,'successor',3)).resolves.toMatchObject({ok:false,code:'classification_policy_not_applicable'});
  expect(rpc).not.toHaveBeenCalled();
});

test('recupera a proveniência canônica por MÚLTIPLOS hops de lineage (correção → replan)',async()=>{
  // Cenário PIN-02 real: replan successor (sem provenance) → correção successor (sem
  // provenance) → original canônico (PIN-02). A subida precisa de 2 hops.
  const replanSuccessor={...item,intent:{execution_spec:{...item.intent.execution_spec,limits:{max_attempts:1,max_duration_minutes:30},resume_from_checkpoint:{base_sha:'a'.repeat(40),branch:'anima-work/attempt',commit_sha:'b'.repeat(40)}}}};
  const correctionSuccessor={intent:{execution_spec:{...item.intent.execution_spec,resume_from_checkpoint:{base_sha:'c'.repeat(40),branch:'anima-work/prev',commit_sha:'d'.repeat(40)}}}};
  const canonicalRoot={intent:{
    planner:'operator_revision_after_local_planner_v1',
    canonical_provenance:{kind:'canonical_backlog',sourceId:'PIN-02',document:'docs/planos/006-project-intake-v0.md',heading:'PIN-02 — Codec persistível puro',canonicalObjective:'Codec persistível puro',planningGeneration:1,materializationReason:'selected_ready'},
    execution_spec:item.intent.execution_spec,
  }};
  const maybeSingles=[
    {data:replanSuccessor,error:null},                     // work_items (candidato)
    {data:{original_work_item_id:'correction'},error:null},// lineage hop 0
    {data:correctionSuccessor,error:null},                 // work_items (correção: sem provenance)
    {data:{original_work_item_id:'root'},error:null},      // lineage hop 1
    {data:canonicalRoot,error:null},                       // work_items (raiz canônica)
  ];
  const fromNames:string[]=[];
  const from=jest.fn((name:string)=>{fromNames.push(name);return {select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle:jest.fn().mockImplementation(()=>Promise.resolve(maybeSingles.shift()))}))}))};});
  const rpc=jest.fn().mockImplementation((name:string)=>name==='current_work_intelligence_classification'?Promise.resolve({data:null,error:null}):Promise.resolve({data:{},error:null}));
  await expect(ensurePlannedProjectClassification({from,rpc} as never,'replan',3,()=>new Date('2026-09-02T00:00:00Z'))).resolves.toEqual({ok:true,replayed:false});
  expect(fromNames).toEqual(['work_items','work_recovery_lineage','work_items','work_recovery_lineage','work_items']);
  expect(rpc.mock.calls[1][1].p_classification.provenance.classifierId).toBe('canonical_backlog_v1-bridge');
});

test('fail-closed: ciclo de lineage não é aceito',async()=>{
  const successor={...item,intent:{execution_spec:{...item.intent.execution_spec,resume_from_checkpoint:{base_sha:'a'.repeat(40),branch:'anima-work/attempt',commit_sha:'b'.repeat(40)}}}};
  const noProvenance={intent:{execution_spec:{...item.intent.execution_spec,resume_from_checkpoint:{base_sha:'c'.repeat(40),branch:'anima-work/x',commit_sha:'d'.repeat(40)}}}};
  // candidato 'cycle' → 'other' → de volta a 'cycle' ⇒ ciclo detectado ⇒ fail-closed.
  const maybeSingles=[{data:successor,error:null},{data:{original_work_item_id:'other'},error:null},{data:noProvenance,error:null},{data:{original_work_item_id:'cycle'},error:null}];
  const from=jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle:jest.fn().mockImplementation(()=>Promise.resolve(maybeSingles.shift()))}))}))}));
  const rpc=jest.fn();
  await expect(ensurePlannedProjectClassification({from,rpc} as never,'cycle',3)).resolves.toMatchObject({ok:false,code:'classification_policy_not_applicable'});
  expect(rpc).not.toHaveBeenCalled();
});

test('classifica successor de replan com budget TRANSFERIDO (max_attempts=1) sem exigir 3',async()=>{
  // Plano 007: o replan transfere o saldo não consumido; o successor tem max_attempts<3.
  const replanned={...item,intent:{...item.intent,execution_spec:{...item.intent.execution_spec,limits:{max_attempts:1,max_duration_minutes:30}}}};
  const maybeSingle=jest.fn().mockResolvedValue({data:replanned,error:null});
  const rpc=jest.fn().mockImplementation((name:string)=>name==='current_work_intelligence_classification'?Promise.resolve({data:null,error:null}):Promise.resolve({data:{},error:null}));
  const client={from:jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle}))}))})),rpc};
  await expect(ensurePlannedProjectClassification(client as never,'item',3,()=>new Date('2026-09-02T00:00:00Z'))).resolves.toEqual({ok:true,replayed:false});
});

test('fail-closed: max_attempts fora do intervalo [1,3] não classifica',async()=>{
  const overBudget={...item,intent:{...item.intent,execution_spec:{...item.intent.execution_spec,limits:{max_attempts:4,max_duration_minutes:30}}}};
  const maybeSingle=jest.fn().mockResolvedValue({data:overBudget,error:null});
  const client={from:jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle}))}))})),rpc:jest.fn()};
  await expect(ensurePlannedProjectClassification(client as never,'item',3)).resolves.toMatchObject({ok:false,code:'classification_policy_not_applicable'});
  expect(client.rpc).not.toHaveBeenCalled();
});

test('não confia em resume_from_checkpoint sem lineage persistida',async()=>{
  const successor={...item,intent:{execution_spec:{...item.intent.execution_spec,resume_from_checkpoint:{base_sha:'a'.repeat(40),branch:'anima-work/attempt',commit_sha:'b'.repeat(40)}}}};
  const maybeSingles=[{data:successor,error:null},{data:null,error:null}];
  const from=jest.fn(()=>({select:jest.fn(()=>({eq:jest.fn(()=>({maybeSingle:jest.fn().mockImplementation(()=>Promise.resolve(maybeSingles.shift()))}))}))}));
  const rpc=jest.fn();
  await expect(ensurePlannedProjectClassification({from,rpc} as never,'orphan',3)).resolves.toMatchObject({ok:false,code:'classification_policy_not_applicable'});
  expect(rpc).not.toHaveBeenCalled();
});
