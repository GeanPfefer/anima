import { Audio } from 'expo-av';

const WHISPER_URL   = process.env.EXPO_PUBLIC_WHISPER_URL   ?? 'http://100.68.239.78:9000';
const WHISPER_MODEL = process.env.EXPO_PUBLIC_WHISPER_MODEL ?? 'whisper-1';

export type RecordingHandle = {
  /** Para a gravação, envia o áudio para Whisper e retorna o texto. */
  stop: () => Promise<string>;
  /** Para a gravação sem transcrever. Retorna o URI do arquivo — use para enfileirar. */
  stopSilent: () => Promise<string>;
  /** Aborta sem transcrever (usado no handleClose). */
  cancel: () => Promise<void>;
};

/**
 * Solicita permissão de microfone, configura o modo de áudio e inicia
 * a gravação. Retorna um handle com `stop()` e `cancel()`.
 */
export async function startRecording(): Promise<RecordingHandle> {
  const { status } = await Audio.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Permissão de microfone necessária. Autorize o Anima nas configurações do dispositivo.');
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS:   true,
    playsInSilentModeIOS: true,
  });

  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY,
  );
  await recording.startAsync();

  async function cleanup() {
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      // já pode ter sido descarregado
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  }

  return {
    stop: async () => {
      await cleanup();
      const uri = recording.getURI();
      if (!uri) throw new Error('Nenhum áudio gravado');
      return transcribeAudio(uri);
    },
    stopSilent: async () => {
      await cleanup();
      const uri = recording.getURI();
      if (!uri) throw new Error('Nenhum áudio gravado');
      return uri;
    },
    cancel: async () => {
      await cleanup();
    },
  };
}

/**
 * Transcreve um arquivo de áudio a partir de um URI local.
 * Exportado para uso pela fila de gravações offline.
 */
export function transcribeFromUri(uri: string): Promise<string> {
  return transcribeAudio(uri);
}

/**
 * Envia o arquivo de áudio para o servidor Whisper (formato OpenAI-compatible)
 * e retorna o texto transcrito.
 */
async function transcribeAudio(uri: string): Promise<string> {
  const formData = new FormData();

  // React Native FormData aceita o objeto { uri, type, name } diretamente
  formData.append('file', {
    uri,
    type: 'audio/m4a',
    name: 'recording.m4a',
  } as unknown as Blob);
  formData.append('model',    WHISPER_MODEL);
  formData.append('language', 'pt');

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 90_000);

  try {
    const res = await fetch(`${WHISPER_URL}/v1/audio/transcriptions`, {
      method:  'POST',
      body:    formData,
      signal:  controller.signal,
      headers: {
        // Não setar Content-Type manualmente — o FormData já define o boundary
        Accept: 'application/json',
      },
    });

    if (!res.ok) throw new Error(`Whisper retornou HTTP ${res.status}`);

    const json = await res.json() as { text?: string };
    return (json.text ?? '').trim();
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error('Timeout: Whisper demorou mais de 90s para responder.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
