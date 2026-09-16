// OPERACIONAL (não commitar) — READ-ONLY. Estrutura + resumo dos transcripts do coder. US$0.
import { resolveCliIdentity } from '@/cli/identity';

const ITEM = 'a84de19c-3766-44ed-8ce2-80e856ec2a38';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const events = await client.from('work_events').select('seq,event_type,payload').eq('work_item_id', ITEM).in('event_type', ['execution_failed', 'host_observed_coder_evidence_recorded']).order('seq', { ascending: true });
  if (events.error) throw new Error(events.error.message);
  for (const e of events.data ?? []) {
    if (e.event_type === 'execution_failed') {
      console.log('=== execution_failed FULL MESSAGE ===');
      console.log((e.payload as any)?.data?.message ?? '(none)');
    }
    if (e.event_type === 'host_observed_coder_evidence_recorded') {
      const ev = (e.payload as any)?.data?.evidence ?? {};
      console.log('\n=== EVIDENCE SUMMARY ===');
      console.log(JSON.stringify({ model: ev.model, backendId: ev.backendId, placement: ev.placement, outcome: ev.outcome, durationMs: ev.durationMs, transcriptCount: Array.isArray(ev.transcripts) ? ev.transcripts.length : 'n/a', keys: Object.keys(ev) }, null, 2));
      const t = ev.transcripts;
      if (Array.isArray(t)) {
        console.log('\n=== TRANSCRIPT SCHEMA (first entry raw) ===');
        console.log(JSON.stringify(t[0], null, 2));
        console.log('\n=== TRANSCRIPT ENTRY KEYS (all) ===');
        console.log(JSON.stringify([...new Set(t.flatMap((x: any) => Object.keys(x ?? {})))], null, 2));
      }
    }
  }
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
