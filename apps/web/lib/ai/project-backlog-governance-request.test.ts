import { validateProjectBacklogProposalDraft } from '@anima/core';
import { buildLocalFirstBacklogDraft } from './project-backlog-governance-request';

describe('composição real do Backlog Proposal V0', () => {
  test('decompõe local-first em três slices causais válidos', () => {
    const draft=buildLocalFirstBacklogDraft();
    expect(validateProjectBacklogProposalDraft(draft)).toBeNull();
    expect(draft.slices.map(s=>s.sliceKey)).toEqual(['compute-node-inventory','local-first-routing-policy','controlled-routing-proof']);
    expect(draft.slices[1]?.dependencies).toEqual(['compute-node-inventory']);
    expect(draft.slices[2]?.dependencies).toEqual(['local-first-routing-policy']);
  });
  test('mantém auto-provisioning explicitamente fora',()=>expect(buildLocalFirstBacklogDraft().exclusions).toContain('Auto-provisioning de cloud'));
  test('revisão humana entra no rationale sem virar preferência humana',()=>expect(buildLocalFirstBacklogDraft('não quero provisioning').rationale).toContain('não quero provisioning'));
});
