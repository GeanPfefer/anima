import { evaluateAutonomousEligibility, type CreateWorkProposalCommand, type WorkItem } from '@anima/core';
import {
  configureUx02DeterministicProof,
  UX02_DETERMINISTIC_PROOF_PHRASE,
} from './execution';

const command:CreateWorkProposalCommand={
  sourceMessageId:'message-1',impactLevel:'low',capability:'planning',
  intent:{schema_version:1,mode:'construction'},
  proposal:{schemaVersion:1,data:{summary:'prova',objective:'prova',includedScope:['prova'],
    excludedScope:[],expectedEffects:['prova'],risks:[]}},
};

// Base com escopo concreto (incluído E excluído) para a ponte de elegibilidade:
// a frase precisa produzir um item que o predicado do AUTO-01 aceite.
const eligibleBase:CreateWorkProposalCommand={
  sourceMessageId:'message-2',impactLevel:'low',capability:'planning',
  intent:{schema_version:1,mode:'construction'},
  proposal:{schemaVersion:1,data:{
    summary:'Prova determinística do UX-02',
    objective:'Provar a interrupção por decisão necessária e a retomada pelo checkpoint',
    includedScope:['ux02-deterministic-decision'],
    excludedScope:['qualquer alteração fora do cenário determinístico fechado'],
    expectedEffects:['cartão de decisão necessária projetado do estado persistido'],
    risks:['nenhum: cenário determinístico local'],
  }},
};

const approvedItemFrom=(configured:CreateWorkProposalCommand):WorkItem=>({
  id:'22222222-2222-2222-2222-222222222222',
  userId:'33333333-3333-3333-3333-333333333333',
  sourceMessageId:configured.sourceMessageId,
  state:'approved',
  impactLevel:configured.impactLevel,
  capability:configured.capability,
  originalRequest:UX02_DETERMINISTIC_PROOF_PHRASE,
  intent:configured.intent,
  proposal:configured.proposal,
  proposalVersion:1,
  createdAt:new Date('2026-07-29T12:00:00.000Z'),
  updatedAt:new Date('2026-07-29T12:00:00.000Z'),
});

describe('configuração do cenário determinístico UX-02',()=>{
  const previous=process.env.ANIMA_UX02_DETERMINISTIC_PROOF;
  afterEach(()=>{
    if(previous===undefined)delete process.env.ANIMA_UX02_DETERMINISTIC_PROOF;
    else process.env.ANIMA_UX02_DETERMINISTIC_PROOF=previous;
  });
  test('fica desabilitada por padrão',()=>{
    delete process.env.ANIMA_UX02_DETERMINISTIC_PROOF;
    expect(configureUx02DeterministicProof(UX02_DETERMINISTIC_PROOF_PHRASE,command)).toBe(command);
  });
  test('recusa qualquer frase diferente mesmo com a flag explícita',()=>{
    process.env.ANIMA_UX02_DETERMINISTIC_PROOF='1';
    expect(configureUx02DeterministicProof(`${UX02_DETERMINISTIC_PROOF_PHRASE} agora`,command)).toBe(command);
  });
  test('configura somente a frase exata com a flag explícita',()=>{
    process.env.ANIMA_UX02_DETERMINISTIC_PROOF='1';
    const configured=configureUx02DeterministicProof(UX02_DETERMINISTIC_PROOF_PHRASE,command);
    expect(configured.capability).toBe('programming');
    expect(configured.intent).toMatchObject({execution_spec:{
      target:{kind:'project',reference:'ux02-deterministic-decision'},
      permissions:['workspace_read','workspace_write_isolated'],
      validation_criteria:[{label:'Retomar somente do checkpoint persistido'}],
      limits:{max_attempts:3,max_duration_minutes:5},
    }});
  });
  // Ponte que o pgTAP `ux02_deterministic_proof` assume mas não prova: a frase,
  // passada pela FUNÇÃO real de reconhecimento, produz um item que o predicado
  // do AUTO-01 aceita. É a fonte da verdade da forma do `execution_spec` que a
  // prova de banco reproduz em JSON.
  test('a frase real produz um item aprovado elegível para execução autônoma (AUTO-01)',()=>{
    process.env.ANIMA_UX02_DETERMINISTIC_PROOF='1';
    const configured=configureUx02DeterministicProof(UX02_DETERMINISTIC_PROOF_PHRASE,eligibleBase);
    const evaluation=evaluateAutonomousEligibility(approvedItemFrom(configured));
    expect(evaluation.eligible).toBe(true);
    if(evaluation.eligible){
      expect(evaluation.spec.target.reference).toBe('ux02-deterministic-decision');
      expect(evaluation.spec.permissions).toEqual(['workspace_read','workspace_write_isolated']);
      expect(evaluation.spec.validationCriteria).toEqual([{label:'Retomar somente do checkpoint persistido'}]);
      expect(evaluation.spec.limits).toEqual({maxAttempts:3,maxDurationMinutes:5});
    }
  });
});
