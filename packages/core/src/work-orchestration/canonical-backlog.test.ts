import {
  parseCanonicalBacklog,
  classifyCanonicalBacklogStatus,
} from './canonical-backlog';

// Descoberta READ-ONLY do backlog canônico é PURA e determinística — provada por doubles
// de markdown (estrutura real do 002-backlog.md) sem tocar arquivo/rede/banco.

describe('classifyCanonicalBacklogStatus (puro)', () => {
  test('done: concluído / aceito / ratificado', () => {
    expect(classifyCanonicalBacklogStatus('concluído.')).toBe('done');
    expect(classifyCanonicalBacklogStatus('aceito')).toBe('done');
    expect(classifyCanonicalBacklogStatus('a revisão humana ratificou o item')).toBe('done');
  });
  test('conservador: "implementado" SOZINHO não é done (pode estar aguardando ratificação)', () => {
    // Evita falso-done em "implementado, aguardando ratificação". Só conclu/ratific/aceit contam.
    expect(classifyCanonicalBacklogStatus('implementado e provado')).toBe('unknown');
    expect(classifyCanonicalBacklogStatus('implementado, aguardando ratificação')).toBe('awaiting_review');
  });
  test('awaiting_review: pronto para revisão / aguardando / NÃO ratificado (negação antes do positivo)', () => {
    expect(classifyCanonicalBacklogStatus('pronto para revisão')).toBe('awaiting_review');
    expect(classifyCanonicalBacklogStatus('aguardando ratificação')).toBe('awaiting_review');
    expect(classifyCanonicalBacklogStatus('ainda não ratificado')).toBe('awaiting_review');
  });
  test('not_started: não iniciado', () => {
    expect(classifyCanonicalBacklogStatus('não iniciado')).toBe('not_started');
  });
  test('unknown: sem linha de estado ou texto neutro', () => {
    expect(classifyCanonicalBacklogStatus(null)).toBe('unknown');
    expect(classifyCanonicalBacklogStatus('descrição sem estado')).toBe('unknown');
  });
  test('marcador MAIS CEDO vence: prosa que cita OUTRO item não confunde (regressão AUTO-05)', () => {
    // "ratificou" (do próprio item) vem ANTES de "não iniciada" (que se refere à Fase F).
    expect(classifyCanonicalBacklogStatus(
      'o usuário ratificou a capacidade X. Próxima fase elegível: Fase F, não iniciada.',
    )).toBe('done');
    // "não ratificado" cedo → awaiting, mesmo com "concluído" citado depois.
    expect(classifyCanonicalBacklogStatus(
      'ainda não ratificado; parte concluída em outro item.',
    )).toBe('awaiting_review');
  });
});

const DOC = `# Backlog

## ORQ — Fechar a orquestração atual

### ORQ-01 — Resultado e evidências visíveis

**Estado (2026-07-20):** aceito
- **Dependências:** F5 do Plano 001. **Escopo:** comprovação.

### ORQ-02 — Foco operacional real

- **Dependências:** ORQ-01; F7 do Plano 001.

## AUTO — Contrato

### AUTO-05 — Pausa e retomada

**Atualização (2026-07-28, ratificação e conclusão):** o usuário ratificou.
- **Dependências:** AUTO-03; AUTO-04.

### SUP-04 — Recuperação após interrupção

**Estado (pronto para revisão):** aguardando ratificação humana.
- **Dependências:** SUP-01, SUP-02.

### UX-09 — Item futuro

- **Dependências:** UX-09; SUP-04.
`;

describe('parseCanonicalBacklog', () => {
  const candidates = parseCanonicalBacklog({ document: 'doc.md', markdown: DOC });
  const byId = Object.fromEntries(candidates.map(c => [c.sourceId, c]));

  test('projeta um candidato por heading ### ID — Título, com id/título/linha', () => {
    expect(candidates.map(c => c.sourceId)).toEqual(['ORQ-01', 'ORQ-02', 'AUTO-05', 'SUP-04', 'UX-09']);
    expect(byId['ORQ-01']!.title).toBe('Resultado e evidências visíveis');
    expect(byId['ORQ-01']!.sourceRef.document).toBe('doc.md');
    expect(byId['ORQ-01']!.sourceRef.line).toBeGreaterThan(0);
    expect(byId['ORQ-01']!.sourceRef.heading).toContain('ORQ-01 —');
  });

  test('classifica o estado por palavra-chave (done/awaiting/unknown)', () => {
    expect(byId['ORQ-01']!.status).toBe('done');        // "aceito"
    expect(byId['AUTO-05']!.status).toBe('done');       // "ratificação e conclusão"
    expect(byId['SUP-04']!.status).toBe('awaiting_review'); // "aguardando ratificação"
    expect(byId['ORQ-02']!.status).toBe('unknown');     // sem linha de estado
    expect(byId['ORQ-01']!.statusEvidence).toBe('aceito');
  });

  test('extrai dependências (só IDs, self excluído)', () => {
    expect(byId['ORQ-02']!.dependencies).toEqual(['ORQ-01']);   // F7 (não-ID) ignorado
    expect(byId['AUTO-05']!.dependencies).toEqual(['AUTO-03', 'AUTO-04']);
    expect(byId['SUP-04']!.dependencies).toEqual(['SUP-01', 'SUP-02']);
    expect(byId['UX-09']!.dependencies).toEqual(['SUP-04']);     // self-dep UX-09 removido
  });

  test('estado/dependências NÃO vazam entre seções de itens', () => {
    // ORQ-02 não herda o "aceito" de ORQ-01 nem a linha de estado de AUTO-05.
    expect(byId['ORQ-02']!.statusEvidence).toBeNull();
  });

  test('ID duplicado → primeira ocorrência vence', () => {
    const dup = parseCanonicalBacklog({
      document: 'd.md',
      markdown: '### ORQ-01 — Primeiro\n\n**Estado:** aceito\n\n### ORQ-01 — Repetido em prosa\n\n**Estado:** não iniciado\n',
    });
    expect(dup).toHaveLength(1);
    expect(dup[0]!.title).toBe('Primeiro');
    expect(dup[0]!.status).toBe('done');
  });

  test('documento vazio / sem itens → lista vazia', () => {
    expect(parseCanonicalBacklog({ document: 'd.md', markdown: '# Só título\n\ntexto\n' })).toEqual([]);
  });
});

import {
  planCanonicalBacklogMaterialization,
  classifyCandidateForMaterialization,
  type CanonicalBacklogCandidate,
  type CanonicalBacklogStatus,
} from './canonical-backlog';

const cand = (
  sourceId: string,
  status: CanonicalBacklogStatus,
  dependencies: readonly string[] = [],
): CanonicalBacklogCandidate => ({
  sourceId, title: sourceId, status, statusEvidence: null, dependencies,
  sourceRef: { document: 'd.md', heading: sourceId, line: 1 },
});

describe('planCanonicalBacklogMaterialization (puro, conservador)', () => {
  test('not_started com todas as deps done → materialize (ordem canônica)', () => {
    const d = planCanonicalBacklogMaterialization({
      candidates: [cand('A-01', 'done'), cand('A-02', 'not_started', ['A-01'])],
    });
    expect(d).toEqual({ action: 'materialize', candidate: expect.objectContaining({ sourceId: 'A-02' }) });
  });

  test('item done NUNCA reaparece (settled)', () => {
    const d = planCanonicalBacklogMaterialization({ candidates: [cand('A-01', 'done'), cand('A-02', 'done')] });
    expect(d).toEqual({ action: 'none', reason: 'all_settled', pending: expect.objectContaining({ settled: 2, ready: 0 }) });
  });

  test('awaiting_review também é settled (não materializa)', () => {
    const d = planCanonicalBacklogMaterialization({ candidates: [cand('A-01', 'awaiting_review')] });
    expect(d.action).toBe('none');
  });

  test('dependência não resolvida NÃO materializa (blocked)', () => {
    const d = planCanonicalBacklogMaterialization({
      candidates: [cand('A-01', 'not_started'), cand('A-02', 'not_started', ['A-01'])],
    });
    // A-01 tem status not_started (não é dep de ninguém pendente) → A-01 é ready e escolhido;
    // mas A-02 depende de A-01 (not done) → blocked. Verificamos que A-01 (ready) é escolhido.
    expect(d).toEqual({ action: 'materialize', candidate: expect.objectContaining({ sourceId: 'A-01' }) });
  });

  test('item bloqueado NÃO congela um pronto POSTERIOR na ordem', () => {
    // B-01 bloqueado (dep unknown/ausente satisfeita? não); B-02 pronto (dep done).
    const d = planCanonicalBacklogMaterialization({
      candidates: [
        cand('DONE-00', 'done'),
        cand('B-01', 'not_started', ['MISSING-99']), // dep ausente → não done → blocked
        cand('B-02', 'not_started', ['DONE-00']),     // dep done → ready
      ],
    });
    expect(d).toEqual({ action: 'materialize', candidate: expect.objectContaining({ sourceId: 'B-02' }) });
  });

  test('item já ligado a work_item NÃO duplica', () => {
    const d = planCanonicalBacklogMaterialization({
      candidates: [cand('A-01', 'not_started')],
      materializedSourceIds: new Set(['A-01']),
    });
    expect(d).toEqual({ action: 'none', reason: 'all_settled', pending: expect.objectContaining({ alreadyMaterialized: 1, ready: 0 }) });
  });

  test('unknown NÃO materializa (poderia estar concluído) → status_unresolved', () => {
    const d = planCanonicalBacklogMaterialization({ candidates: [cand('A-01', 'unknown')] });
    expect(d).toEqual({ action: 'none', reason: 'status_unresolved', pending: expect.objectContaining({ statusUnknown: 1 }) });
  });

  test('só bloqueados → awaiting_dependencies (blocked tem precedência sobre unknown na razão)', () => {
    const d = planCanonicalBacklogMaterialization({
      candidates: [cand('A-01', 'not_started', ['X-99']), cand('A-02', 'unknown')],
    });
    expect(d).toEqual({ action: 'none', reason: 'awaiting_dependencies', pending: expect.objectContaining({ blocked: 1, statusUnknown: 1 }) });
  });

  test('sem candidatos → no_candidates', () => {
    expect(planCanonicalBacklogMaterialization({ candidates: [] })).toEqual({ action: 'none', reason: 'no_candidates', pending: expect.anything() });
  });

  test('FIFO/ordem canônica: o PRIMEIRO ready vence', () => {
    const d = planCanonicalBacklogMaterialization({
      candidates: [cand('A-01', 'not_started'), cand('A-02', 'not_started')],
    });
    expect(d).toEqual({ action: 'materialize', candidate: expect.objectContaining({ sourceId: 'A-01' }) });
  });

  test('classifyCandidateForMaterialization: casos', () => {
    const status = new Map<string, CanonicalBacklogStatus>([['D', 'done']]);
    expect(classifyCandidateForMaterialization(cand('X', 'done'), status, new Set())).toBe('settled');
    expect(classifyCandidateForMaterialization(cand('X', 'unknown'), status, new Set())).toBe('status_unknown');
    expect(classifyCandidateForMaterialization(cand('X', 'not_started', ['D']), status, new Set())).toBe('ready');
    expect(classifyCandidateForMaterialization(cand('X', 'not_started', ['E']), status, new Set())).toBe('dependency_unresolved');
    expect(classifyCandidateForMaterialization(cand('X', 'not_started'), status, new Set(['X']))).toBe('already_materialized');
  });
});
