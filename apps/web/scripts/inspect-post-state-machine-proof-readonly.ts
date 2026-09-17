// OPERACIONAL read-only: evidencia a única prova pós-state-machine.
import { resolveCliIdentity } from '@/cli/identity';
import { readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';
const ITEM = 'd054b90f-14e5-4f33-b236-3fe62e97cc20';
const AUTH = '6548cfb4-f1e1-4965-a0cd-64f1cba7249a';
async function main(): Promise<void> {
  const identity = await resolveCliIdentity(); if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const [item, events, claims] = await Promise.all([
    client.from('work_items').select('state,proposal_version,updated_at').eq('id', ITEM).single(),
    client.from('work_events').select('seq,event_type,created_at,payload').eq('work_item_id', ITEM).order('seq', { ascending: true }),
    client.from('work_claims').select('*').eq('work_item_id', ITEM),
  ]);
  if (item.error || events.error || claims.error) throw new Error(item.error?.message ?? events.error?.message ?? claims.error?.message);
  const compactEvents = (events.data ?? []).map(event => {
    const root = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : null;
    const data = root?.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : null;
    const evidence = data?.evidence && typeof data.evidence === 'object' && !Array.isArray(data.evidence) ? data.evidence : null;
    const transcripts = Array.isArray(evidence?.transcripts) ? evidence.transcripts : [];
    const runtimeEvents = transcripts.flatMap(t => t && typeof t === 'object' && !Array.isArray(t) && Array.isArray(t.runtimeEvents) ? t.runtimeEvents : []);
    const entries = transcripts.flatMap(t => t && typeof t === 'object' && !Array.isArray(t) && Array.isArray(t.entries) ? t.entries : []);
    return { seq: event.seq, type: event.event_type, at: event.created_at, data, coder: evidence ? {
      attemptId: evidence.attemptId, outcome: evidence.outcome, durationMs: evidence.durationMs,
      providerCallCount: evidence.providerCallCount, providerUsage: evidence.providerUsage,
      termination: transcripts.map(t => t && typeof t === 'object' && !Array.isArray(t) ? t.termination : null),
      runtimeEvents,
      trajectory: entries.map(e => e && typeof e === 'object' && !Array.isArray(e) ? ({ round: e.round, step: e.step, phase: e.phase, operation: e.operation, path: e.path, result: e.result }) : e),
    } : null };
  });
  console.log(JSON.stringify({ item: item.data, claims: claims.data, ledger: await readPaidComputeBudgetAudit(client, AUTH), events: compactEvents }, null, 2));
}
void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
