import type { WorkItem } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AutonomousReadinessView={eligible:boolean;blockingDependencyIds:readonly string[];reason:'eligible'|'blocked_by_dependency'|'not_in_queue'};
const dependencyIds=(item:WorkItem)=>{const spec=item.intent['execution_spec'];if(typeof spec!=='object'||spec===null||Array.isArray(spec))return [];const value=spec['depends_on_work_item_ids'];return Array.isArray(value)?value.filter((entry):entry is string=>typeof entry==='string'):[];};

/** Projeta a fila SQL que autoriza o Supervisor. Read-only e fail-closed. */
export async function projectAutonomousReadiness(client:SupabaseClient<Database>,items:readonly WorkItem[]){
  const queue=await client.rpc('autonomous_work_queue');
  const eligibleIds=new Set(queue.error?[]:(queue.data??[]).map(row=>row.work_item_id));
  const dependencies=[...new Set(items.flatMap(dependencyIds))];const states=new Map<string,string>();
  if(dependencies.length){const result=await client.from('work_items').select('id,state').in('id',dependencies);if(!result.error)for(const row of result.data??[])states.set(row.id,row.state);}
  return new Map(items.map(item=>{const blockingDependencyIds=dependencyIds(item).filter(id=>states.get(id)!=='completed');const eligible=eligibleIds.has(item.id);const reason:AutonomousReadinessView['reason']=eligible?'eligible':blockingDependencyIds.length?'blocked_by_dependency':'not_in_queue';return [item.id,{eligible,blockingDependencyIds,reason} satisfies AutonomousReadinessView];}));
}
