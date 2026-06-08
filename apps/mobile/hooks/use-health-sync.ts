// Hook de sincronização com Apple Health.
// Usa o adaptador health.ts que requer dev build com @kingstinct/react-native-healthkit.
// Em Expo Go retorna status 'unavailable' e nunca trava o app.

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  requestHealthPermissions,
  buildHealthEntries,
  type HealthImportEntry,
  type HealthPermissionStatus,
} from '@/lib/adapters/health';

type SyncStatus = 'idle' | 'requesting' | 'syncing' | 'done' | 'error' | 'unavailable';

export function useHealthSync(userId: string, healthPillarId: string | null) {
  const [status, setStatus]       = useState<SyncStatus>('idle');
  const [importedCount, setCount] = useState(0);
  const [error, setError]         = useState('');

  const sync = useCallback(async (daysBack = 30) => {
    if (!healthPillarId) {
      setError('Pilar "Saúde" não encontrado. Crie-o primeiro.');
      setStatus('error');
      return;
    }

    setStatus('requesting');
    setError('');

    const permission: HealthPermissionStatus = await requestHealthPermissions();
    if (permission === 'unavailable') {
      setStatus('unavailable');
      return;
    }
    if (permission === 'denied') {
      setError('Permissão negada. Habilite o acesso ao Saúde nas Configurações do iPhone.');
      setStatus('error');
      return;
    }

    setStatus('syncing');

    const entries: HealthImportEntry[] = await buildHealthEntries(daysBack);
    if (entries.length === 0) {
      setStatus('done');
      setCount(0);
      return;
    }

    // Verifica quais externalIds já foram importados para evitar duplicatas
    // Usa a nota como fingerprint (note LIKE 'Sono%Apple Health%' etc.)
    // Solução simples: busca registros dos últimos daysBack dias do pilar Saúde
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    const { data: existing } = await supabase
      .from('xp_records')
      .select('note')
      .eq('user_id', userId)
      .eq('pillar_id', healthPillarId)
      .gte('created_at', since.toISOString());

    const existingNotes = new Set((existing ?? []).map(r => r.note ?? ''));
    const toInsert = entries.filter(e => !existingNotes.has(e.note));

    if (toInsert.length === 0) {
      setStatus('done');
      setCount(0);
      return;
    }

    // Insere em lote (sem XP para presença, XP calculado pelo logActivity para os com duração)
    const rows = toInsert.map((e: HealthImportEntry) => ({
      user_id:          userId,
      pillar_id:        healthPillarId,
      duration_minutes: e.durationMinutes,
      base_xp:          0,
      bonus_multiplier: 1.0,
      total_xp:         0,
      bonuses:          [],
      note:             e.note,
      activity_date:    e.activityDate,
    }));

    const { error: insertError } = await supabase.from('xp_records').insert(rows);

    if (insertError) {
      setError('Erro ao salvar entradas de saúde.');
      setStatus('error');
      return;
    }

    setCount(toInsert.length);
    setStatus('done');
  }, [userId, healthPillarId]);

  return { sync, status, importedCount, error };
}
