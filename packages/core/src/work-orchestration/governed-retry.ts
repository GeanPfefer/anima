export type RetryBlockReason='item_not_failed'|'latest_failure_not_retryable'|'proposal_changed'|'approval_invalid'|'attempt_budget_exhausted'|'open_claim'|'active_attempt'|'dependencies_unsatisfied'|'target_invalid'|'classification_invalid';
export type GovernedRetryDecision={readonly status:'RETRY_READY';readonly attemptsUsed:number;readonly maxAttempts:number;readonly remainingAttempts:number;readonly sourceAttemptId:string;readonly failureEventId:string}|{readonly status:'BLOCKED';readonly reason:RetryBlockReason};
export interface GovernedRetryInput{readonly state:string;readonly proposalVersion:number;readonly failure:{readonly eventId:string;readonly attemptId:string;readonly proposalVersion:number;readonly retryable:boolean}|null;readonly attemptsUsed:number;readonly maxAttempts:number;readonly approvalValid:boolean;readonly classificationValid:boolean;readonly dependenciesSatisfied:boolean;readonly openClaim:boolean;readonly activeAttempt:boolean;readonly targetValid:boolean;}

/** Política pura espelhada pela RPC autoritativa. Não cria reentry/claim/attempt. */
export function evaluateGovernedRetry(input:GovernedRetryInput):GovernedRetryDecision{
  if(input.state!=='failed')return{status:'BLOCKED',reason:'item_not_failed'};
  if(!input.failure?.retryable)return{status:'BLOCKED',reason:'latest_failure_not_retryable'};
  if(input.failure.proposalVersion!==input.proposalVersion)return{status:'BLOCKED',reason:'proposal_changed'};
  if(!input.approvalValid)return{status:'BLOCKED',reason:'approval_invalid'};
  if(input.maxAttempts<1||input.attemptsUsed>=input.maxAttempts)return{status:'BLOCKED',reason:'attempt_budget_exhausted'};
  if(input.openClaim)return{status:'BLOCKED',reason:'open_claim'};
  if(input.activeAttempt)return{status:'BLOCKED',reason:'active_attempt'};
  if(!input.dependenciesSatisfied)return{status:'BLOCKED',reason:'dependencies_unsatisfied'};
  if(!input.targetValid)return{status:'BLOCKED',reason:'target_invalid'};
  if(!input.classificationValid)return{status:'BLOCKED',reason:'classification_invalid'};
  return{status:'RETRY_READY',attemptsUsed:input.attemptsUsed,maxAttempts:input.maxAttempts,remainingAttempts:input.maxAttempts-input.attemptsUsed,sourceAttemptId:input.failure.attemptId,failureEventId:input.failure.eventId};
}
