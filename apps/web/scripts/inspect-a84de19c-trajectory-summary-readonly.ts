// OPERACIONAL (não commitar) — READ-ONLY. Sumariza a trajetória V3 do coder. US$0.
import { resolveCliIdentity } from '@/cli/identity';

const ITEM = 'a84de19c-3766-44ed-8ce2-80e856ec2a38';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const ev = await client.from('work_events').select('payload').eq('work_item_id', ITEM).eq('event_type', 'host_observed_coder_evidence_recorded').single();
  if (ev.error) throw new Error(ev.error.message);
  const evidence = (ev.payload as any) ?? (ev.data as any)?.payload;
  const transcripts = (ev.data as any).payload.data.evidence.transcripts as any[];
  const entries: any[] = transcripts.flatMap(t => t.entries ?? []);
  console.log(`total entries: ${entries.length}`);

  const byOp: Record<string, number> = {};
  const byPhase: Record<string, number> = {};
  for (const e of entries) { byOp[e.operation ?? '?'] = (byOp[e.operation ?? '?'] ?? 0) + 1; byPhase[e.phase ?? '?'] = (byPhase[e.phase ?? '?'] ?? 0) + 1; }
  console.log('\n=== by operation ==='); console.log(JSON.stringify(byOp, null, 2));
  console.log('\n=== by phase ==='); console.log(JSON.stringify(byPhase, null, 2));

  const edits = entries.filter(e => e.operation === 'edit' || e.phase === 'edit');
  console.log('\n=== EDIT operations (path, round, result) ===');
  for (const e of edits) console.log(`round ${e.round} step ${e.step}\t${e.result}\t${e.path}`);

  const execs = entries.filter(e => /exec|test|command|run/i.test(e.operation ?? '') || /exec|test/i.test(e.phase ?? ''));
  console.log('\n=== EXEC/TEST operations ===');
  for (const e of execs) console.log(JSON.stringify({ round: e.round, op: e.operation, phase: e.phase, result: e.result, exitCode: e.exitCode, command: e.command ?? e.program ?? e.args ?? null, label: e.label }, null, 2));

  const gits = entries.filter(e => /git|diff/i.test(e.operation ?? '') || /git|diff/i.test(e.phase ?? ''));
  console.log('\n=== GIT/DIFF operations ===');
  for (const e of gits) console.log(JSON.stringify({ round: e.round, op: e.operation, phase: e.phase, result: e.result, command: e.command ?? e.args ?? null }, null, 2));

  const searches = entries.filter(e => /search|glob|grep|ls/i.test(e.operation ?? '') || /search|glob/i.test(e.phase ?? ''));
  console.log('\n=== SEARCH/GLOB operations ===');
  for (const e of searches) console.log(JSON.stringify({ round: e.round, op: e.operation, phase: e.phase, query: e.query ?? e.pattern ?? null, matchCount: e.matchCount, result: e.result }));

  const submits = entries.filter(e => /submit|conclude/i.test(e.operation ?? '') || /submit|conclude/i.test(e.phase ?? '') || e.result === 'refused' || /refus|reject/i.test(String(e.result ?? '')));
  console.log('\n=== SUBMIT / refusals ===');
  for (const e of submits) console.log(JSON.stringify({ round: e.round, op: e.operation, phase: e.phase, result: e.result, feedback: e.feedback ?? e.message ?? e.reason ?? null }, null, 2));

  console.log('\n=== LAST 12 ENTRIES (compact) ===');
  for (const e of entries.slice(-12)) console.log(JSON.stringify({ round: e.round, step: e.step, op: e.operation, phase: e.phase, result: e.result, path: e.path, exitCode: e.exitCode, command: e.command ?? null }));

  console.log('\n=== ROUND HISTOGRAM (max round) ===');
  console.log(`maxRound=${entries.reduce((m, e) => Math.max(m, e.round ?? 0), 0)}`);
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
