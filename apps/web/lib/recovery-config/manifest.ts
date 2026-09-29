// ============================================================
// Recovery Configuration Manifest V0 — contrato versionado da configuração que uma
// máquina nova precisa para recuperar o Anima. NUNCA contém valores: só o que cada
// chave É, para que serve, de onde vem e como é reprovisionada.
//
// Consumido pelo checker read-only (`anima recovery-config check`). Não é lido pelo
// runtime produtivo: mudar esta tabela não muda comportamento de nenhuma capacidade.
// Registro: docs/registros/2026-09-28-recovery-configuration-v0.md.
// ============================================================

export const RECOVERY_CONFIG_MANIFEST_SCHEMA = 'anima.recovery-config.v0' as const;

export type RecoveryConfigClass =
  | 'derived'
  | 'non_secret_required'
  | 'secret_required'
  | 'host_specific'
  | 'optional'
  | 'deprecated';

export const READINESS_GROUPS = [
  'core',
  'resident',
  'chat-openai',
  'local-ai',
  'self-development',
  'runpod',
  'research-web',
  'mobile',
  'github-integration',
  'local-supabase',
] as const;
export type ReadinessGroup = (typeof READINESS_GROUPS)[number];

export type RecoveryConfigSourceKind = 'repository' | 'derived' | 'secret_store' | 'operator' | 'external_auth';
export type ReprovisionStrategy = 'derive' | 'generate' | 'authenticate' | 'reset_credential' | 'install' | 'operator_choice';

/**
 * Arquivo de ambiente onde a chave vive. `web` = apps/web/.env.local (CLI, Resident Host, Next);
 * `supabase` = supabase/.env (auto-carregado pela Supabase CLI para `env()` do config.toml).
 */
export type RecoveryConfigEnvFile = 'web' | 'mobile' | 'supabase';

export type RecoveryConfigValidation =
  | { readonly kind: 'non_empty' }
  | { readonly kind: 'url' }
  | { readonly kind: 'email' }
  | { readonly kind: 'absolute_path'; readonly mustExist: boolean }
  | { readonly kind: 'enum'; readonly values: readonly string[]; readonly caseInsensitive?: boolean }
  | { readonly kind: 'integer'; readonly min: number; readonly max: number }
  | { readonly kind: 'number_positive' }
  | { readonly kind: 'uuid_list' }
  | { readonly kind: 'slug' }
  | { readonly kind: 'json_targets' };

/**
 * Condição sobre OUTRA chave. `whenUnset` é o valor que o runtime assume quando a chave
 * está ausente (espelha o default real do código), para que a condição avalie igual.
 */
export interface RecoveryConfigCondition {
  readonly key: string;
  readonly in: readonly string[];
  readonly whenUnset?: string;
  readonly caseInsensitive?: boolean;
}

/** Exigência de uma chave por um grupo, opcionalmente condicionada. */
export interface RecoveryConfigRequirement {
  readonly group: ReadinessGroup;
  readonly when?: RecoveryConfigCondition;
}

/**
 * Derivação: `wired` = o runtime já deriva sozinho quando a chave falta (a ausência é
 * saudável); `derivable_not_wired` = daria para derivar, mas o runtime ainda exige a
 * chave. Registrado, não implementado (fora do escopo V0).
 */
export interface RecoveryConfigDerivation {
  readonly status: 'wired' | 'derivable_not_wired';
  readonly from: string;
}

export interface RecoveryConfigEntry {
  readonly key: string;
  readonly envFile: RecoveryConfigEnvFile;
  readonly classes: readonly RecoveryConfigClass[];
  readonly requiredFor: readonly RecoveryConfigRequirement[];
  /** Grupos que a chave ajusta sem ser exigida (tuning/override). */
  readonly tunes?: readonly ReadinessGroup[];
  readonly source: { readonly kind: RecoveryConfigSourceKind; readonly reference: string };
  readonly reprovisionStrategy: ReprovisionStrategy;
  readonly hostSpecific: boolean;
  readonly secret: boolean;
  readonly validation: RecoveryConfigValidation;
  readonly derivation?: RecoveryConfigDerivation;
  readonly deprecated?: { readonly reason: string; readonly replacedBy?: string };
  /** Alavanca de prova/ops: aceita pelo runtime, nunca recomendada no .env.example. */
  readonly proofOnly?: boolean;
  readonly description: string;
}

/** Grupo opcional só é avaliado quando habilitado; desabilitado ⇒ suas chaves são `not_required`. */
export interface ReadinessGroupSpec {
  readonly group: ReadinessGroup;
  readonly kind: 'core' | 'capability';
  /** Habilitado quando QUALQUER condição vale; ausente ⇒ sempre avaliado. */
  readonly enabledWhenAny?: readonly RecoveryConfigCondition[];
  readonly description: string;
}

const OPENAI_CHAT: RecoveryConfigCondition = { key: 'ANIMA_AI_PROVIDER', in: ['openai'], whenUnset: 'openai' };
const OPENAI_CODER: RecoveryConfigCondition = { key: 'ANIMA_CODER_PROVIDER', in: ['openai'], whenUnset: 'ollama' };
const RUNPOD_ON: RecoveryConfigCondition = { key: 'ANIMA_ON_DEMAND_NODE_ENABLED', in: ['true'], caseInsensitive: true };
const LOCAL_SUPABASE: RecoveryConfigCondition = { key: 'NEXT_PUBLIC_SUPABASE_URL', in: ['http://127.0.0.1:54321', 'http://localhost:54321'] };

export const READINESS_GROUP_SPECS: readonly ReadinessGroupSpec[] = [
  { group: 'core', kind: 'core', description: 'Web/CLI conversam com o Supabase restaurado. Não depende de nenhuma capacidade opcional.' },
  { group: 'resident', kind: 'capability', description: 'Resident Host e CLI autenticam como a identidade residente (GoTrue → Bearer → RLS).' },
  { group: 'chat-openai', kind: 'capability', enabledWhenAny: [OPENAI_CHAT, OPENAI_CODER], description: 'Provider OpenAI (chat principal ou coder), avaliado só quando selecionado. Exige chave server-side.' },
  { group: 'local-ai', kind: 'capability', description: 'Inferência local via Ollama (defaults de localhost já estão no código).' },
  { group: 'self-development', kind: 'capability', description: 'Superfície de desenvolvimento + executor de worktree + coder.' },
  { group: 'runpod', kind: 'capability', enabledWhenAny: [RUNPOD_ON], description: 'Burst on-demand pago via RunPod/SSH (só quando ANIMA_ON_DEMAND_NODE_ENABLED=true).' },
  { group: 'research-web', kind: 'capability', description: 'research.web: SearXNG + agent-browser read-only (fail-closed sem config).' },
  { group: 'mobile', kind: 'capability', description: 'App Expo (apps/mobile/.env.local) aponta para Supabase e para o web host.' },
  { group: 'github-integration', kind: 'capability', description: 'Integração governada: alvo de repositório + review request no GitHub.' },
  { group: 'local-supabase', kind: 'capability', enabledWhenAny: [LOCAL_SUPABASE], description: 'Esta máquina roda o Supabase local: raiz JWT própria em supabase/.env (sem ela a Supabase CLI recusa subir). Cliente fino apontando para outra máquina ⇒ desabilitado.' },
];

const web = 'web' as const;
const mobile = 'mobile' as const;
const supabase = 'supabase' as const;

export const RECOVERY_CONFIG_MANIFEST: readonly RecoveryConfigEntry[] = [
  // ---------- Local Trust Root (supabase/.env; docs/arquitetura/local-trust-root.md) ----------
  {
    key: 'ANIMA_JWT', envFile: supabase, classes: ['secret_required', 'host_specific'],
    requiredFor: [{ group: 'local-supabase' }],
    source: { kind: 'secret_store', reference: 'segredo JWT próprio da máquina (config.toml [auth].jwt_secret = env(ANIMA_JWT))' },
    reprovisionStrategy: 'generate', hostSpecific: true, secret: true, validation: { kind: 'non_empty' },
    description: 'Raiz JWT local (≥32 bytes aleatórios). Rotacionar invalida anon/service_role e sessões vigentes; não mexe em writer nem na fronteira de evidência.',
  },
  {
    key: 'ANIMA_LOCAL_PUBLISHABLE_KEY', envFile: supabase, classes: ['secret_required', 'host_specific'],
    requiredFor: [{ group: 'local-supabase' }],
    source: { kind: 'secret_store', reference: 'config.toml [auth].publishable_key = env(ANIMA_LOCAL_PUBLISHABLE_KEY); gerar sb_publishable_<aleatório>' },
    reprovisionStrategy: 'generate', hostSpecific: true, secret: true, validation: { kind: 'non_empty' },
    description: 'Chave opaca pública do stack local (vira NEXT_PUBLIC_SUPABASE_ANON_KEY/EXPO_PUBLIC_SUPABASE_ANON_KEY). Substitui a padrão publicada da CLI.',
  },
  {
    key: 'ANIMA_LOCAL_SECRET_KEY', envFile: supabase, classes: ['secret_required', 'host_specific'],
    requiredFor: [{ group: 'local-supabase' }],
    source: { kind: 'secret_store', reference: 'config.toml [auth].secret_key = env(ANIMA_LOCAL_SECRET_KEY); gerar sb_secret_<aleatório>' },
    reprovisionStrategy: 'generate', hostSpecific: true, secret: true, validation: { kind: 'non_empty' },
    description: 'Chave opaca service_role do stack local. Substitui a sb_secret_ padrão publicada da CLI (que o Kong convertia em service_role).',
  },
  // ---------- Core Supabase ----------
  {
    key: 'NEXT_PUBLIC_SUPABASE_URL', envFile: web, classes: ['non_secret_required'],
    requiredFor: [{ group: 'core' }, { group: 'resident' }],
    source: { kind: 'derived', reference: '`supabase status` (API URL; local = porta [api] de supabase/config.toml)' },
    reprovisionStrategy: 'derive', hostSpecific: false, secret: false, validation: { kind: 'url' },
    derivation: { status: 'derivable_not_wired', from: 'supabase/config.toml [api].port → http://127.0.0.1:<port>' },
    description: 'URL da API Supabase usada pelo web, CLI e Resident Host.',
  },
  {
    key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', envFile: web, classes: ['non_secret_required'],
    requiredFor: [{ group: 'core' }, { group: 'resident' }],
    source: { kind: 'derived', reference: '`supabase status` (anon/publishable key do stack)' },
    reprovisionStrategy: 'derive', hostSpecific: false, secret: false, validation: { kind: 'non_empty' },
    derivation: { status: 'derivable_not_wired', from: '`supabase status -o env` do stack restaurado' },
    description: 'Chave pública (anon) do Supabase; o acesso real é decidido por RLS.',
  },
  // ---------- Resident identity ----------
  {
    key: 'ANIMA_RESIDENT_EMAIL', envFile: web, classes: ['non_secret_required'],
    requiredFor: [{ group: 'resident' }, { group: 'self-development' }],
    source: { kind: 'operator', reference: 'lookup da identidade restaurada em auth.users (identificador pessoal, não segredo)' },
    reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false, validation: { kind: 'email' },
    description: 'Email da identidade residente. Dado pessoal: nunca impresso pelo checker.',
  },
  {
    key: 'ANIMA_RESIDENT_PASSWORD', envFile: web, classes: ['secret_required'],
    requiredFor: [{ group: 'resident' }, { group: 'self-development' }],
    source: { kind: 'secret_store', reference: 'credencial da identidade residente (GoTrue)' },
    reprovisionStrategy: 'reset_credential', hostSpecific: false, secret: true, validation: { kind: 'non_empty' },
    description: 'Senha residente. Em máquina nova: redefinir a credencial da identidade restaurada; no .env.local deve estar entre aspas se tiver `#`.',
  },
  // ---------- Trusted System Writer (fatos de sistema: evidência do host, Verifier, receipt) ----------
  {
    key: 'ANIMA_SYSTEM_WRITER_EMAIL', envFile: web, classes: ['non_secret_required'],
    requiredFor: [{ group: 'self-development' }],
    source: { kind: 'operator', reference: 'identidade GoTrue DEDICADA com auth.users.role = anima_system_writer, registrada em private.trusted_system_writers' },
    reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false, validation: { kind: 'email' },
    description: 'Email do writer de sistema (distinto do residente). Sem ele, nenhum fato de sistema é gravado (fail-closed).',
  },
  {
    key: 'ANIMA_SYSTEM_WRITER_PASSWORD', envFile: web, classes: ['secret_required'],
    requiredFor: [{ group: 'self-development' }],
    source: { kind: 'secret_store', reference: 'credencial do writer de sistema (GoTrue)' },
    reprovisionStrategy: 'reset_credential', hostSpecific: false, secret: true, validation: { kind: 'non_empty' },
    description: 'Senha do writer de sistema. Somente servidor; nunca NEXT_PUBLIC; nunca impressa.',
  },
  {
    key: 'ANIMA_DEVELOPMENT_CHAT_USER_IDS', envFile: web, classes: ['non_secret_required'],
    requiredFor: [{ group: 'self-development' }],
    source: { kind: 'derived', reference: 'id(s) da identidade restaurada em auth.users' },
    reprovisionStrategy: 'derive', hostSpecific: false, secret: false, validation: { kind: 'uuid_list' },
    derivation: { status: 'derivable_not_wired', from: 'auth.users.id da identidade residente restaurada (não copiar UUID antigo sem validar)' },
    description: 'Allowlist (UUIDs, vírgula) da superfície de desenvolvimento do chat. Rederivar da identidade restaurada.',
  },
  // ---------- AI provider ----------
  {
    key: 'ANIMA_AI_PROVIDER', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['chat-openai', 'local-ai'],
    source: { kind: 'repository', reference: 'default no código: openai (lib/ai/chat-provider.ts)' },
    reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false, validation: { kind: 'enum', values: ['openai', 'ollama'] },
    derivation: { status: 'wired', from: 'default openai' },
    description: 'Provider do chat principal: openai | ollama.',
  },
  {
    key: 'OPENAI_API_KEY', envFile: web, classes: ['secret_required'],
    requiredFor: [{ group: 'chat-openai' }, { group: 'self-development', when: OPENAI_CODER }],
    source: { kind: 'secret_store', reference: 'OpenAI API key server-side' },
    reprovisionStrategy: 'authenticate', hostSpecific: false, secret: true, validation: { kind: 'non_empty' },
    description: 'Credencial OpenAI (chat/planner e coder OpenAI). Nunca exigida com provider=ollama.',
  },
  {
    key: 'OPENAI_MODEL', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['chat-openai'],
    source: { kind: 'repository', reference: 'default no código (lib/ai/chat-provider.ts)' },
    reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false, validation: { kind: 'non_empty' },
    derivation: { status: 'wired', from: 'default do código' },
    description: 'Modelo OpenAI do chat/planner.',
  },
  // ---------- Local / Ollama ----------
  {
    key: 'OLLAMA_URL', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['local-ai'],
    source: { kind: 'derived', reference: 'default no código: http://localhost:11434' },
    reprovisionStrategy: 'derive', hostSpecific: false, secret: false, validation: { kind: 'url' },
    derivation: { status: 'wired', from: 'http://localhost:11434' },
    description: 'Endpoint Ollama. Só declarar se não for o localhost padrão.',
  },
  {
    key: 'OLLAMA_MODEL', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['local-ai'],
    source: { kind: 'repository', reference: 'default no código' }, reprovisionStrategy: 'install', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, derivation: { status: 'wired', from: 'default do código' },
    description: 'Modelo Ollama de chat/detecção (precisa estar instalado no Ollama).',
  },
  {
    key: 'OLLAMA_EMBED_MODEL', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['local-ai'],
    source: { kind: 'repository', reference: 'default no código: nomic-embed-text' }, reprovisionStrategy: 'install', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, derivation: { status: 'wired', from: 'nomic-embed-text' },
    description: 'Modelo de embeddings (precisa estar instalado no Ollama).',
  },
  // ---------- Self-development / worktree / coder ----------
  {
    key: 'ANIMA_PROJECT_ROOT', envFile: web, classes: ['derived', 'host_specific'], requiredFor: [], tunes: ['self-development', 'github-integration'],
    source: { kind: 'derived', reference: 'descoberta a partir do cwd (lib/work-orchestration/executor-selection.ts)' },
    reprovisionStrategy: 'derive', hostSpecific: true, secret: false, validation: { kind: 'absolute_path', mustExist: true },
    derivation: { status: 'wired', from: 'raiz do monorepo descoberta a partir do cwd' },
    description: 'Raiz do repositório. Só declarar para processos fora da árvore.',
  },
  {
    key: 'ANIMA_CODER_PROVIDER', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['self-development'],
    source: { kind: 'repository', reference: 'default no código: ollama (lib/work-orchestration/coder-backend.ts)' },
    reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false, validation: { kind: 'enum', values: ['ollama', 'openai'] },
    derivation: { status: 'wired', from: 'default ollama' },
    description: 'Coder do executor de worktree: ollama | openai (openai exige OPENAI_API_KEY).',
  },
  {
    key: 'ANIMA_CODER_MODEL', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['self-development'],
    source: { kind: 'repository', reference: 'default no código' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, derivation: { status: 'wired', from: 'default do código' },
    description: 'Modelo do coder (Ollama ou OpenAI conforme ANIMA_CODER_PROVIDER).',
  },
  {
    key: 'ANIMA_WORKTREE_CODER_MODEL', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['self-development'],
    source: { kind: 'repository', reference: 'lido por executor-selection/autonomous-backlog-deps' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, description: 'Modelo Ollama do coder de worktree (override).',
  },
  {
    key: 'ANIMA_COMPUTE_ROUTER_V1_ENABLED', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['self-development'],
    source: { kind: 'operator', reference: 'lib/work-orchestration/compute-routing-config.ts' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'enum', values: ['0', '1'] }, derivation: { status: 'wired', from: 'ausente ⇒ Router OFF' },
    description: 'Liga o Compute Router V1 (1). Ausente ⇒ Router OFF, invisível.',
  },
  {
    key: 'ANIMA_CODER_VRAM_GB', envFile: web, classes: ['optional', 'host_specific'], requiredFor: [], tunes: ['self-development'],
    source: { kind: 'operator', reference: 'VRAM da GPU local' }, reprovisionStrategy: 'operator_choice', hostSpecific: true, secret: false,
    validation: { kind: 'number_positive' }, description: 'VRAM disponível para o fallback governado de coder (com a allowlist).',
  },
  {
    key: 'ANIMA_CODER_MODEL_ALLOWLIST', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['self-development'],
    source: { kind: 'operator', reference: 'modelos Ollama instalados' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, description: 'Modelos permitidos ao fallback governado de coder (vírgula). Ausente ⇒ fallback off.',
  },
  ...(['ANIMA_OPENAI_CODER_REASONING_EFFORT', 'ANIMA_OPENAI_CODER_TIMEOUT_MS', 'ANIMA_OPENAI_CODER_OUTPUT_TOKENS', 'ANIMA_OPENAI_CODER_CONTEXT_CAP', 'ANIMA_OPENAI_CODER_DECLARED_CONTEXT'] as const).map(
    (key): RecoveryConfigEntry => ({
      key, envFile: web, classes: ['optional'], requiredFor: [], tunes: ['self-development'],
      source: { kind: 'repository', reference: 'defaults em lib/work-orchestration/gpt-coder.ts' }, reprovisionStrategy: 'operator_choice',
      hostSpecific: false, secret: false, validation: { kind: 'non_empty' }, derivation: { status: 'wired', from: 'default do código' },
      description: 'Tuning avançado do coder OpenAI (default do código quando ausente).',
    }),
  ),
  {
    key: 'ANIMA_PROVIDER_PRICING_CATALOG', envFile: web, classes: ['optional', 'host_specific'], requiredFor: [], tunes: ['self-development'],
    source: { kind: 'repository', reference: 'catálogo versionado provider-pricing-catalog.json' }, reprovisionStrategy: 'derive', hostSpecific: true, secret: false,
    validation: { kind: 'absolute_path', mustExist: true }, derivation: { status: 'wired', from: 'catálogo versionado no repositório' },
    description: 'Override de operador do catálogo de pricing. Ausente ⇒ vale o catálogo do repo.',
  },
  ...(['ANIMA_PROJECT_PLANNER_PROVIDER', 'ANIMA_PROJECT_PLANNER_MODEL', 'ANIMA_PROJECT_PLANNER_ROUND_TIMEOUT_MS'] as const).map(
    (key): RecoveryConfigEntry => ({
      key, envFile: web, classes: ['optional'], requiredFor: [], tunes: ['self-development'],
      source: { kind: 'repository', reference: 'lib/ai/project-work-planner*.ts' }, reprovisionStrategy: 'operator_choice',
      hostSpecific: false, secret: false, validation: { kind: 'non_empty' }, derivation: { status: 'wired', from: 'default do código' },
      description: 'Planner de projeto: provider/modelo/timeout (default do código).',
    }),
  ),
  {
    key: 'ANIMA_PROJECT_PLANNER_CONTEXT_LENGTH', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['self-development'],
    source: { kind: 'repository', reference: 'lib/ai/project-work-planner-local.ts' }, reprovisionStrategy: 'operator_choice',
    hostSpecific: false, secret: false, validation: { kind: 'number_positive' }, derivation: { status: 'wired', from: 'default 16384 do código' },
    description: 'Contexto request-scoped do planner local na API nativa Ollama; inteiro decimal positivo estrito, default 16384.',
  },
  {
    key: 'ANIMA_LOCAL_RUNNER_ROOT', envFile: web, classes: ['optional', 'host_specific'], requiredFor: [], tunes: ['self-development'],
    source: { kind: 'derived', reference: '<raiz do projeto>/tools/local-agent' }, reprovisionStrategy: 'derive', hostSpecific: true, secret: false,
    validation: { kind: 'absolute_path', mustExist: true }, derivation: { status: 'derivable_not_wired', from: 'ANIMA_PROJECT_ROOT/tools/local-agent' },
    description: 'Raiz do runner local (INT-04). Ausente ⇒ rota do runner local indisponível.',
  },
  {
    key: 'ANIMA_LOCAL_TARGETS_JSON', envFile: web, classes: ['optional', 'host_specific'], requiredFor: [], tunes: ['self-development'],
    source: { kind: 'derived', reference: '{"anima": "<raiz do projeto>"}' }, reprovisionStrategy: 'derive', hostSpecific: true, secret: false,
    validation: { kind: 'json_targets' }, derivation: { status: 'derivable_not_wired', from: '{"anima": ANIMA_PROJECT_ROOT}' },
    description: 'Mapa referência → caminho absoluto para o runner local.',
  },
  ...(['ANIMA_LOCAL_RUNNER_MODEL', 'ANIMA_LOCAL_RUNNER_EFFORT'] as const).map(
    (key): RecoveryConfigEntry => ({
      key, envFile: web, classes: ['optional'], requiredFor: [], tunes: ['self-development'],
      source: { kind: 'operator', reference: 'lib/work-orchestration/execution.ts' }, reprovisionStrategy: 'operator_choice',
      hostSpecific: false, secret: false, validation: { kind: 'non_empty' }, description: 'Ajuste do runner local.',
    }),
  ),
  ...(['ANIMA_WORKTREE_OLLAMA_URL', 'ANIMA_WORKTREE_OLLAMA_NODE_ID', 'ANIMA_WORKTREE_OLLAMA_LOCALITY', 'ANIMA_WORKTREE_OLLAMA_BILLING_MODE', 'ANIMA_WORKTREE_OLLAMA_MODELS', 'ANIMA_WORKTREE_OLLAMA_ENABLED', 'ANIMA_WORKTREE_OLLAMA_HEALTHY', 'ANIMA_WORKTREE_OLLAMA_RESOURCE_CLASS'] as const).map(
    (key): RecoveryConfigEntry => ({
      key, envFile: web, classes: ['optional'], requiredFor: [], tunes: ['self-development'],
      source: { kind: 'operator', reference: 'nó Ollama remoto explícito (lib/work-orchestration/coder-placement.ts)' }, reprovisionStrategy: 'operator_choice',
      hostSpecific: false, secret: false, validation: { kind: 'non_empty' }, description: 'Nó de inferência Ollama remoto explícito (burst sem pagamento).',
    }),
  ),
  // ---------- Resident Host ----------
  {
    key: 'ANIMA_AUTONOMY_ENABLED', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['resident'],
    source: { kind: 'operator', reference: 'kill switch do Resident Host' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, description: 'Kill switch de autonomia do Resident Host (decisão humana).',
  },
  {
    key: 'ANIMA_RESIDENT_ROUTE_BASE', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['resident'],
    source: { kind: 'derived', reference: 'default http://localhost:3000' }, reprovisionStrategy: 'derive', hostSpecific: false, secret: false,
    validation: { kind: 'url' }, derivation: { status: 'wired', from: 'http://localhost:3000' }, description: 'Base HTTP do web (só transporte http).',
  },
  {
    key: 'ANIMA_RESIDENT_TRANSPORT', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['resident'],
    source: { kind: 'repository', reference: 'default in_process' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'enum', values: ['in_process', 'http'] }, derivation: { status: 'wired', from: 'in_process' }, description: 'Transporte do Resident Host.',
  },
  {
    key: 'ANIMA_SUPERVISOR_INSTANCE_ID', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['resident'],
    source: { kind: 'repository', reference: 'default supervisor-v0' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, derivation: { status: 'wired', from: 'supervisor-v0' }, description: 'Identificador da instância supervisora (claims).',
  },
  ...(['ANIMA_RESIDENT_LOG_FILE', 'ANIMA_AUTONOMY_FILE', 'ANIMA_RESIDENT_MATERIALIZE_DOCUMENT'] as const).map(
    (key): RecoveryConfigEntry => ({
      key, envFile: web, classes: ['optional', 'host_specific'], requiredFor: [], tunes: ['resident'],
      source: { kind: 'operator', reference: 'scripts/resident-host.ts' }, reprovisionStrategy: 'operator_choice',
      hostSpecific: true, secret: false, validation: { kind: 'absolute_path', mustExist: false }, description: 'Caminho opcional do Resident Host (log, kill-switch em arquivo, documento de backlog).',
    }),
  ),
  ...(['ANIMA_RESIDENT_IDLE_MS', 'ANIMA_RESIDENT_RESOURCE_MS', 'ANIMA_RESIDENT_MAX_TURNS_PER_CYCLE', 'ANIMA_RESIDENT_MAX_CYCLES', 'ANIMA_RESIDENT_MAX_ITERATIONS', 'ANIMA_RESIDENT_MATERIALIZE_SELF_IMPROVEMENT'] as const).map(
    (key): RecoveryConfigEntry => ({
      key, envFile: web, classes: ['optional'], requiredFor: [], tunes: ['resident'],
      source: { kind: 'repository', reference: 'defaults em scripts/resident-host.ts' }, reprovisionStrategy: 'operator_choice',
      hostSpecific: false, secret: false, validation: { kind: 'non_empty' }, derivation: { status: 'wired', from: 'default do código' },
      description: 'Tuning avançado do Resident Host.',
    }),
  ),
  // ---------- RunPod / SSH ----------
  {
    key: 'ANIMA_ON_DEMAND_NODE_ENABLED', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['runpod'],
    source: { kind: 'operator', reference: 'gate do burst on-demand' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'enum', values: ['true', 'false'], caseInsensitive: true }, description: 'Liga o burst on-demand (true). Ausente ⇒ RunPod não é avaliado.',
  },
  {
    key: 'ANIMA_ON_DEMAND_NODE_PROVISIONER', envFile: web, classes: ['non_secret_required'], requiredFor: [{ group: 'runpod' }],
    source: { kind: 'operator', reference: 'runpod (local-process é só prova)' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'enum', values: ['runpod'] }, description: 'Provisioner do burst; para compute real: runpod.',
  },
  {
    key: 'ANIMA_ON_DEMAND_NODE_ID', envFile: web, classes: ['non_secret_required'], requiredFor: [{ group: 'runpod' }],
    source: { kind: 'operator', reference: 'slug do nó' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'slug' }, description: 'Identificador (slug) do nó on-demand.',
  },
  {
    key: 'ANIMA_ON_DEMAND_NODE_BILLING_MODE', envFile: web, classes: ['non_secret_required'], requiredFor: [{ group: 'runpod' }],
    source: { kind: 'operator', reference: 'RunPod só sob paid' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'enum', values: ['paid'] }, description: 'RunPod exige billing paid (passa pelo gate financeiro humano).',
  },
  {
    key: 'ANIMA_RUNPOD_API_KEY', envFile: web, classes: ['secret_required'], requiredFor: [{ group: 'runpod' }],
    source: { kind: 'secret_store', reference: 'RunPod API key' }, reprovisionStrategy: 'authenticate', hostSpecific: false, secret: true,
    validation: { kind: 'non_empty' }, description: 'Credencial RunPod.',
  },
  {
    key: 'ANIMA_RUNPOD_IMAGE', envFile: web, classes: ['non_secret_required'], requiredFor: [{ group: 'runpod' }],
    source: { kind: 'operator', reference: 'imagem do pod' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, description: 'Imagem do pod RunPod.',
  },
  {
    key: 'ANIMA_RUNPOD_GPU_TYPE_IDS', envFile: web, classes: ['non_secret_required'], requiredFor: [{ group: 'runpod' }],
    source: { kind: 'operator', reference: 'catálogo de GPUs RunPod' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, description: 'Classes de GPU aceitas (vírgula).',
  },
  {
    key: 'ANIMA_RUNPOD_SSH_PRIVATE_KEY', envFile: web, classes: ['secret_required', 'host_specific'], requiredFor: [{ group: 'runpod' }],
    source: { kind: 'secret_store', reference: 'chave SSH dedicada (caminho host-side)' }, reprovisionStrategy: 'generate', hostSpecific: true, secret: true,
    validation: { kind: 'absolute_path', mustExist: true }, description: 'Caminho da chave SSH privada dedicada ao RunPod (o arquivo é segredo).',
  },
  {
    key: 'ANIMA_RUNPOD_SSH_PUBLIC_KEY', envFile: web, classes: ['non_secret_required'], requiredFor: [{ group: 'runpod' }],
    source: { kind: 'derived', reference: 'par da chave privada dedicada' }, reprovisionStrategy: 'generate', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, description: 'Chave SSH pública do par dedicado.',
  },
  {
    key: 'ANIMA_RUNPOD_SSH_KNOWN_HOSTS', envFile: web, classes: ['non_secret_required', 'host_specific'], requiredFor: [{ group: 'runpod' }],
    source: { kind: 'operator', reference: 'known_hosts dedicado' }, reprovisionStrategy: 'generate', hostSpecific: true, secret: false,
    validation: { kind: 'absolute_path', mustExist: false }, description: 'known_hosts dedicado ao RunPod.',
  },
  {
    key: 'ANIMA_ON_DEMAND_PRICE_PER_HOUR', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['runpod'],
    source: { kind: 'operator', reference: 'cotação do provider' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'number_positive' }, description: 'Palpite de preço/h para o teto de custo (RunPod também deriva de cotação viva).',
  },
  ...(['ANIMA_ON_DEMAND_PRICE_CURRENCY', 'ANIMA_ON_DEMAND_NODE_RESOURCE_CLASS', 'ANIMA_ON_DEMAND_MAX_CONCURRENT_PAID_NODES', 'ANIMA_RUNPOD_GPU_COUNT', 'ANIMA_RUNPOD_CLOUD_TYPE', 'ANIMA_RUNPOD_CONTAINER_DISK_GB', 'ANIMA_RUNPOD_VOLUME_GB', 'ANIMA_RUNPOD_NETWORK_VOLUME_ID', 'ANIMA_RUNPOD_INFERENCE_PORT', 'ANIMA_RUNPOD_HEALTH_PATH', 'ANIMA_RUNPOD_API_BASE', 'ANIMA_RUNPOD_GRAPHQL_BASE', 'ANIMA_RUNPOD_POD_ENV_JSON', 'ANIMA_RUNPOD_HTTP_TIMEOUT_MS', 'ANIMA_RUNPOD_TCP_PROBE_TIMEOUT_MS', 'ANIMA_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS', 'ANIMA_RUNPOD_MAX_PROVISION_MS', 'ANIMA_RUNPOD_TUNNEL_READY_TIMEOUT_MS', 'ANIMA_RUNPOD_MODEL_READY_TIMEOUT_MS', 'ANIMA_RESILIENT_CLOUD_SESSION', 'ANIMA_RESILIENT_CLOUD_MAX_PROVISION_ATTEMPTS', 'ANIMA_RESILIENT_CLOUD_MAX_ATTEMPTS_PER_PLACEMENT'] as const).map(
    (key): RecoveryConfigEntry => ({
      key, envFile: web, classes: ['optional'], requiredFor: [], tunes: ['runpod'],
      source: { kind: 'repository', reference: 'defaults em runpod-node-provisioner.ts / resident-on-demand-node.ts' }, reprovisionStrategy: 'operator_choice',
      hostSpecific: false, secret: false, validation: { kind: 'non_empty' }, derivation: { status: 'wired', from: 'default do código' },
      description: 'Tuning avançado do RunPod / sessão resiliente.',
    }),
  ),
  {
    key: 'ANIMA_ON_DEMAND_FORCE_BURST', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['runpod'], proofOnly: true,
    source: { kind: 'operator', reference: 'alavanca de prova/ops' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'enum', values: ['true', 'false'], caseInsensitive: true }, description: 'Força o burst mesmo com headroom local. Só prova/ops; não burla o gate financeiro.',
  },
  // ---------- Research Web ----------
  {
    key: 'ANIMA_RESEARCH_SEARXNG_URL', envFile: web, classes: ['non_secret_required'], requiredFor: [{ group: 'research-web' }],
    source: { kind: 'operator', reference: 'instância SearXNG self-hosted' }, reprovisionStrategy: 'install', hostSpecific: false, secret: false,
    validation: { kind: 'url' }, description: 'URL do SearXNG. Ausente ⇒ research.web indisponível (fail-closed).',
  },
  {
    key: 'ANIMA_RESEARCH_AGENT_BROWSER_BIN', envFile: web, classes: ['non_secret_required', 'host_specific'], requiredFor: [{ group: 'research-web' }],
    source: { kind: 'operator', reference: 'binário agent-browser instalado' }, reprovisionStrategy: 'install', hostSpecific: true, secret: false,
    validation: { kind: 'absolute_path', mustExist: true }, description: 'Caminho do binário agent-browser.',
  },
  ...(['ANIMA_RESEARCH_BROWSER_RUNTIME', 'ANIMA_RESEARCH_SEARXNG_ENGINES', 'ANIMA_RESEARCH_MAX_RESULTS', 'ANIMA_RESEARCH_TIMEOUT_MS', 'ANIMA_RESEARCH_BROWSER_MAX_OUTPUT', 'ANIMA_RESEARCH_PROJECT_PUBLIC_TERMS'] as const).map(
    (key): RecoveryConfigEntry => ({
      key, envFile: web, classes: ['optional'], requiredFor: [], tunes: ['research-web'],
      source: { kind: 'repository', reference: 'defaults em lib/research-web/config.ts' }, reprovisionStrategy: 'operator_choice',
      hostSpecific: false, secret: false, validation: { kind: 'non_empty' }, derivation: { status: 'wired', from: 'default do código' },
      description: 'Tuning do research.web.',
    }),
  ),
  // ---------- GitHub integration ----------
  ...(['ANIMA_INTEGRATION_REPOSITORY_ID', 'ANIMA_INTEGRATION_REMOTE_NAME', 'ANIMA_INTEGRATION_BASE_BRANCH'] as const).map(
    (key): RecoveryConfigEntry => ({
      key, envFile: web, classes: ['non_secret_required'], requiredFor: [{ group: 'github-integration' }],
      source: { kind: 'operator', reference: 'lib/work-orchestration/integration-target.ts' }, reprovisionStrategy: 'operator_choice',
      hostSpecific: false, secret: false, validation: { kind: 'non_empty' },
      description: 'Alvo de integração governada (URL canônica do remote / nome do remote / branch-base).',
    }),
  ),
  {
    key: 'ANIMA_INTEGRATION_REPO_ROOT', envFile: web, classes: ['derived', 'host_specific'], requiredFor: [], tunes: ['github-integration'],
    source: { kind: 'derived', reference: 'raiz do projeto' }, reprovisionStrategy: 'derive', hostSpecific: true, secret: false,
    validation: { kind: 'absolute_path', mustExist: true }, derivation: { status: 'wired', from: 'raiz do projeto' },
    description: 'Raiz do repositório de integração (default = raiz do projeto).',
  },
  {
    key: 'ANIMA_INTEGRATION_GITHUB_TOKEN', envFile: web, classes: ['secret_required'], requiredFor: [{ group: 'github-integration' }],
    source: { kind: 'external_auth', reference: 'token GitHub com escopo mínimo de review request' }, reprovisionStrategy: 'authenticate', hostSpecific: false, secret: true,
    validation: { kind: 'non_empty' }, description: 'Token GitHub para o review request governado.',
  },
  {
    key: 'ANIMA_INTEGRATION_GITHUB_API_URL', envFile: web, classes: ['optional'], requiredFor: [], tunes: ['github-integration'],
    source: { kind: 'repository', reference: 'default https://api.github.com' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'url' }, derivation: { status: 'wired', from: 'https://api.github.com' }, description: 'API GitHub (GHES).',
  },
  // ---------- Mobile (apps/mobile/.env.local) ----------
  {
    key: 'EXPO_PUBLIC_SUPABASE_URL', envFile: mobile, classes: ['non_secret_required'], requiredFor: [{ group: 'mobile' }],
    source: { kind: 'derived', reference: 'mesmo Supabase do web, por endereço alcançável pelo telefone' }, reprovisionStrategy: 'derive', hostSpecific: false, secret: false,
    validation: { kind: 'url' }, description: 'URL do Supabase vista pelo app.',
  },
  {
    key: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', envFile: mobile, classes: ['non_secret_required'], requiredFor: [{ group: 'mobile' }],
    source: { kind: 'derived', reference: '`supabase status`' }, reprovisionStrategy: 'derive', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, description: 'Chave anon do Supabase para o app.',
  },
  {
    key: 'EXPO_PUBLIC_ANIMA_WEB_URL', envFile: mobile, classes: ['non_secret_required'], requiredFor: [{ group: 'mobile' }],
    source: { kind: 'operator', reference: 'origem http(s) do web host alcançável pelo telefone' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'url' }, description: 'Host do web para a retomada canônica do Supervisor.',
  },
  ...(['EXPO_PUBLIC_OLLAMA_URL', 'EXPO_PUBLIC_OLLAMA_MODEL', 'EXPO_PUBLIC_OLLAMA_EMBED_MODEL', 'EXPO_PUBLIC_WHISPER_URL', 'EXPO_PUBLIC_WHISPER_MODEL'] as const).map(
    (key): RecoveryConfigEntry => ({
      key, envFile: mobile, classes: ['optional'], requiredFor: [], tunes: ['mobile'],
      source: { kind: 'operator', reference: 'apps/mobile/lib' }, reprovisionStrategy: 'operator_choice',
      hostSpecific: false, secret: false, validation: { kind: 'non_empty' }, description: 'Endpoints/modelos opcionais do app (Ollama, Whisper).',
    }),
  ),
  // ---------- Deprecated / legado (nunca bloqueiam; nunca recomendados) ----------
  {
    key: 'ANIMA_WORKTREE_CODER_BACKEND', envFile: web, classes: ['deprecated'], requiredFor: [],
    source: { kind: 'repository', reference: 'alias aceito por coder-backend.ts' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'enum', values: ['ollama', 'openai'] }, deprecated: { reason: 'alias antigo', replacedBy: 'ANIMA_CODER_PROVIDER' },
    description: 'Alias antigo do provider do coder.',
  },
  {
    key: 'ANIMA_COMPUTE_ROUTER_V1', envFile: web, classes: ['deprecated'], requiredFor: [],
    source: { kind: 'repository', reference: 'só scripts de prova antigos' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, deprecated: { reason: 'o runtime lê apenas o sufixo _ENABLED', replacedBy: 'ANIMA_COMPUTE_ROUTER_V1_ENABLED' },
    description: 'Nome antigo do flag do Router.',
  },
  {
    key: 'WHISPER_URL', envFile: web, classes: ['deprecated'], requiredFor: [],
    source: { kind: 'operator', reference: 'sem consumidor no web' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, deprecated: { reason: 'nenhum consumidor no apps/web; o mobile usa EXPO_PUBLIC_WHISPER_URL', replacedBy: 'EXPO_PUBLIC_WHISPER_URL' },
    description: 'Endpoint Whisper sem consumidor no web.',
  },
  {
    key: 'SUPABASE_SERVICE_ROLE_KEY', envFile: web, classes: ['deprecated'], requiredFor: [], secret: true,
    source: { kind: 'secret_store', reference: 'não consumida pelo runtime; a CLI recusa explicitamente' }, reprovisionStrategy: 'derive', hostSpecific: false,
    validation: { kind: 'non_empty' }, deprecated: { reason: 'service_role nunca faz parte do runtime normal (identidade residente + RLS)' },
    description: 'Chave administrativa do Supabase. Não configurar no runtime normal.',
  },
  {
    key: 'ANIMA_UX02_DETERMINISTIC_PROOF', envFile: web, classes: ['deprecated'], requiredFor: [], proofOnly: true,
    source: { kind: 'repository', reference: 'prova UX-02 histórica' }, reprovisionStrategy: 'operator_choice', hostSpecific: false, secret: false,
    validation: { kind: 'non_empty' }, deprecated: { reason: 'flag de prova histórica' }, description: 'Prova determinística UX-02.',
  },
  ...(['ANIMA_ON_DEMAND_NODE_TARGET_PATH', 'ANIMA_ON_DEMAND_NODE_TARGET_CONTENT', 'ANIMA_ON_DEMAND_NODE_FAILURE_MODE'] as const).map(
    (key): RecoveryConfigEntry => ({
      key, envFile: web, classes: ['deprecated'], requiredFor: [], proofOnly: true,
      source: { kind: 'repository', reference: 'provisioner local-process (fake node de prova)' }, reprovisionStrategy: 'operator_choice',
      hostSpecific: false, secret: false, validation: { kind: 'non_empty' }, deprecated: { reason: 'só para o provisioner de prova local-process' },
      description: 'Parâmetro do nó falso de prova.',
    }),
  ),
];

/** Prefixos considerados "configuração do Anima" para detectar chaves desconhecidas (só nomes). */
export const RECOVERY_CONFIG_KEY_PREFIXES = ['ANIMA_', 'OPENAI_', 'OLLAMA_', 'NEXT_PUBLIC_', 'SUPABASE_', 'WHISPER_', 'EXPO_PUBLIC_'] as const;
