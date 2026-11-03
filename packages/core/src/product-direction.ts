// Direção do produto — decisão EDITORIAL de planejamento.
//
// Este módulo é deliberadamente separado do Capability Registry: direção não é maturidade, prova, prontidão
// nem autonomia, e nunca é entrada do Proof Engine. Um item pode apontar para capacidades existentes apenas
// para navegação; ele não herda nem concede maturidade a elas. Valores permitidos e referências são validados.

export type ProductDirectionStatus = 'current_focus' | 'next' | 'experimental' | 'parked';

export const PRODUCT_DIRECTION_STATUSES: readonly ProductDirectionStatus[] = [
  'current_focus',
  'next',
  'experimental',
  'parked',
] as const;

export const PRODUCT_DIRECTION_LABEL_PT: Record<ProductDirectionStatus, string> = {
  current_focus: 'Foco atual',
  next: 'Próximo objetivo',
  experimental: 'Experimental',
  parked: 'Estacionado',
};

export const PRODUCT_DIRECTION_NOTICE =
  'Direção é decisão editorial de planejamento. Não representa conclusão, prova, prontidão, maturidade nem autonomia.';

export interface ProductDirectionRef {
  readonly kind: 'record' | 'doc';
  readonly ref: string;
  readonly note?: string;
}

export interface ProductDirectionItem {
  readonly id: string;
  readonly status: ProductDirectionStatus;
  readonly title: string;
  readonly rationale: string;
  /** Decisão ou contexto que sustenta a direção; nunca prova de funcionamento. */
  readonly refs: readonly ProductDirectionRef[];
  /** Somente navegação para o mapa; não transfere maturidade. */
  readonly relatedCapabilityIds?: readonly string[];
}

export interface ProductDirection {
  readonly decidedAt: string;
  readonly decidedBy: string;
  readonly items: readonly ProductDirectionItem[];
}

export type ProductDirectionIssueCode =
  | 'invalid_date'
  | 'invalid_status'
  | 'duplicate_id'
  | 'missing_text'
  | 'missing_ref'
  | 'unknown_capability'
  | 'missing_status_group';

export interface ProductDirectionIssue {
  readonly code: ProductDirectionIssueCode;
  readonly itemId: string;
  readonly message: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida a direção. Não lê o sistema de arquivos: a existência dos arquivos referenciados é verificada no teste.
 * `capabilityIds` são os ids do registry, usados só para barrar vínculos inexistentes.
 */
export function validateProductDirection(
  direction: ProductDirection,
  capabilityIds: ReadonlySet<string>,
): ProductDirectionIssue[] {
  const issues: ProductDirectionIssue[] = [];
  const add = (code: ProductDirectionIssueCode, itemId: string, message: string) => issues.push({ code, itemId, message });
  if (!DATE.test(direction.decidedAt) || !Number.isFinite(Date.parse(direction.decidedAt))) {
    add('invalid_date', '*', `decidedAt inválido: ${direction.decidedAt}`);
  }
  if (direction.decidedBy.trim() === '') add('missing_text', '*', 'decidedBy vazio');
  const seen = new Set<string>();
  for (const item of direction.items) {
    if (seen.has(item.id)) add('duplicate_id', item.id, `id duplicado: ${item.id}`);
    seen.add(item.id);
    if (!PRODUCT_DIRECTION_STATUSES.includes(item.status)) {
      add('invalid_status', item.id, `estado inválido: ${String(item.status)}`);
    }
    if (item.title.trim() === '' || item.rationale.trim() === '') {
      add('missing_text', item.id, 'título ou justificativa vazio');
    }
    if (item.refs.length === 0 || item.refs.some((r) => r.ref.trim() === '')) {
      add('missing_ref', item.id, 'a direção exige ao menos uma referência não vazia');
    }
    for (const capabilityId of item.relatedCapabilityIds ?? []) {
      if (!capabilityIds.has(capabilityId)) add('unknown_capability', item.id, `capacidade inexistente: ${capabilityId}`);
    }
  }
  for (const status of PRODUCT_DIRECTION_STATUSES) {
    if (!direction.items.some((i) => i.status === status)) {
      add('missing_status_group', status, `nenhum item em ${status}`);
    }
  }
  return issues;
}

/** Itens agrupados na ordem fixa foco → próximo → experimental → estacionado, preservando a ordem declarada. */
export function groupProductDirection(
  direction: ProductDirection,
): { status: ProductDirectionStatus; items: ProductDirectionItem[] }[] {
  return PRODUCT_DIRECTION_STATUSES.map((status) => ({
    status,
    items: direction.items.filter((i) => i.status === status),
  })).filter((g) => g.items.length > 0);
}

const RECORD = 'docs/registros/2026-11-03-evolution-ux-i1-resgate-e-direcao.md';
const decision = (note: string): ProductDirectionRef => ({ kind: 'record', ref: RECORD, note });

/** Direção aprovada pelo operador em 2026-11-03. Ver o registro citado. */
export const ANIMA_PRODUCT_DIRECTION_V1: ProductDirection = {
  decidedAt: '2026-11-03',
  decidedBy: 'operador',
  items: [
    {
      id: 'value-01',
      status: 'current_focus',
      title: 'VALUE-01: produtividade real do ANIMA × Codex direto',
      rationale:
        'Comparar, na mesma tarefa, o ANIMA com o Codex usado diretamente (esforço humano, tempo, custo e qualidade) antes de investir em mais autonomia. A VALUE-01 ainda não tem plano nem medição no repositório.',
      refs: [decision('decisão do operador; objetivo declarado, sem medição')],
    },
    {
      id: 'reduce-human-interventions',
      status: 'next',
      title: 'Reduzir intervenções humanas repetitivas',
      rationale:
        'Escolher o que automatizar a partir das medições da VALUE-01. Sem medição não há alvo; autonomia desassistida segue não comprovada.',
      refs: [
        decision('decisão do operador'),
        { kind: 'record', ref: 'docs/registros/2026-10-26-project-builder-v0-fechamento.md', note: 'todas as decisões ainda são atos humanos' },
      ],
    },
    {
      id: 'a2-uac',
      status: 'experimental',
      title: 'A2-UAC (Mandate Approver)',
      rationale:
        'Protótipo de autoridade de concessão fora do alcance do runner, preservado na branch claude/preserve-a2-uac-approver (0bb1cac). Sem instalador nem prova de elevação.',
      refs: [
        decision('experimento preservado, não integrado'),
        { kind: 'doc', ref: 'docs/arquitetura/acceptance-mandate-v1.md', note: 'contrato de mandato do qual o protótipo depende' },
      ],
      relatedCapabilityIds: ['governance.authority'],
    },
    {
      id: 'wsl-isolation',
      status: 'experimental',
      title: 'Isolamento da trilha WSL',
      rationale:
        'O Codex governado roda no WSL, que as ACLs do Windows (A3) não protegem. O perfil nativo L1 foi provado só em laboratório; nada foi ativado no residente.',
      refs: [
        decision('experimento; sem ativação'),
        { kind: 'record', ref: 'docs/registros/2026-10-20-l1-codex-wsl-perfil-nativo.md' },
        { kind: 'doc', ref: 'docs/operacao/a3-ativacao-conjunta-runbook.md', note: 'A3 cobre só a trilha Windows' },
      ],
      relatedCapabilityIds: ['agency.external-harness'],
    },
    {
      id: 'advanced-mandate-governance',
      status: 'experimental',
      title: 'Governança avançada sob mandato',
      rationale: 'Aceite sob mandato e autonomia progressiva continuam em experimentação; cada ato de decisão ainda é humano.',
      refs: [
        decision('experimento'),
        { kind: 'doc', ref: 'docs/arquitetura/acceptance-mandate-v1.md' },
      ],
      relatedCapabilityIds: ['governance.progressive-autonomy'],
    },
    {
      id: 'ollama-local',
      status: 'parked',
      title: 'Ollama local',
      rationale:
        'Estacionado até reavaliação orientada por necessidade, capacidade e custo. O coder local não convergiu nas provas TPC-01 e há barreira de RAM.',
      refs: [
        decision('decisão do operador'),
        { kind: 'doc', ref: 'docs/arquitetura/codex-cli-coder-backend.md', note: 'Ollama/DSH/RunPod coder experimentais/estacionados' },
        { kind: 'record', ref: 'docs/registros/2026-10-01-tpc01-attempt-local-flash-off-failed.md' },
      ],
      relatedCapabilityIds: ['compute.local-execution'],
    },
    {
      id: 'dsh',
      status: 'parked',
      title: 'DSH (harness DeepSeek)',
      rationale: 'Estacionado até reavaliação orientada por necessidade, capacidade e custo. Pesquisa preservada.',
      refs: [
        decision('decisão do operador'),
        { kind: 'doc', ref: 'docs/arquitetura/deepseek-harness-coder-backend.md' },
        { kind: 'record', ref: 'docs/registros/2026-10-02-tpc01-replay-ab-runtime-vs-dsh.md' },
      ],
    },
    {
      id: 'runpod',
      status: 'parked',
      title: 'RunPod',
      rationale: 'Estacionado até reavaliação orientada por necessidade, capacidade e custo. Experimentos preservados.',
      refs: [
        decision('decisão do operador'),
        { kind: 'doc', ref: 'docs/arquitetura/provisionamento-runpod-adapter.md' },
        { kind: 'record', ref: 'docs/registros/2026-10-02-tpc01-runpod-coder-remoto.md' },
      ],
      relatedCapabilityIds: ['compute.cloud-self-hosted'],
    },
  ],
};
