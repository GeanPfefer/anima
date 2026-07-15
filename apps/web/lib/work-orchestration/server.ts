import { WorkOrchestrationService } from '@anima/core';
import { SupabaseWorkOrchestrationRepository } from '@anima/supabase';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
export const createWorkOrchestrationService = (client: SupabaseClient<Database>) => new WorkOrchestrationService(new SupabaseWorkOrchestrationRepository(client));
