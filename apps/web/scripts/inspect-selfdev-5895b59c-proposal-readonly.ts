// READ-ONLY: dump completo do work_item 5895b59c e dos payloads de eventos para confirmar,
// antes de qualquer gasto, o base commit / checkpoint persistido, o max_duration_minutes (a
// classificação exige ===30) e o escopo/critérios da proposal v2. Não muta nada.
import { resolveCliIdentity } from '@/cli/identity';

const SUCCESSOR_ID = '5895b59c-0568-483a-9731-2abd45fb4b90';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client } = identity.identity;

  const item = await client.from('work_items').select('*').eq('id', SUCCESSOR_ID).single();
  if (item.error) throw new Error(`${item.error.code}: ${item.error.message}`);

  const events = await client
    .from('work_events')
    .select('*')
    .eq('work_item_id', SUCCESSOR_ID)
    .order('created_at', { ascending: true });
  if (events.error) throw new Error(`${events.error.code}: ${events.error.message}`);

  console.log(JSON.stringify({ mode: 'READ_ONLY', workItem: item.data, events: events.data }, null, 2));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
