import { evaluateGovernedRetry,type GovernedRetryInput } from './governed-retry';
const base:GovernedRetryInput={state:'failed',proposalVersion:2,failure:{eventId:'failure-1',attemptId:'attempt-1',proposalVersion:2,retryable:true},attemptsUsed:1,maxAttempts:2,approvalValid:true,classificationValid:true,dependenciesSatisfied:true,openClaim:false,activeAttempt:false,targetValid:true};
const decide=(over:Partial<GovernedRetryInput>)=>evaluateGovernedRetry({...base,...over});
describe('retry governado',()=>{
  test('falha retryable com 1/2 chega a RETRY_READY',()=>expect(decide({})).toEqual({status:'RETRY_READY',attemptsUsed:1,maxAttempts:2,remainingAttempts:1,sourceAttemptId:'attempt-1',failureEventId:'failure-1'}));
  test.each([
    ['estado', {state:'approved'},'item_not_failed'],
    ['non-retryable',{failure:{...base.failure!,retryable:false}},'latest_failure_not_retryable'],
    ['sem falha',{failure:null},'latest_failure_not_retryable'],
    ['proposal mudou',{proposalVersion:3},'proposal_changed'],
    ['approval inválido',{approvalValid:false},'approval_invalid'],
    ['budget esgotado',{attemptsUsed:2},'attempt_budget_exhausted'],
    ['claim aberto',{openClaim:true},'open_claim'],
    ['attempt ativa',{activeAttempt:true},'active_attempt'],
    ['dependência',{dependenciesSatisfied:false},'dependencies_unsatisfied'],
    ['target',{targetValid:false},'target_invalid'],
    ['classificação',{classificationValid:false},'classification_invalid'],
  ] as const)('%s falha fechado',(_,over,reason)=>expect(decide(over)).toEqual({status:'BLOCKED',reason}));
  test('terceira tentativa é impossível',()=>expect(decide({attemptsUsed:2,maxAttempts:2})).toEqual({status:'BLOCKED',reason:'attempt_budget_exhausted'}));
});
