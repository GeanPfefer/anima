import { existsSync } from 'fs';
import { join } from 'path';
import { ANIMA_CAPABILITY_REGISTRY_V0 } from './capability-registry';
import {
  ANIMA_PRODUCT_DIRECTION_V1,
  groupProductDirection,
  PRODUCT_DIRECTION_NOTICE,
  PRODUCT_DIRECTION_STATUSES,
  validateProductDirection,
  type ProductDirection,
  type ProductDirectionItem,
} from './product-direction';

const ids = new Set(ANIMA_CAPABILITY_REGISTRY_V0.map((c) => c.id));
const item = (over: Partial<ProductDirectionItem> = {}): ProductDirectionItem => ({
  id: 'x', status: 'next', title: 't', rationale: 'r', refs: [{ kind: 'doc', ref: 'AGENTS.md' }], ...over,
});
const dir = (items: ProductDirectionItem[], over: Partial<ProductDirection> = {}): ProductDirection => ({
  decidedAt: '2026-11-03', decidedBy: 'operador', items, ...over,
});
const complete = (): ProductDirectionItem[] => PRODUCT_DIRECTION_STATUSES.map((status) => item({ id: status, status }));

describe('direção do produto (editorial)', () => {
  test('a direção aprovada é válida contra o registry atual', () => {
    expect(validateProductDirection(ANIMA_PRODUCT_DIRECTION_V1, ids)).toEqual([]);
  });

  test('representa exatamente a direção aprovada em 2026-11-03', () => {
    const byStatus = Object.fromEntries(groupProductDirection(ANIMA_PRODUCT_DIRECTION_V1).map((g) => [g.status, g.items.map((i) => i.id)]));
    expect(byStatus).toEqual({
      current_focus: ['value-01'],
      next: ['reduce-human-interventions'],
      experimental: ['a2-uac', 'wsl-isolation', 'advanced-mandate-governance'],
      parked: ['ollama-local', 'dsh', 'runpod'],
    });
    expect(groupProductDirection(ANIMA_PRODUCT_DIRECTION_V1).map((g) => g.status)).toEqual([...PRODUCT_DIRECTION_STATUSES]);
    expect(ANIMA_PRODUCT_DIRECTION_V1.decidedAt).toBe('2026-11-03');
  });

  test('toda referência aponta para um arquivo que existe', () => {
    const root = join(__dirname, '..', '..', '..');
    for (const i of ANIMA_PRODUCT_DIRECTION_V1.items) {
      for (const ref of i.refs) expect({ ref: ref.ref, exists: existsSync(join(root, ref.ref)) }).toEqual({ ref: ref.ref, exists: true });
    }
  });

  test('nunca afirma conclusão, prova ou autonomia e a VALUE-01 não vira resultado', () => {
    // Só negações explícitas ("não comprovada", "sem prova") são aceitas; nenhuma afirmação positiva.
    const text = JSON.stringify(ANIMA_PRODUCT_DIRECTION_V1).toLowerCase().replace(/não comprovada/g, '');
    expect(text).not.toMatch(/comprovad|conclu[ií]d|pronto|aut[oô]nomo/);
    expect(PRODUCT_DIRECTION_NOTICE).toMatch(/Não representa conclusão/);
    const value = ANIMA_PRODUCT_DIRECTION_V1.items.find((i) => i.id === 'value-01');
    expect(value?.relatedCapabilityIds).toBeUndefined();
    expect(value?.rationale).toMatch(/ainda não tem plano nem medição/);
  });

  test('não altera o registry: nenhuma capacidade carrega direção e nada é autonomous', () => {
    for (const c of ANIMA_CAPABILITY_REGISTRY_V0) {
      expect(Object.keys(c)).not.toContain('direction');
      expect(c.maturity).not.toBe('autonomous');
    }
  });

  test('recusa estado inválido, id duplicado, texto vazio, referência ausente e capacidade inexistente', () => {
    const codes = (items: ProductDirectionItem[]) => validateProductDirection(dir(items), ids).map((i) => i.code);
    expect(codes([...complete(), item({ id: 'bad', status: 'done' as never })])).toContain('invalid_status');
    expect(codes([...complete(), item({ id: 'next' })])).toContain('duplicate_id');
    expect(codes([...complete(), item({ id: 'e', rationale: ' ' })])).toContain('missing_text');
    expect(codes([...complete(), item({ id: 'r', refs: [] })])).toContain('missing_ref');
    expect(codes([...complete(), item({ id: 'r2', refs: [{ kind: 'doc', ref: ' ' }] })])).toContain('missing_ref');
    expect(codes([...complete(), item({ id: 'c', relatedCapabilityIds: ['nao.existe'] })])).toContain('unknown_capability');
  });

  test('recusa data inválida, autor vazio e grupo de estado sem itens', () => {
    expect(validateProductDirection(dir(complete(), { decidedAt: '03/11/2026' }), ids).map((i) => i.code)).toContain('invalid_date');
    expect(validateProductDirection(dir(complete(), { decidedBy: ' ' }), ids).map((i) => i.code)).toContain('missing_text');
    expect(validateProductDirection(dir(complete().filter((i) => i.status !== 'parked')), ids).map((i) => i.code)).toContain('missing_status_group');
  });
});
