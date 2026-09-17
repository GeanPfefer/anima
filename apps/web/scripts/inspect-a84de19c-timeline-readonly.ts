// OPERACIONAL (não commitar) — READ-ONLY. Timeline compacta + payloads de falha/coder. US$0.
import { resolveCliIdentity } from '@/cli/identity';

const ITEM = 'a84de19c-3766-44ed-8ce2-80e856ec2a38';
const DEEP = /fail|checkpoint|coder|handoff|observation|gate|turn|refus|error|settle|host_observed/i;

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;
  const events = await client.from('work_events').select('seq,event_type,created_at,payload').eq('work_item_id', ITEM).order('seq', { ascending: true });
  if (events.error) throw new Error(events.error.message);
  const rows = events.data ?? [];
  console.log('=== TIMELINE ===');
  for (const e of rows) console.log(`${e.seq}\t${e.event_type}\t${e.created_at}`);
  console.log('\n=== DEEP PAYLOADS (fail/coder/gate/checkpoint/observation/settle) ===');
  for (const e of rows) {
    if (DEEP.test(e.event_type)) {
      console.log(`\n--- seq ${e.seq} :: ${e.event_type} @ ${e.created_at} ---`);
      console.log(JSON.stringify(e.payload, null, 2));
    }
  }
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
