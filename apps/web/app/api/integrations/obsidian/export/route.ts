import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { strToU8, zipSync } from 'fflate';
import {
  formatEntry,
  formatPillarNote,
  formatReadme,
  entryPath,
  pillarPath,
  type EntryWithPillar,
  type PillarRow,
} from '@/lib/adapters/obsidian';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const [profileRes, pillarsRes, recordsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single(),
    supabase
      .from('user_pillars')
      .select('id, name, xp_total, level, is_active')
      .eq('user_id', user.id)
      .order('sort_order'),
    supabase
      .from('xp_records')
      .select('id, pillar_id, duration_minutes, base_xp, bonus_multiplier, total_xp, bonuses, note, created_at, activity_date')
      .eq('user_id', user.id)
      .order('activity_date', { ascending: false }),
  ]);

  const pillars: PillarRow[] = pillarsRes.data ?? [];
  const records = recordsRes.data ?? [];
  const userName = profileRes.data?.name ?? 'Usuário';

  // Mapa pillar_id → pilar para lookup O(1)
  const pillarMap = new Map(pillars.map(p => [p.id, p]));

  const entries: EntryWithPillar[] = records.map(r => ({
    ...r,
    bonuses: (r.bonuses as string[]) ?? [],
    pillarName: pillarMap.get(r.pillar_id)?.name ?? 'Sem pilar',
  }));

  const exportDate = new Date().toISOString().slice(0, 10);

  // ── Monta os arquivos do vault ──────────────────────────────────────────────
  const files: Record<string, Uint8Array> = {};

  // README na raiz
  files['Anima/README.md'] = strToU8(
    formatReadme(userName, exportDate, entries.length, pillars)
  );

  // Uma nota por pilar em _Pilares/
  for (const pillar of pillars) {
    const pillarEntries = entries.filter(e => e.pillarName === pillar.name);
    files[pillarPath(pillar)] = strToU8(
      formatPillarNote(pillar, pillarEntries)
    );
  }

  // Uma nota por entrada, agrupada em YYYY-MM/
  for (const entry of entries) {
    files[entryPath(entry)] = strToU8(formatEntry(entry));
  }

  const zipData = zipSync(files, { level: 6 });

  return new NextResponse(zipData, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="anima-vault-${exportDate}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
