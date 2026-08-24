import type { ProjectAdvisoryAnswer } from './project-advisor';
import { buildOperationalProjectSnapshot } from './project-operational-snapshot';
import {
  derivePresentedItemReferences,
  isConversationalItemReferenceQuestion,
  parsePresentedItemReferences,
  resolveConversationalItemReference,
  type PresentedItemReference,
} from './project-conversational-item-reference';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const refs: readonly PresentedItemReference[] = [
  { workItemId: A, ordinal: 1, role: 'active_item' },
  { workItemId: B, ordinal: 2, role: 'unresolved_failure' },
];
const snapshot = buildOperationalProjectSnapshot({
  generatedAt: '2026-08-24T20:00:00Z', focus: null,
  items: [
    { id: A, state: 'in_progress', capability: 'programming', updatedAt: '2026-08-24T19:00:00Z' },
    { id: B, state: 'failed', capability: 'programming', updatedAt: '2026-08-24T18:00:00Z' },
    { id: C, state: 'review', capability: 'programming', updatedAt: '2026-08-24T17:00:00Z' },
  ],
  events: [{ workItemId: B, eventType: 'execution_failed', author: 'executor', occurredAt: '2026-08-24T18:00:00Z' }],
});
const claim = (statement: string) => ({ statement, sourceIds: ['state'], authorityClasses: ['observed_state'] as const });
const answer = (statements: string[]): ProjectAdvisoryAnswer => ({
  facts: statements.map(claim), provenCapabilities: [], unprovenFrontiers: [], canonicalDirections: [],
  recommendation: claim('Observe.'), rationale: [claim('Porque há estado.')], insufficiencies: [],
});

describe('referências apresentadas', () => {
  test('deriva somente UUIDs realmente mencionados na ordem da resposta', () => expect(derivePresentedItemReferences(answer([`Item ${B}`, `Item ${A}`]), snapshot)).toEqual([
    { workItemId: B, ordinal: 1, role: 'unresolved_failure' }, { workItemId: A, ordinal: 2, role: 'active_item' },
  ]));
  test('não inclui item do snapshot que não foi apresentado', () => expect(derivePresentedItemReferences(answer([`Item ${A}`]), snapshot)).toHaveLength(1));
  test('deduplica menções repetidas', () => expect(derivePresentedItemReferences(answer([A, A]), snapshot)).toHaveLength(1));
  test('classifica review quando apresentado', () => expect(derivePresentedItemReferences(answer([C]), snapshot)[0]?.role).toBe('review_item'));
  test('descarta UUID desconhecido', () => expect(derivePresentedItemReferences(answer(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']), snapshot)).toEqual([]));
  test('parser aceita somente contrato mínimo', () => expect(parsePresentedItemReferences(refs)).toEqual(refs));
  test('parser rejeita payload adicional', () => expect(parsePresentedItemReferences([{ ...refs[0], payload: 'bruto' }])).toEqual([]));
  test('parser rejeita ordinal inconsistente', () => expect(parsePresentedItemReferences([{ ...refs[0], ordinal: 2 }])).toEqual([]));
  test('parser rejeita duplicata', () => expect(parsePresentedItemReferences([refs[0], { ...refs[0], ordinal: 2 }])).toEqual([]));
});

describe('resolução conversacional determinística', () => {
  test('o primeiro resolve o primeiro apresentado', () => expect(resolveConversationalItemReference('Me fale mais sobre o primeiro.', refs)).toMatchObject({ kind: 'resolved', itemId: A }));
  test('o segundo resolve o segundo apresentado', () => expect(resolveConversationalItemReference('E o segundo?', refs)).toMatchObject({ kind: 'resolved', itemId: B }));
  test('ordinal não consulta posição global: usa a ordem recebida', () => expect(resolveConversationalItemReference('o primeiro', [...refs].reverse().map((ref, index) => ({ ...ref, ordinal: index + 1 })))).toMatchObject({ itemId: B }));
  test('esse item resolve com uma referência', () => expect(resolveConversationalItemReference('E esse item?', refs.slice(0, 1))).toMatchObject({ kind: 'resolved', itemId: A }));
  test('esse item é ambíguo com duas referências', () => expect(resolveConversationalItemReference('E esse item?', refs)).toMatchObject({ kind: 'clarification_required' }));
  test('ele resolve somente quando a anáfora é inequívoca', () => { expect(resolveConversationalItemReference('Por que ele está assim?', refs.slice(0, 1))).toMatchObject({ itemId: A }); expect(resolveConversationalItemReference('Por que ele está assim?', refs)).toMatchObject({ kind: 'clarification_required' }); });
  test('essa falha filtra somente papel de falha apresentado', () => expect(resolveConversationalItemReference('Me mostra essa falha.', refs)).toMatchObject({ kind: 'resolved', itemId: B }));
  test('falha não apresentada não consulta banco global', () => expect(resolveConversationalItemReference('Me mostra essa falha.', refs.slice(0, 1))).toEqual({ kind: 'not_contextual' }));
  test('UUID explícito continua delegado ao resolver existente', () => expect(resolveConversationalItemReference(`item ${A}`, refs)).toEqual({ kind: 'not_contextual' }));
  test('prefixo explícito continua delegado ao resolver existente', () => expect(resolveConversationalItemReference('item 11111111', refs)).toEqual({ kind: 'not_contextual' }));
  test('turno mais recente governa porque apenas seu conjunto é recebido', () => expect(resolveConversationalItemReference('o primeiro', [{ workItemId: C, ordinal: 1, role: 'review_item' }])).toMatchObject({ itemId: C }));
  test('a mesma coleção sustenta primeiro e depois segundo sem consulta global', () => { expect(resolveConversationalItemReference('o primeiro', refs)).toMatchObject({ itemId: A }); expect(resolveConversationalItemReference('e o segundo', refs)).toMatchObject({ itemId: B }); });
  test('sem referência contextual falha fechado', () => expect(resolveConversationalItemReference('o primeiro', [])).toEqual({ kind: 'not_contextual' }));
  test('detector não captura chat normal', () => { expect(isConversationalItemReferenceQuestion('E o segundo?')).toBe(true); expect(isConversationalItemReferenceQuestion('Hoje corri 30 minutos.')).toBe(false); });
});
