// Hook para gerenciar a fila de gravações offline.
// Expõe contagem, status e `processNext` para transcrever o próximo item.

import { useState, useCallback, useEffect } from 'react';
import {
  getQueueCount,
  peekNext,
  removeProcessed,
} from '@/lib/recording-queue';
import { transcribeFromUri } from '@/lib/transcribe';

export type QueueProcessStatus = 'idle' | 'transcribing' | 'error';

export function useRecordingQueue() {
  const [count, setCount]               = useState(0);
  const [processStatus, setProcessStatus] = useState<QueueProcessStatus>('idle');

  const refresh = useCallback(async () => {
    const n = await getQueueCount();
    setCount(n);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /**
   * Transcreve o próximo áudio da fila.
   * - Sucesso: remove da fila, apaga o arquivo, retorna o texto.
   * - Falha: item permanece na fila, lança o erro para o caller tratar.
   * - Fila vazia: retorna null.
   */
  const processNext = useCallback(async (): Promise<string | null> => {
    const item = await peekNext();
    if (!item) {
      await refresh();
      return null;
    }

    setProcessStatus('transcribing');
    try {
      const text = await transcribeFromUri(item.uri);
      await removeProcessed(item.id);
      await refresh();
      setProcessStatus('idle');
      return text;
    } catch (err) {
      // item continua na fila — não foi removido
      setProcessStatus('error');
      await refresh();
      throw err;
    }
  }, [refresh]);

  return { count, processStatus, processNext, refresh };
}
