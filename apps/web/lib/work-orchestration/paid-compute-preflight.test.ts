/** @jest-environment node */
import { assessPaidComputePreflight } from './paid-compute-preflight';

const API_KEY = 'rp_secret_preflight_key';
const FULL = {
  ANIMA_ON_DEMAND_NODE_ENABLED: 'true', ANIMA_ON_DEMAND_NODE_PROVISIONER: 'runpod',
  ANIMA_ON_DEMAND_NODE_BILLING_MODE: 'paid', ANIMA_ON_DEMAND_NODE_ID: 'burst-a',
  ANIMA_RUNPOD_API_KEY: API_KEY, ANIMA_RUNPOD_IMAGE: 'ollama/ollama', ANIMA_RUNPOD_GPU_TYPE_IDS: 'NVIDIA A40',
} as const;

describe('assessPaidComputePreflight (READ-ONLY / NO-SPEND)', () => {
  test('infra completa SEM autorização humana → READY_FOR_HUMAN_PAID_AUTHORIZATION, NÃO AUTHORIZED', () => {
    const r = assessPaidComputePreflight({ env: FULL });
    expect(r.infraReady).toBe(true);
    expect(r.readyForHumanPaidAuthorization).toBe(true);
    expect(r.paidExecutionAuthorized).toBe(false); // separação-chave: infra pronta ≠ gasto liberado
    expect(r.missing).toEqual(['human_paid_authorization']);
  });

  test('infra completa + autorização humana válida → PAID_EXECUTION_AUTHORIZED', () => {
    const r = assessPaidComputePreflight({ env: FULL, humanAuthorizationValid: true });
    expect(r.paidExecutionAuthorized).toBe(true);
    expect(r.missing).toEqual([]);
  });

  test('a chave NUNCA aparece no relatório (só presença)', () => {
    const r = assessPaidComputePreflight({ env: FULL, humanAuthorizationValid: true });
    expect(JSON.stringify(r)).not.toContain(API_KEY);
    expect(r.conditions.find(c => c.key === 'api_key_present')).toMatchObject({ status: 'ok' });
  });

  test('sem API key → infra NÃO pronta e a ausência é reportada (fail-closed)', () => {
    const { ANIMA_RUNPOD_API_KEY: _omit, ...noKey } = FULL;
    const r = assessPaidComputePreflight({ env: noKey });
    expect(r.infraReady).toBe(false);
    expect(r.readyForHumanPaidAuthorization).toBe(false);
    expect(r.missing).toContain('api_key_present');
  });

  test('billing owned / env-gate off → condições faltantes explícitas', () => {
    expect(assessPaidComputePreflight({ env: { ...FULL, ANIMA_ON_DEMAND_NODE_BILLING_MODE: 'owned' } }).missing).toContain('billing_mode_paid');
    expect(assessPaidComputePreflight({ env: { ...FULL, ANIMA_ON_DEMAND_NODE_ENABLED: 'false' } }).missing).toContain('env_gate_enabled');
  });

  test('price_hint é informativo: sem ele infra segue pronta; ele NÃO entra em `missing`', () => {
    const semPreco = assessPaidComputePreflight({ env: FULL }); // FULL não tem ANIMA_ON_DEMAND_PRICE_PER_HOUR
    expect(semPreco.infraReady).toBe(true);
    expect(semPreco.missing).not.toContain('price_hint_for_cost_ceiling');
    expect(semPreco.conditions.find(c => c.key === 'price_hint_for_cost_ceiling')).toMatchObject({ status: 'missing' });
    const comPreco = assessPaidComputePreflight({ env: { ...FULL, ANIMA_ON_DEMAND_PRICE_PER_HOUR: '1.5' } });
    expect(comPreco.conditions.find(c => c.key === 'price_hint_for_cost_ceiling')).toMatchObject({ status: 'ok' });
  });

  test('teardown/recovery/lease-bounded são estruturalmente disponíveis (não exigem config)', () => {
    const r = assessPaidComputePreflight({ env: FULL });
    for (const key of ['teardown_path', 'recovery_reconciler', 'lease_bounded_by_authority']) {
      expect(r.conditions.find(c => c.key === key)).toMatchObject({ status: 'ok' });
    }
  });
});
