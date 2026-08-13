/** @jest-environment node */
import type{BranchPublicationReceipt,ProtectedIntegrationProvider,ProtectedIntegrationRequest}from'@anima/core';import{branchPublicationKey}from'@anima/core';
import{GitHubReviewRequestProvider,ReviewRequestFailure,parseGitHubRepository,githubReviewRequestConfigFromEnvironment}from'./github-review-request';

const BASE='a'.repeat(40),COMMIT='b'.repeat(40);
const request=(over:Partial<ProtectedIntegrationRequest>={}):ProtectedIntegrationRequest=>({protocolVersion:1,idempotencyKey:`integration-publication:auth:${COMMIT}`,authorizationDecisionId:'auth',acceptedResultEventId:'result',correlation:{workItemId:'work',attemptId:'attempt',approvedProposalVersion:1},target:{providerId:'git-branch-publication-v1',repositoryId:'https://github.com/anima/repo',remoteName:'origin',baseBranch:'main'},baseSha:BASE,localBranch:'anima-work/attempt',remoteBranch:'anima-work/attempt',commitSha:COMMIT,...over});
const branchReceipt:BranchPublicationReceipt={kind:'branch_publication',receiptId:'b',idempotencyKey:branchPublicationKey(request()),providerId:'git-branch-publication-v1',repositoryId:'https://github.com/anima/repo',remoteName:'origin',remoteBranch:'anima-work/attempt',commitSha:COMMIT,baseBranch:'main',verifiedBaseSha:BASE,disposition:'created'};
const branchProvider=():ProtectedIntegrationProvider=>({id:'git-branch-publication-v1',inspectBranch:jest.fn(),publishBranch:jest.fn()});
const pull=(over:Record<string,unknown>={})=>({number:42,html_url:'https://github.com/anima/repo/pull/42',state:'open',head:{ref:'anima-work/attempt',sha:COMMIT},base:{ref:'main'},...over});

interface Call{method:string;url:string;body:unknown;headers:Record<string,string>}
function mockFetch(handler:(call:Call,i:number)=>{status:number;body:unknown}):{fetchImpl:typeof fetch;calls:Call[]}{
  const calls:Call[]=[];
  const fetchImpl=(async(url:string,init:{method:string;body?:string;headers:Record<string,string>})=>{
    const call:Call={method:init.method,url,body:init.body?JSON.parse(init.body):undefined,headers:init.headers};
    calls.push(call);
    const{status,body}=handler(call,calls.length-1);
    return{status,json:async()=>body};
  })as unknown as typeof fetch;
  return{fetchImpl,calls};
}
const make=(fetchImpl:typeof fetch,token='tok')=>new GitHubReviewRequestProvider(branchProvider(),{apiBaseUrl:'https://api.github.test',token,fetchImpl});

describe('parseGitHubRepository',()=>{
  test.each([
    ['https://github.com/anima/repo',{owner:'anima',repo:'repo'}],
    ['https://github.com/anima/repo.git',{owner:'anima',repo:'repo'}],
    ['git@github.com:anima/repo.git',{owner:'anima',repo:'repo'}],
    ['anima/repo',{owner:'anima',repo:'repo'}],
    ['https://ghe.example.com/org/anima/repo',{owner:'anima',repo:'repo'}],
  ])('%s resolve',(input,expected)=>expect(parseGitHubRepository(input as string)).toEqual(expected));
  test.each(['','repo','https://github.com/anima/re po',' /'])('%p é recusado',input=>expect(parseGitHubRepository(input)).toBeNull());
});

describe('GitHubReviewRequestProvider — nenhuma chamada antes de validar',()=>{
  test('token ausente falha credentials_missing sem tocar a rede',async()=>{const{fetchImpl,calls}=mockFetch(()=>({status:200,body:[]}));await expect(make(fetchImpl,'').createReviewRequest(request(),branchReceipt)).rejects.toMatchObject({code:'credentials_missing'});expect(calls).toHaveLength(0);});
  test('providerId divergente falha invalid_request sem tocar a rede',async()=>{const{fetchImpl,calls}=mockFetch(()=>({status:200,body:[]}));await expect(make(fetchImpl).createReviewRequest(request({target:{providerId:'outro',repositoryId:'https://github.com/anima/repo',remoteName:'origin',baseBranch:'main'}}),branchReceipt)).rejects.toMatchObject({code:'invalid_request'});expect(calls).toHaveLength(0);});
  test('head fora do namespace anima falha invalid_request sem rede',async()=>{const{fetchImpl,calls}=mockFetch(()=>({status:200,body:[]}));await expect(make(fetchImpl).createReviewRequest(request({localBranch:'feature/x',remoteBranch:'feature/x'}),branchReceipt)).rejects.toMatchObject({code:'invalid_request'});expect(calls).toHaveLength(0);});
  test('head igual à base falha invalid_request sem rede',async()=>{const{fetchImpl,calls}=mockFetch(()=>({status:200,body:[]}));await expect(make(fetchImpl).createReviewRequest(request({localBranch:'main',remoteBranch:'main'}),branchReceipt)).rejects.toMatchObject({code:'invalid_request'});expect(calls).toHaveLength(0);});
  test('repositoryId irresolvível falha repository_mismatch sem rede',async()=>{const{fetchImpl,calls}=mockFetch(()=>({status:200,body:[]}));await expect(make(fetchImpl).createReviewRequest(request({target:{providerId:'git-branch-publication-v1',repositoryId:'sem-barra',remoteName:'origin',baseBranch:'main'}}),branchReceipt)).rejects.toMatchObject({code:'repository_mismatch'});expect(calls).toHaveLength(0);});
});

describe('GitHubReviewRequestProvider — inspeção é somente leitura',()=>{
  test('sem PR retorna null e NUNCA emite POST',async()=>{const{fetchImpl,calls}=mockFetch(()=>({status:200,body:[]}));const out=await make(fetchImpl).inspectReviewRequest(request(),branchReceipt);expect(out).toBeNull();expect(calls.every(c=>c.method==='GET')).toBe(true);});
  test('PR exato retorna receipt already_existed',async()=>{const{fetchImpl}=mockFetch(()=>({status:200,body:[pull()]}));const out=await make(fetchImpl).inspectReviewRequest(request(),branchReceipt);expect(out).toMatchObject({kind:'review_request',reviewId:'42',state:'open',disposition:'already_existed',sourceCommitSha:COMMIT});});
  test('PR na mesma head em commit divergente é conflito',async()=>{const{fetchImpl}=mockFetch(()=>({status:200,body:[pull({head:{ref:'anima-work/attempt',sha:'c'.repeat(40)}})]}));await expect(make(fetchImpl).inspectReviewRequest(request(),branchReceipt)).rejects.toMatchObject({code:'conflict'});});
  test('Authorization Bearer acompanha a chamada',async()=>{const{fetchImpl,calls}=mockFetch(()=>({status:200,body:[]}));await make(fetchImpl).inspectReviewRequest(request(),branchReceipt);expect(calls[0]!.headers.Authorization).toBe('Bearer tok');});
});

describe('GitHubReviewRequestProvider — criação idempotente (create-or-get)',()=>{
  test('cria via POST 201 só quando não existe; exatamente um POST',async()=>{const{fetchImpl,calls}=mockFetch(call=>call.method==='POST'?({status:201,body:pull()}):({status:200,body:[]}));const out=await make(fetchImpl).createReviewRequest(request(),branchReceipt);expect(out).toMatchObject({disposition:'created',reviewId:'42',reviewReference:'https://github.com/anima/repo/pull/42'});const posts=calls.filter(c=>c.method==='POST');expect(posts).toHaveLength(1);expect(posts[0]!.body).toMatchObject({head:'anima-work/attempt',base:'main'});expect(calls[0]!.method).toBe('GET');});
  test('PR já existente reconcilia sem POST',async()=>{const{fetchImpl,calls}=mockFetch(()=>({status:200,body:[pull()]}));const out=await make(fetchImpl).createReviewRequest(request(),branchReceipt);expect(out.disposition).toBe('already_existed');expect(calls.some(c=>c.method==='POST')).toBe(false);});
  test('POST 422 (corrida) reconcilia por releitura',async()=>{let getCount=0;const{fetchImpl}=mockFetch(call=>{if(call.method==='POST')return{status:422,body:{message:'A pull request already exists'}};getCount++;return{status:200,body:getCount<=1?[]:[pull()]};});const out=await make(fetchImpl).createReviewRequest(request(),branchReceipt);expect(out.disposition).toBe('already_existed');});
  test('POST 422 sem PR na releitura falha validation_failed',async()=>{const{fetchImpl}=mockFetch(call=>call.method==='POST'?({status:422,body:{message:'x'}}):({status:200,body:[]}));await expect(make(fetchImpl).createReviewRequest(request(),branchReceipt)).rejects.toMatchObject({code:'validation_failed'});});
  test('resposta 201 com head divergente falha review_unverified (pós-verificação)',async()=>{const{fetchImpl}=mockFetch(call=>call.method==='POST'?({status:201,body:pull({head:{ref:'anima-work/attempt',sha:'c'.repeat(40)}})}):({status:200,body:[]}));await expect(make(fetchImpl).createReviewRequest(request(),branchReceipt)).rejects.toMatchObject({code:'review_unverified'});});
});

describe('GitHubReviewRequestProvider — mapeamento de erros HTTP',()=>{
  test.each([[401,'not_authorized'],[403,'not_authorized'],[404,'repository_not_found'],[409,'conflict'],[429,'rate_limited'],[500,'provider_unavailable'],[502,'provider_unavailable']] as const)('GET %i → %s',async(status,code)=>{const{fetchImpl}=mockFetch(()=>({status,body:{}}));await expect(make(fetchImpl).inspectReviewRequest(request(),branchReceipt)).rejects.toMatchObject({code});});
  test('erro de rede vira provider_unavailable',async()=>{const fetchImpl=(async()=>{throw new Error('ECONNREFUSED');})as unknown as typeof fetch;await expect(make(fetchImpl).inspectReviewRequest(request(),branchReceipt)).rejects.toMatchObject({code:'provider_unavailable'});});
});

describe('githubReviewRequestConfigFromEnvironment — fail-closed',()=>{
  test('sem token retorna null',()=>expect(githubReviewRequestConfigFromEnvironment({})).toBeNull());
  test('com token usa a API padrão',()=>expect(githubReviewRequestConfigFromEnvironment({ANIMA_INTEGRATION_GITHUB_TOKEN:'t'})).toEqual({apiBaseUrl:'https://api.github.com',token:'t'}));
  test('API base override é respeitada e normalizada',()=>expect(githubReviewRequestConfigFromEnvironment({ANIMA_INTEGRATION_GITHUB_TOKEN:'t',ANIMA_INTEGRATION_GITHUB_API_URL:'https://ghe.example.com/api/v3/'})).toEqual({apiBaseUrl:'https://ghe.example.com/api/v3',token:'t'}));
  test('API base não-http é recusada',()=>expect(githubReviewRequestConfigFromEnvironment({ANIMA_INTEGRATION_GITHUB_TOKEN:'t',ANIMA_INTEGRATION_GITHUB_API_URL:'ftp://x'})).toBeNull());
});

test('ReviewRequestFailure preserva o código',()=>{const e=new ReviewRequestFailure('conflict','x');expect(e.code).toBe('conflict');expect(e.name).toBe('ReviewRequestFailure');});
