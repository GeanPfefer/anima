import { createClient } from '@/lib/supabase/server';
export async function POST(){const client=await createClient();const{data:{user}}=await client.auth.getUser();if(!user)return new Response(null,{status:401});const{error}=await client.rpc('abandon_current_conversation_turn');return new Response(null,{status:error?503:204});}
