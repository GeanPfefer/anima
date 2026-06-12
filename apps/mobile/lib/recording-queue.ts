// Fila persistente de gravações offline.
// Quando o Whisper está inacessível, o áudio é copiado para o diretório
// persistente do app e enfileirado. Na próxima vez que a conexão estiver
// disponível, o usuário pode transcrever a fila manualmente.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const QUEUE_KEY = '@anima/recording_queue_v1';

function recordingsDir(): string {
  // documentDirectory é null apenas em ambientes sem sistema de arquivos (testes)
  return `${FileSystem.documentDirectory ?? 'file:///'}recordings/`;
}

type QueuedRecording = {
  id:         string;
  localUri:   string;
  recordedAt: string; // ISO 8601
};

// ── Persistência interna ──────────────────────────────────────────────────────

async function loadQueue(): Promise<QueuedRecording[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedRecording[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueuedRecording[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Copia o áudio temporário para armazenamento persistente e adiciona à fila.
 * Chamar quando a transcrição falha por falta de rede.
 */
export async function enqueueRecording(tempUri: string): Promise<void> {
  const dir  = recordingsDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  const id      = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const destUri = `${dir}${id}.m4a`;
  await FileSystem.copyAsync({ from: tempUri, to: destUri });

  const queue = await loadQueue();
  queue.push({ id, localUri: destUri, recordedAt: new Date().toISOString() });
  await saveQueue(queue);
}

/** Número de gravações aguardando transcrição. */
export async function getQueueCount(): Promise<number> {
  return (await loadQueue()).length;
}

/**
 * Retorna o primeiro item da fila sem removê-lo.
 * Remove apenas após processamento bem-sucedido via `removeProcessed`.
 */
export async function peekNext(): Promise<{ id: string; uri: string } | null> {
  const q = await loadQueue();
  if (q.length === 0) return null;
  return { id: q[0]!.id, uri: q[0]!.localUri };
}

/**
 * Remove um item processado com sucesso da fila e apaga o arquivo de áudio.
 */
export async function removeProcessed(id: string): Promise<void> {
  const queue = await loadQueue();
  const item  = queue.find(r => r.id === id);
  await saveQueue(queue.filter(r => r.id !== id));
  if (item) {
    try {
      await FileSystem.deleteAsync(item.localUri, { idempotent: true });
    } catch {
      // falha silenciosa — arquivo pode já ter sido removido
    }
  }
}

/** Remove todos os itens pendentes e apaga os arquivos de áudio. */
export async function clearQueue(): Promise<void> {
  const queue = await loadQueue();
  await Promise.all(
    queue.map(r =>
      FileSystem.deleteAsync(r.localUri, { idempotent: true }).catch(() => {}),
    ),
  );
  await AsyncStorage.removeItem(QUEUE_KEY);
}
