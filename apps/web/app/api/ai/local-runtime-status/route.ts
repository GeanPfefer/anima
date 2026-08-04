import { authenticateRequest } from '@/lib/supabase/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type OllamaProcess = {
  name?: unknown;
  model?: unknown;
  size?: unknown;
  size_vram?: unknown;
  context_length?: unknown;
  expires_at?: unknown;
};

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const response = await fetch('http://127.0.0.1:11434/api/ps', {
    cache: 'no-store', signal: AbortSignal.timeout(3_000),
  }).catch(() => null);
  if (!response?.ok) return Response.json({ ok: true, value: { available: false, models: [] } });
  const body = await response.json().catch(() => null) as { models?: OllamaProcess[] } | null;
  const models = Array.isArray(body?.models) ? body.models.flatMap(item => {
    const name = typeof item.name === 'string' ? item.name : typeof item.model === 'string' ? item.model : null;
    if (!name) return [];
    const size = typeof item.size === 'number' ? item.size : null;
    const sizeVram = typeof item.size_vram === 'number' ? item.size_vram : null;
    return [{
      name,
      loadedGigabytes: size === null ? null : Math.round(size / 1_000_000_000),
      gpuPercent: size === null || sizeVram === null || size <= 0 ? null : Math.round((sizeVram / size) * 100),
      contextLength: typeof item.context_length === 'number' ? item.context_length : null,
      expiresAt: typeof item.expires_at === 'string' ? item.expires_at : null,
    }];
  }) : [];
  return Response.json({ ok: true, value: { available: true, models } });
}
