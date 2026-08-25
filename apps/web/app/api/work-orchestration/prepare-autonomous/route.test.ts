/** @jest-environment node */
jest.mock('@/lib/supabase/server',()=>({createClient:jest.fn()}));
jest.mock('@/lib/work-orchestration/planned-project-classification',()=>({ensurePlannedProjectClassification:jest.fn()}));
import { createClient } from '@/lib/supabase/server';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';
import { POST } from './route';

const request=()=>({json:async()=>({workItemId:'0898a0c2-80ec-4b4d-a7a3-9fd5239268f9',expectedProposalVersion:3})}) as unknown as Request;

beforeEach(()=>{
  jest.resetAllMocks();
  (createClient as jest.Mock).mockResolvedValue({auth:{getUser:jest.fn().mockResolvedValue({data:{user:{id:'owner'}}})}});
});

test('propaga diagnóstico real do gate sem mensagem genérica',async()=>{
  (ensurePlannedProjectClassification as jest.Mock).mockResolvedValue({ok:false,code:'classification_policy_not_applicable',message:'impacto structural não admitido'});
  const response=await POST(request());
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({ok:false,error:{code:'classification_policy_not_applicable',message:'impacto structural não admitido'}});
});

test('retorna replay reconciliado como sucesso sem iniciar execução',async()=>{
  (ensurePlannedProjectClassification as jest.Mock).mockResolvedValue({ok:true,replayed:true});
  const response=await POST(request());
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ok:true,value:{ok:true,replayed:true}});
  expect(ensurePlannedProjectClassification).toHaveBeenCalledWith(expect.anything(),'0898a0c2-80ec-4b4d-a7a3-9fd5239268f9',3);
});
