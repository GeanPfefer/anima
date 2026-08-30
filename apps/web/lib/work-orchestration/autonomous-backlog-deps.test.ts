import { resumeLatestRetryCheckpoint } from './autonomous-backlog-deps';
import type { ExecutionContract } from './executor-selection';

const base='a'.repeat(40), initial='b'.repeat(40), latest='c'.repeat(40);
const contract:ExecutionContract={executor:'worktree',coderBackend:'ollama',model:'m',baseSha:base,targetKind:'project',targetReference:'anima',resumeCheckpointCommitSha:initial};

test('retry retoma o checkpoint observado da attempt fonte sem trocar a base',()=>{
  const events=[
    {event_type:'work_approved',payload:{data:{decision:'retry',source_attempt_id:'attempt-1'}}},
    {event_type:'host_observed_evidence_recorded',payload:{data:{attempt_id:'attempt-1',evidence:{baseSha:base,observedCommitSha:latest}}}},
  ];
  expect(resumeLatestRetryCheckpoint(contract,events)).toEqual({...contract,resumeCheckpointCommitSha:latest});
});

test('falha seguro sem retry ou com evidência de outra base',()=>{
  expect(resumeLatestRetryCheckpoint(contract,[])).toBe(contract);
  const events=[
    {event_type:'work_approved',payload:{data:{decision:'retry',source_attempt_id:'attempt-1'}}},
    {event_type:'host_observed_evidence_recorded',payload:{data:{attempt_id:'attempt-1',evidence:{baseSha:'d'.repeat(40),observedCommitSha:latest}}}},
  ];
  expect(resumeLatestRetryCheckpoint(contract,events)).toBe(contract);
});
