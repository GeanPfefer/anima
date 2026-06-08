// Adaptador Obsidian — Fase 1: Postgres → markdown (mão única, sem dependências externas).
// Segue o padrão de conector plugável do PRD §13b: o núcleo do app não conhece este módulo.
// Cada entrada do xp_records vira um arquivo .md com frontmatter estruturado + [[links]].

export type EntryRow = {
  id: string;
  pillar_id: string;
  duration_minutes: number;
  base_xp: number;
  bonus_multiplier: number;
  total_xp: number;
  bonuses: string[];          // activity_bonus[] do Supabase: 'first_of_day' | 'forgotten_pillar' | ...
  note: string | null;
  created_at: string;
  activity_date: string;      // 'YYYY-MM-DD'
};

export type PillarRow = {
  id: string;
  name: string;
  xp_total: number;
  level: number;
  is_active: boolean;
};

export type EntryWithPillar = EntryRow & { pillarName: string };

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8);
}

// ── paths ─────────────────────────────────────────────────────────────────────

/** Pasta mensal: "2026-06" */
export function entryFolder(entry: EntryRow): string {
  return entry.activity_date.slice(0, 7); // "YYYY-MM"
}

/** Nome do arquivo: "2026-06-08_trabalho_abc12345.md" */
export function entryFilename(entry: EntryWithPillar): string {
  return `${entry.activity_date}_${slugify(entry.pillarName)}_${shortId(entry.id)}.md`;
}

/** Caminho completo dentro do ZIP */
export function entryPath(entry: EntryWithPillar): string {
  return `Anima/${entryFolder(entry)}/${entryFilename(entry)}`;
}

export function pillarPath(pillar: PillarRow): string {
  return `Anima/_Pilares/${pillar.name}.md`;
}

// ── formatadores ──────────────────────────────────────────────────────────────

/** Converte uma entrada em markdown para o Obsidian */
export function formatEntry(entry: EntryWithPillar): string {
  const bonusList = entry.bonuses.length > 0
    ? `[${entry.bonuses.map(b => `"${b}"`).join(', ')}]`
    : '[]';

  const frontmatter = [
    '---',
    `id: "${entry.id}"`,
    `date: "${entry.activity_date}"`,
    `pilar: "${entry.pillarName}"`,
    `duracao_min: ${entry.duration_minutes}`,
    `xp: ${entry.total_xp}`,
    `bonus: ${bonusList}`,
    `created_at: "${entry.created_at}"`,
    '---',
  ].join('\n');

  const body = entry.note?.trim() ?? '';
  // [[link]] para o pilar permite navegação bidirecional no Obsidian
  const links = `[[_Pilares/${entry.pillarName}]]`;

  return `${frontmatter}\n\n${body ? body + '\n\n' : ''}${links}\n`;
}

/** Nota índice do pilar com links para as entradas mais recentes */
export function formatPillarNote(pillar: PillarRow, entries: EntryWithPillar[]): string {
  const sorted = [...entries].sort((a, b) =>
    b.activity_date.localeCompare(a.activity_date)
  );

  const entryLinks = sorted
    .slice(0, 100)
    .map(e => {
      const path = `../${entryFolder(e)}/${entryFilename(e)}`;
      return `- [[${path}|${e.activity_date}]] — ${e.duration_minutes}min · ${e.total_xp} XP`;
    })
    .join('\n');

  return [
    '---',
    `type: pilar`,
    `name: "${pillar.name}"`,
    `xp_total: ${pillar.xp_total}`,
    `level: ${pillar.level}`,
    `is_active: ${pillar.is_active}`,
    '---',
    '',
    `# ${pillar.name}`,
    '',
    `**XP total:** ${pillar.xp_total.toLocaleString('pt-BR')} · **Nível:** ${pillar.level}`,
    '',
    '## Entradas',
    '',
    entryLinks || '_Nenhuma entrada ainda._',
    '',
  ].join('\n');
}

/** README na raiz do vault */
export function formatReadme(
  userName: string,
  exportDate: string,
  totalEntries: number,
  pillars: PillarRow[],
): string {
  const pillarSummary = pillars
    .filter(p => p.is_active)
    .sort((a, b) => b.xp_total - a.xp_total)
    .map(p => `| ${p.name} | ${p.level} | ${p.xp_total.toLocaleString('pt-BR')} XP |`)
    .join('\n');

  return [
    `# Anima — Vault de ${userName}`,
    '',
    `Exportado em **${exportDate}** · ${totalEntries} entrada${totalEntries !== 1 ? 's' : ''}`,
    '',
    '## Pilares',
    '',
    '| Pilar | Nível | XP |',
    '|-------|-------|----|',
    pillarSummary,
    '',
    '## Estrutura',
    '',
    '```',
    'Anima/',
    '├── README.md          ← este arquivo',
    '├── _Pilares/          ← índice por pilar (com [[links]] para entradas)',
    '└── YYYY-MM/           ← entradas agrupadas por mês',
    '```',
    '',
    '## Como usar no Obsidian',
    '',
    '1. Abra o Obsidian e crie um vault (ou use um existente)',
    '2. Extraia o conteúdo deste ZIP **dentro** da pasta do vault',
    '3. Os `[[links]]` entre entradas e pilares funcionam automaticamente',
    '4. Use o Graph View para visualizar conexões entre pilares e entradas',
    '',
    '> **Importante:** este vault é espelho somente-leitura.',
    '> A fonte da verdade é o Anima — edições aqui não sincronizam de volta.',
    '',
  ].join('\n');
}
