/** @jest-environment node */
import{createServer,type Server}from'node:http';import{AddressInfo}from'node:net';
import type{BranchPublicationReceipt,ProtectedIntegrationProvider,ProtectedIntegrationRequest}from'@anima/core';import{branchPublicationKey}from'@anima/core';
import{GitHubReviewRequestProvider}from'./github-review-request';

// Servidor HTTP local que emula o GitHub: prova o transporte REAL (fetch global)
// sem tocar o GitHub. Registra cada chamada para comprovar a forma exata e que a
// inspeção NUNCA emite POST (nenhuma mutação real nesta sessão).
const BASE='a'.repeat(40),COMMIT='b'.repeat(40);
const branchProvider:ProtectedIntegrationProvider={id:'git-branch-publication-v1',inspectBranch:jest.fn(),publishBranch:jest.fn()};
const branchReceipt:BranchPublicationReceipt={kind:'branch_publication',receiptId:'b',idempotencyKey:'k',providerId:'git-branch-publication-v1',repositoryId:'https://github.com/anima/repo',remoteName:'origin',remoteBranch:'anima-work/attempt',commitSha:COMMIT,baseBranch:'main',verifiedBaseSha:BASE,disposition:'created'};

interface Recorded{method:string;path:string;head:string|null;auth:string|undefined;body:unknown}
let server:Server;let baseUrl='';let recorded:Recorded[]=[];let prs:Array<Record<string,unknown>>=[];let nextNumber=100;

beforeAll(async()=>{
  server=createServer((req,res)=>{
    let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
      const url=new URL(req.url!,'http://local');const body=raw?JSON.parse(raw):undefined;
      recorded.push({method:req.method!,path:url.pathname,head:url.searchParams.get('head'),auth:req.headers['authorization'],body});
      if(req.method==='GET'&&url.pathname==='/repos/anima/repo/pulls'){
        const head=url.searchParams.get('head');const branch=head?head.split(':').slice(1).join(':'):null;
        const match=prs.filter(p=>(p.head as{ref:string}).ref===branch);
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(match));return;
      }
      if(req.method==='POST'&&url.pathname==='/repos/anima/repo/pulls'){
        const b=body as{head:string;base:string};const number=nextNumber++;
        const pr={number,html_url:`https://github.com/anima/repo/pull/${number}`,state:'open',head:{ref:b.head,sha:COMMIT},base:{ref:b.base}};
        prs.push(pr);res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify(pr));return;
      }
      res.writeHead(404);res.end('{}');
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  baseUrl=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
beforeEach(()=>{recorded=[];prs=[];nextNumber=100;});

const request=():ProtectedIntegrationRequest=>({protocolVersion:1,idempotencyKey:`integration-publication:auth:${COMMIT}`,authorizationDecisionId:'auth',acceptedResultEventId:'result',correlation:{workItemId:'work',attemptId:'attempt',approvedProposalVersion:1},target:{providerId:'git-branch-publication-v1',repositoryId:'https://github.com/anima/repo',remoteName:'origin',baseBranch:'main'},baseSha:BASE,localBranch:'anima-work/attempt',remoteBranch:'anima-work/attempt',commitSha:COMMIT});
const provider=()=>new GitHubReviewRequestProvider(branchProvider,{apiBaseUrl:baseUrl,token:'tok'});

test('cria via transporte real: GET então exatamente um POST com head/base corretos e Bearer',async()=>{
  const out=await provider().createReviewRequest(request(),branchReceipt);
  expect(out).toMatchObject({disposition:'created',state:'open',sourceCommitSha:COMMIT,baseBranch:'main',sourceBranch:'anima-work/attempt'});
  expect(out.reviewReference).toMatch(/\/pull\/100$/);
  const posts=recorded.filter(r=>r.method==='POST');
  expect(posts).toHaveLength(1);
  expect(posts[0]!.body).toMatchObject({head:'anima-work/attempt',base:'main'});
  expect(recorded[0]!.method).toBe('GET');
  expect(recorded.every(r=>r.auth==='Bearer tok')).toBe(true);
},10_000);

test('idempotência real: segunda criação encontra o PR e NÃO emite novo POST',async()=>{
  await provider().createReviewRequest(request(),branchReceipt);
  recorded=[];
  const again=await provider().createReviewRequest(request(),branchReceipt);
  expect(again.disposition).toBe('already_existed');
  expect(recorded.some(r=>r.method==='POST')).toBe(false);
},10_000);

test('inspeção real jamais emite POST (nenhuma mutação)',async()=>{
  const none=await provider().inspectReviewRequest(request(),branchReceipt);
  expect(none).toBeNull();
  await provider().createReviewRequest(request(),branchReceipt);
  recorded=[];
  const found=await provider().inspectReviewRequest(request(),branchReceipt);
  expect(found?.disposition).toBe('already_existed');
  expect(recorded.every(r=>r.method==='GET')).toBe(true);
},10_000);
