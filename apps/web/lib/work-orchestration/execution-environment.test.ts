import type { CreateWorkProposalCommand } from '@anima/core';
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
      limits:{max_attempts:3,max_duration_minutes:5},
    }});
  });
});
