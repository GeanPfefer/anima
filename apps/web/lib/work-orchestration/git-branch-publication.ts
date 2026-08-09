import { isAnimaWorktreeBranch,type BranchPublicationReceipt,type ProtectedIntegrationProvider,type ProtectedIntegrationRequest,branchPublicationKey } from '@anima/core';
import { runProcess,type CommandResult } from './worktree';

type GitRun=(args:readonly string[],signal?:AbortSignal)=>Promise<CommandResult>;
const SHA=/^[a-f0-9]{40}$/;
const oneSha=(output:string):string|null=>{const fields=output.trim().split(/\s+/);return fields.length>=1&&SHA.test(fields[0]!)?fields[0]!:null;};
const normalizeRepository=(value:string):string=>value.trim().replace(/\.git$/,'').replace(/^git@([^:]+):/,'https://$1/').toLowerCase();

export type BranchPublicationFailureCode='invalid_request'|'repository_mismatch'|'local_branch_missing'|'local_commit_mismatch'|'base_mismatch'|'remote_branch_conflict'|'remote_unavailable'|'push_unverified';
export class BranchPublicationFailure extends Error{constructor(readonly code:BranchPublicationFailureCode,message:string){super(message);this.name='BranchPublicationFailure';}}

export class GitBranchPublicationProvider implements ProtectedIntegrationProvider{
  readonly id='git-branch-publication-v1';
  private readonly run:GitRun;
  constructor(private readonly repoRoot:string,run?:GitRun){this.run=run??((args,signal)=>runProcess('git',['-C',repoRoot,...args],{cwd:repoRoot,timeoutMs:60_000,signal}));}
  private assertRequest(request:ProtectedIntegrationRequest):void{if(request.target.providerId!==this.id||!isAnimaWorktreeBranch(request.localBranch)||request.remoteBranch!==request.localBranch||!SHA.test(request.baseSha)||!SHA.test(request.commitSha))throw new BranchPublicationFailure('invalid_request','Request de publicação inválida ou fora do namespace autorizado.');}
  private async successful(args:readonly string[],code:BranchPublicationFailureCode,message:string,signal?:AbortSignal):Promise<CommandResult>{const result=await this.run(args,signal);if(result.exitCode!==0||result.timedOut||result.cancelled)throw new BranchPublicationFailure(code,message);return result;}
  private async preflight(request:ProtectedIntegrationRequest,signal?:AbortSignal):Promise<void>{
    this.assertRequest(request);
    const remoteUrl=await this.successful(['remote','get-url',request.target.remoteName],'repository_mismatch','Remote configurado não pôde ser comprovado.',signal);
    if(normalizeRepository(remoteUrl.stdout)!==normalizeRepository(request.target.repositoryId))throw new BranchPublicationFailure('repository_mismatch','O remote aponta para outro repositório.');
    const local=await this.successful(['rev-parse','--verify',`refs/heads/${request.localBranch}^{commit}`],'local_branch_missing','A branch local autorizada não existe.',signal);
    if(oneSha(local.stdout)!==request.commitSha)throw new BranchPublicationFailure('local_commit_mismatch','A branch local não aponta para o commit autorizado.');
    await this.successful(['cat-file','-e',`${request.commitSha}^{commit}`],'local_commit_mismatch','O commit autorizado não existe localmente.',signal);
    await this.successful(['merge-base','--is-ancestor',request.baseSha,request.commitSha],'base_mismatch','O commit não descende da base autorizada.',signal);
    const base=await this.successful(['ls-remote','--heads',request.target.remoteName,`refs/heads/${request.target.baseBranch}`],'remote_unavailable','A base remota não pôde ser inspecionada.',signal);
    if(oneSha(base.stdout)!==request.baseSha)throw new BranchPublicationFailure('base_mismatch','A base remota divergiu do SHA autorizado.');
  }
  private async remoteSha(request:ProtectedIntegrationRequest,signal?:AbortSignal):Promise<string|null>{const result=await this.successful(['ls-remote','--heads',request.target.remoteName,`refs/heads/${request.remoteBranch}`],'remote_unavailable','A branch remota não pôde ser inspecionada.',signal);return result.stdout.trim()?oneSha(result.stdout):null;}
  private receipt(request:ProtectedIntegrationRequest,disposition:'created'|'already_existed'):BranchPublicationReceipt{return{kind:'branch_publication',receiptId:`branch-receipt:${branchPublicationKey(request)}`,idempotencyKey:branchPublicationKey(request),providerId:this.id,repositoryId:request.target.repositoryId,remoteName:request.target.remoteName,remoteBranch:request.remoteBranch,commitSha:request.commitSha,baseBranch:request.target.baseBranch,verifiedBaseSha:request.baseSha,disposition};}
  async inspectBranch(request:ProtectedIntegrationRequest,signal?:AbortSignal):Promise<BranchPublicationReceipt|null>{await this.preflight(request,signal);const sha=await this.remoteSha(request,signal);if(sha===null)return null;if(sha!==request.commitSha)throw new BranchPublicationFailure('remote_branch_conflict','A branch remota já existe em commit divergente.');return this.receipt(request,'already_existed');}
  async publishBranch(request:ProtectedIntegrationRequest,signal?:AbortSignal):Promise<BranchPublicationReceipt>{
    const existing=await this.inspectBranch(request,signal);if(existing)return existing;
    const refspec=`refs/heads/${request.localBranch}:refs/heads/${request.remoteBranch}`;
    const push=await this.run(['push',request.target.remoteName,refspec],signal);
    const verified=await this.remoteSha(request,signal).catch(()=>null);
    if(verified===request.commitSha)return this.receipt(request,'created');
    if(push.exitCode!==0)throw new BranchPublicationFailure('push_unverified','O push falhou e o efeito remoto não pôde ser comprovado.');
    throw new BranchPublicationFailure('push_unverified','O push retornou sucesso, mas o remote não confirmou o commit esperado.');
  }
}
