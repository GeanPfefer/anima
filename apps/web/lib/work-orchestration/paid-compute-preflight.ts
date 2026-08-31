// ============================================================
// PREFLIGHT de compute pago — READ-ONLY / NO-SPEND (Milestone K).
//
// Diz, SEM provisionar e SEM chamar provider, se o subsistema está pronto para que uma FUTURA
// autorização humana libere uma prova paga real. Lê apenas configuração de ambiente e a
// PRESENÇA (nunca o valor) da credencial. Separa dois estados que NÃO se implicam:
//   - READY_FOR_HUMAN_PAID_AUTHORIZATION: a infra está montada (env-gate, provider, credencial
//     presente, imagem/GPU, teardown e recovery disponíveis). O humano PODE então autorizar.
//   - PAID_EXECUTION_AUTHORIZED: além da infra, EXISTE uma autorização humana válida no
//     envelope. Só este estado permitiria gasto — e mesmo assim o gate por-volta decide.
// Preflight NUNCA provisiona nem faz chamada que possa cobrar.
// ============================================================

export type PreflightStatus = 'ok' | 'missing';

export interface PreflightCondition {
  readonly key: string;
  readonly status: PreflightStatus;
  readonly detail: string;
}

export interface PaidComputePreflightReport {
  readonly conditions: readonly PreflightCondition[];
  /** Condições de INFRA satisfeitas (tudo menos a autorização humana). */
  readonly infraReady: boolean;
  /** A infra está pronta para RECEBER uma autorização humana paga. NÃO implica gasto liberado. */
  readonly readyForHumanPaidAuthorization: boolean;
  /** Infra pronta E autorização humana válida presente. Único estado que permitiria gasto — e
   * ainda assim sob o gate financeiro por-volta. */
  readonly paidExecutionAuthorized: boolean;
  /** O que ainda falta (chaves das condições `missing`). */
  readonly missing: readonly string[];
}

export interface PaidComputePreflightInput {
  readonly env?: Record<string, string | undefined>;
  /** Existe autorização humana VÁLIDA no envelope? (resultado de um READ prévio do store +
   * evaluatePaidComputeAuthorization pelo caller). Ausente/false = sem autorização. O preflight
   * NÃO lê o banco nem o provider. */
  readonly humanAuthorizationValid?: boolean;
}

const present = (v: string | undefined): boolean => typeof v === 'string' && v.trim().length > 0;
const cond = (key: string, ok: boolean, detail: string): PreflightCondition => ({ key, status: ok ? 'ok' : 'missing', detail });

/**
 * Avalia o preflight de compute pago a partir do ambiente (read-only). NUNCA expõe o valor da
 * credencial — só a presença. NUNCA provisiona. PURA dado o `env` injetado.
 */
export function assessPaidComputePreflight(input: PaidComputePreflightInput = {}): PaidComputePreflightReport {
  const env = input.env ?? process.env;
  const nodeId = env.ANIMA_ON_DEMAND_NODE_ID?.trim() ?? '';

  // Condições de INFRA (nenhuma lê valor sensível; api key só por presença).
  const infra: PreflightCondition[] = [
    cond('env_gate_enabled', env.ANIMA_ON_DEMAND_NODE_ENABLED?.trim().toLowerCase() === 'true', 'ANIMA_ON_DEMAND_NODE_ENABLED=true'),
    cond('provisioner_runpod', env.ANIMA_ON_DEMAND_NODE_PROVISIONER?.trim() === 'runpod', 'ANIMA_ON_DEMAND_NODE_PROVISIONER=runpod'),
    cond('billing_mode_paid', env.ANIMA_ON_DEMAND_NODE_BILLING_MODE?.trim() === 'paid', 'RunPod só sob billingMode=paid'),
    cond('node_id_valid', /^[a-z0-9][a-z0-9-]{0,62}$/.test(nodeId), 'ANIMA_ON_DEMAND_NODE_ID (slug)'),
    cond('api_key_present', present(env.ANIMA_RUNPOD_API_KEY), 'ANIMA_RUNPOD_API_KEY presente (valor nunca exposto)'),
    cond('image_configured', present(env.ANIMA_RUNPOD_IMAGE), 'ANIMA_RUNPOD_IMAGE'),
    cond('gpu_class_configured', present(env.ANIMA_RUNPOD_GPU_TYPE_IDS), 'ANIMA_RUNPOD_GPU_TYPE_IDS'),
  ];
  // Estruturalmente disponíveis (o adapter implementa; nada a configurar):
  const structural: PreflightCondition[] = [
    cond('inference_endpoint', true, `porta de inferência ${env.ANIMA_RUNPOD_INFERENCE_PORT?.trim() || '11434'} + health ${env.ANIMA_RUNPOD_HEALTH_PATH?.trim() || '/'}`),
    cond('teardown_path', true, 'stop + destroy implementados na porta NodeProvisioner'),
    cond('recovery_reconciler', true, 'locate + reconcilePaidComputeLeases (órfão após restart)'),
    cond('lease_bounded_by_authority', true, 'deriveBoundedLease clampa deadline à validUntil da autorização'),
    // Informativo (NÃO exigido para infra): sem priceHint configurado, uma autorização COM teto
    // de custo NEGA fail-closed; uma autorização só-temporal (sem teto de custo) segue válida.
    cond('price_hint_for_cost_ceiling', present(env.ANIMA_ON_DEMAND_PRICE_PER_HOUR), 'ANIMA_ON_DEMAND_PRICE_PER_HOUR (só necessário p/ autorização com teto de custo)'),
  ];
  const humanAuth = cond('human_paid_authorization', input.humanAuthorizationValid === true, 'autorização humana válida no envelope (ato humano; nunca fabricada)');

  const infraReady = infra.every(c => c.status === 'ok');
  const conditions = [...infra, ...structural, humanAuth];
  return {
    conditions,
    infraReady,
    readyForHumanPaidAuthorization: infraReady,
    paidExecutionAuthorized: infraReady && humanAuth.status === 'ok',
    // `missing` lista só o REQUERIDO (infra + autorização humana). Condições estruturais/
    // informativas (ex.: price_hint, só necessário p/ teto de custo) ficam em `conditions`.
    missing: [...infra, humanAuth].filter(c => c.status === 'missing').map(c => c.key),
  };
}
