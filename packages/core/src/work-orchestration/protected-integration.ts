import type { IntegrationBoundary } from './integration-boundary';
import { buildIntegrationPublicationRequest } from './integration-publication';
import type { WorktreeHandoffV1 } from './worktree-handoff';

const SHA=/^[a-f0-9]{40}$/;
const nonBlank=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const safeRef=(value:unknown):value is string=>nonBlank(value)&&value.length<=256&&!/[\s~^:?*[\\]/.test(value)&&!value.includes('..')&&!value.endsWith('/')&&!value.endsWith('.lock');

export interface IntegrationTarget {
  readonly providerId:string;
  readonly repositoryId:string;
  readonly remoteName:string;
  readonly baseBranch:string;
}

export interface ProtectedIntegrationRequest {
  readonly protocolVersion:1;
  readonly idempotencyKey:string;
  readonly authorizationDecisionId:string;
  readonly acceptedResultEventId:string;
  readonly correlation:{readonly workItemId:string;readonly attemptId:string;readonly approvedProposalVersion:number};
  readonly target:IntegrationTarget;
  readonly baseSha:string;
  readonly localBranch:string;
  readonly remoteBranch:string;
  readonly commitSha:string;
}

export type ProtectedIntegrationDefect='not_authorized'|'invalid_target'|'invalid_request'|'receipt_mismatch'|'step_out_of_order'|'receipt_conflict';
export type ProtectedIntegrationResult<T>={readonly ok:true;readonly value:T}|{readonly ok:false;readonly defect:ProtectedIntegrationDefect;readonly explanation:string};
const fail=<T>(defect:ProtectedIntegrationDefect,explanation:string):ProtectedIntegrationResult<T>=>({ok:false,defect,explanation});

export function buildProtectedIntegrationRequest(boundary:IntegrationBoundary,handoff:WorktreeHandoffV1,target:IntegrationTarget):ProtectedIntegrationResult<ProtectedIntegrationRequest>{
  const publication=buildIntegrationPublicationRequest(boundary,handoff);
  if(!publication.ok)return fail(publication.defect==='not_authorized'?'not_authorized':'invalid_request',publication.explanation);
  if(!nonBlank(target.providerId)||!nonBlank(target.repositoryId)||!safeRef(target.remoteName)||!safeRef(target.baseBranch))return fail('invalid_target','Provider, repositório, remote e branch-base precisam ser explícitos e seguros.');
  const request=publication.value;
  return{ok:true,value:{protocolVersion:1,idempotencyKey:request.idempotencyKey,authorizationDecisionId:request.authorizationDecisionId,acceptedResultEventId:request.acceptedResultEventId,correlation:request.correlation,target:{...target},baseSha:request.baseSha,localBranch:request.branch,remoteBranch:request.branch,commitSha:request.commitSha}};
}

export interface BranchPublicationReceipt {
  readonly kind:'branch_publication';readonly receiptId:string;readonly idempotencyKey:string;readonly providerId:string;readonly repositoryId:string;
  readonly remoteName:string;readonly remoteBranch:string;readonly commitSha:string;readonly baseBranch:string;readonly verifiedBaseSha:string;readonly disposition:'created'|'already_existed';
}
export interface ReviewRequestReceipt {
  readonly kind:'review_request';readonly receiptId:string;readonly idempotencyKey:string;readonly providerId:string;readonly repositoryId:string;
  readonly reviewId:string;readonly reviewReference:string;readonly sourceBranch:string;readonly sourceCommitSha:string;readonly baseBranch:string;readonly verifiedBaseSha:string;readonly disposition:'created'|'already_existed';
}

export type ProtectedIntegrationState=
  |{readonly status:'integration_authorized';readonly request:ProtectedIntegrationRequest}
  |{readonly status:'branch_published';readonly request:ProtectedIntegrationRequest;readonly branchReceipt:BranchPublicationReceipt}
  |{readonly status:'review_request_created';readonly request:ProtectedIntegrationRequest;readonly branchReceipt:BranchPublicationReceipt;readonly reviewReceipt:ReviewRequestReceipt};

export const beginProtectedIntegration=(request:ProtectedIntegrationRequest):ProtectedIntegrationState=>({status:'integration_authorized',request});
export const branchPublicationKey=(request:ProtectedIntegrationRequest):string=>`${request.idempotencyKey}:branch`;
export const reviewRequestKey=(request:ProtectedIntegrationRequest):string=>`${request.idempotencyKey}:review`;

const sameBranchReceipt=(left:BranchPublicationReceipt,right:BranchPublicationReceipt):boolean=>left.kind===right.kind&&left.receiptId===right.receiptId&&left.idempotencyKey===right.idempotencyKey&&left.providerId===right.providerId&&left.repositoryId===right.repositoryId&&left.remoteName===right.remoteName&&left.remoteBranch===right.remoteBranch&&left.commitSha===right.commitSha&&left.baseBranch===right.baseBranch&&left.verifiedBaseSha===right.verifiedBaseSha&&left.disposition===right.disposition;
const sameReviewReceipt=(left:ReviewRequestReceipt,right:ReviewRequestReceipt):boolean=>left.kind===right.kind&&left.receiptId===right.receiptId&&left.idempotencyKey===right.idempotencyKey&&left.providerId===right.providerId&&left.repositoryId===right.repositoryId&&left.reviewId===right.reviewId&&left.reviewReference===right.reviewReference&&left.sourceBranch===right.sourceBranch&&left.sourceCommitSha===right.sourceCommitSha&&left.baseBranch===right.baseBranch&&left.verifiedBaseSha===right.verifiedBaseSha&&left.disposition===right.disposition;
const validBranchReceipt=(request:ProtectedIntegrationRequest,receipt:BranchPublicationReceipt):boolean=>receipt.kind==='branch_publication'&&nonBlank(receipt.receiptId)&&receipt.idempotencyKey===branchPublicationKey(request)&&receipt.providerId===request.target.providerId&&receipt.repositoryId===request.target.repositoryId&&receipt.remoteName===request.target.remoteName&&receipt.remoteBranch===request.remoteBranch&&receipt.commitSha===request.commitSha&&receipt.baseBranch===request.target.baseBranch&&receipt.verifiedBaseSha===request.baseSha&&SHA.test(receipt.commitSha)&&SHA.test(receipt.verifiedBaseSha)&&(receipt.disposition==='created'||receipt.disposition==='already_existed');
const validReviewReceipt=(request:ProtectedIntegrationRequest,receipt:ReviewRequestReceipt):boolean=>receipt.kind==='review_request'&&nonBlank(receipt.receiptId)&&receipt.idempotencyKey===reviewRequestKey(request)&&receipt.providerId===request.target.providerId&&receipt.repositoryId===request.target.repositoryId&&nonBlank(receipt.reviewId)&&nonBlank(receipt.reviewReference)&&receipt.sourceBranch===request.remoteBranch&&receipt.sourceCommitSha===request.commitSha&&receipt.baseBranch===request.target.baseBranch&&receipt.verifiedBaseSha===request.baseSha&&SHA.test(receipt.sourceCommitSha)&&SHA.test(receipt.verifiedBaseSha)&&(receipt.disposition==='created'||receipt.disposition==='already_existed');

export function recordBranchPublished(state:ProtectedIntegrationState,receipt:BranchPublicationReceipt):ProtectedIntegrationResult<ProtectedIntegrationState>{
  if(state.status!=='integration_authorized')return 'branchReceipt'in state&&sameBranchReceipt(state.branchReceipt,receipt)?{ok:true,value:state}:fail('receipt_conflict','A branch já foi registrada com receipt divergente.');
  if(!validBranchReceipt(state.request,receipt))return fail('receipt_mismatch','O receipt da branch não comprova exatamente repositório, branch, commit, base e autorização esperados.');
  return{ok:true,value:{status:'branch_published',request:state.request,branchReceipt:receipt}};
}
export function recordReviewRequestCreated(state:ProtectedIntegrationState,receipt:ReviewRequestReceipt):ProtectedIntegrationResult<ProtectedIntegrationState>{
  if(state.status==='integration_authorized')return fail('step_out_of_order','Um review request exige branch publicada e verificada.');
  if(state.status==='review_request_created')return sameReviewReceipt(state.reviewReceipt,receipt)?{ok:true,value:state}:fail('receipt_conflict','O review request já foi registrado com receipt divergente.');
  if(!validReviewReceipt(state.request,receipt))return fail('receipt_mismatch','O receipt do review request não comprova exatamente repositório, source, commit, base e autorização esperados.');
  return{ok:true,value:{status:'review_request_created',request:state.request,branchReceipt:state.branchReceipt,reviewReceipt:receipt}};
}

export type ProtectedIntegrationNextAction='inspect_or_publish_branch'|'inspect_or_create_review_request'|'await_human_merge_decision';
export const nextProtectedIntegrationAction=(state:ProtectedIntegrationState):ProtectedIntegrationNextAction=>state.status==='integration_authorized'?'inspect_or_publish_branch':state.status==='branch_published'?'inspect_or_create_review_request':'await_human_merge_decision';

/** Porta inerte: o provider real deve sempre inspecionar/reconciliar antes de mutar. */
export interface ProtectedIntegrationProvider {
  readonly id:string;
  inspectBranch(request:ProtectedIntegrationRequest,signal?:AbortSignal):Promise<BranchPublicationReceipt|null>;
  publishBranch(request:ProtectedIntegrationRequest,signal?:AbortSignal):Promise<BranchPublicationReceipt>;
}
/** Extensão futura, deliberadamente fora da autorização de publicação de branch. */
export interface ReviewRequestProvider extends ProtectedIntegrationProvider {
  inspectReviewRequest(request:ProtectedIntegrationRequest,branch:BranchPublicationReceipt,signal?:AbortSignal):Promise<ReviewRequestReceipt|null>;
  createReviewRequest(request:ProtectedIntegrationRequest,branch:BranchPublicationReceipt,signal?:AbortSignal):Promise<ReviewRequestReceipt>;
}
