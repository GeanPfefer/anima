import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ProtectedIntegrationRequest} from '@anima/core';
import {GitBranchPublicationProvider} from './git-branch-publication';

const git=(cwd:string,...args:string[]):string=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).trim();

test('publica e reconcilia idempotentemente contra remote bare local real',async()=>{
  const root=mkdtempSync(join(tmpdir(),'anima-branch-publication-'));
  const remote=join(root,'remote.git'),repo=join(root,'repo');
  try{
    execFileSync('git',['init','--bare',remote]);
    execFileSync('git',['init','-b','main',repo]);
    git(repo,'config','user.name','Anima Test');git(repo,'config','user.email','anima@test.invalid');
    writeFileSync(join(repo,'base.txt'),'base\n');git(repo,'add','base.txt');git(repo,'commit','-m','base');
    const baseSha=git(repo,'rev-parse','HEAD');git(repo,'remote','add','origin',remote);git(repo,'push','origin','main');
    git(repo,'checkout','-b','anima-work/attempt-real');writeFileSync(join(repo,'work.txt'),'work\n');git(repo,'add','work.txt');git(repo,'commit','-m','work');
    const commitSha=git(repo,'rev-parse','HEAD');
    const request:ProtectedIntegrationRequest={protocolVersion:1,idempotencyKey:`integration-publication:auth:${commitSha}`,authorizationDecisionId:'auth',acceptedResultEventId:'result',correlation:{workItemId:'work',attemptId:'attempt-real',approvedProposalVersion:1},target:{providerId:'git-branch-publication-v1',repositoryId:remote,remoteName:'origin',baseBranch:'main'},baseSha,localBranch:'anima-work/attempt-real',remoteBranch:'anima-work/attempt-real',commitSha};
    const provider=new GitBranchPublicationProvider(repo);
    const concurrent=await Promise.all([provider.publishBranch(request),provider.publishBranch(request)]);
    expect(concurrent).toEqual(expect.arrayContaining([expect.objectContaining({commitSha,baseBranch:'main'})]));
    expect(concurrent.some(value=>value.disposition==='created')).toBe(true);
    await expect(provider.publishBranch(request)).resolves.toMatchObject({disposition:'already_existed',commitSha});
    expect(git(repo,'ls-remote','--heads','origin','refs/heads/anima-work/attempt-real').split(/\s+/)[0]).toBe(commitSha);
  }finally{rmSync(root,{recursive:true,force:true});}
},30_000);
