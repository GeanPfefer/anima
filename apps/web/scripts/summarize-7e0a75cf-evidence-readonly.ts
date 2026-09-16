import { resolveCliIdentity } from '@/cli/identity';

const ITEM = '7e0a75cf-560b-45a1-8097-5631c631ad05';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const events = await identity.identity.client.from('work_events').select('seq,event_type,payload').eq('work_item_id', ITEM).gte('seq', 51901).order('seq', { ascending: true });
  if (events.error) throw new Error(events.error.message);
  const coder = events.data?.find(event => event.event_type === 'host_observed_coder_evidence_recorded');
  const root = coder?.payload && typeof coder.payload === 'object' && !Array.isArray(coder.payload) ? coder.payload : null;
  const data = root?.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : null;
  const evidence = data?.evidence && typeof data.evidence === 'object' && !Array.isArray(data.evidence) ? data.evidence : null;
  const transcripts = Array.isArray(evidence?.transcripts) ? evidence.transcripts : [];
  const trajectory: Array<{ step: unknown; round: unknown; phase: unknown; operation: unknown; path: unknown; result: unknown }> = [];
  for (const transcript of transcripts) {
    if (!transcript || typeof transcript !== 'object' || Array.isArray(transcript)) continue;
    const entries = Array.isArray(transcript.entries) ? transcript.entries : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      trajectory.push({ step: entry.step, round: entry.round, phase: entry.phase, operation: entry.operation, path: entry.path, result: entry.result });
    }
  }
  const sentPaths = [...new Set(trajectory.filter(row => row.phase === 'read' || row.phase === 'search' || row.phase === 'glob').map(row => row.path).filter((path): path is string => typeof path === 'string'))];
  console.log(JSON.stringify({ providerCallCount: evidence?.providerCallCount, providerUsage: evidence?.providerUsage, sentPaths, trajectory }, null, 2));
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
