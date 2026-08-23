import {
  parseCanonicalBacklog,
  classifyCanonicalBacklogStatus,
} from './canonical-backlog';

// Descoberta READ-ONLY do backlog canônico é PURA e determinística — provada por doubles
// de markdown (estrutura real do 002-backlog.md) sem tocar arquivo/rede/banco.

describe('classifyCanonicalBacklogStatus (puro)', () => {
  test('done: concluído / aceito / ratificado / implementado', () => {
    expect(classifyCanonicalBacklogStatus('concluído.')).toBe('done');
    expect(classifyCanonicalBacklogStatus('aceito')).toBe('done');
    expect(classifyCanonicalBacklogStatus('a revisão humana ratificou o item')).toBe('done');
    expect(classifyCanonicalBacklogStatus('implementado e provado')).toBe('done');
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
