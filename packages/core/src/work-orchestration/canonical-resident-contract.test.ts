import {
  CANONICAL_RESIDENT_CONTRACT_IDS,
  canonicalResidentEventTypes,
  canonicalResidentWriteVersion,
  classifyCanonicalResidentEvent,
  guardCanonicalResidentWrite,
  isCanonicalResidentEventReadable,
  buildHostObservedCoderEvidence,
  buildHostObservedGateEvidence,
  buildHostObservedGitEvidence,
  type CanonicalResidentContractId,
  type HostObservedCoderEvidenceV1,
  type VerifierOpinionV1,
  type WorkEvent,
} from './index';

// Correlação compartilhada por todas as cargas canônicas.
const CORR = { workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 1 } as const;
const OBSERVED_AT = '2026-09-17T12:00:00.000Z';

function coderEvidence(): HostObservedCoderEvidenceV1 {
  const built = buildHostObservedCoderEvidence({
    ...CORR,
    backendId: 'ollama-coder',
    durationMs: 100,
    outcome: 'succeeded',
    observedAt: OBSERVED_AT,
    transcripts: [
      {
        schemaVersion: 1,
        call: 0,
        previousCall: null,
        gateFingerprint: null,
        diffFingerprint: null,
        termination: 'ollama_submit_gate_unsatisfied',
        truncated: false,
        entries: [],
        // Formato V3 já reconciliado: o reader atual sabe lê-lo, então passa.
        runtimeEvents: [
          {
            round: 1,
            kind: 'submit_blocked',
            result: 'blocked',
            state: 'dirty_unvalidated',
            editRevision: 1,
            passedValidationRevision: -1,
            diffReviewedRevision: -1,
            detail: '',
          },
        ],
      },
    ],
  });
  if (!built.ok) throw new Error(`fixture coder inválida: ${built.defect}`);
  return built.value;
}

function verifierOpinion(): VerifierOpinionV1 {
  // Espelha a forma persistida do parecer; construído à mão porque
  // computeVerifierOpinion exige item+eventos completos.
  return {
    schemaVersion: 1,
    ...CORR,
    approvedProposalVersion: 2,
    verifierVersion: 'work-verifier-v1',
    verdict: 'verified',
    restsOnAttestedEvidence: true,
    summary: { violations: 0, gaps: 0, checks: 1, attested: 1, independent: 0 },
    findings: [{ code: 'gates_passed', severity: 'ok', provenance: 'attested' }],
    evidenceBasis: {
      resultEventId: 'result-1',
      observedEventId: null,
      observedGateEventId: null,
      coverage: { git: false, gates: false },
    },
  } as unknown as VerifierOpinionV1;
}

describe('canonical resident contract registry', () => {
  test('enumera exatamente os 4 contratos persistíveis no estado residente', () => {
    expect([...CANONICAL_RESIDENT_CONTRACT_IDS].sort()).toEqual(
      ['host_observed_coder_evidence', 'host_observed_evidence', 'host_observed_gate_evidence', 'verifier_opinion'].sort(),
    );
    expect([...canonicalResidentEventTypes()].sort()).toEqual(
      [
        'host_observed_coder_evidence_recorded',
        'host_observed_evidence_recorded',
        'host_observed_gate_evidence_recorded',
        'verifier_opinion_recorded',
      ].sort(),
    );
  });
});

describe('guardCanonicalResidentWrite — read-your-writes fail-closed', () => {
  test('autoriza carga do coder que o reader atual reprojeta (inclui V3 reconciliado)', () => {
    expect(guardCanonicalResidentWrite('host_observed_coder_evidence', coderEvidence())).toEqual({ ok: true });
  });

  test('autoriza evidência de gate válida', () => {
    const built = buildHostObservedGateEvidence({
      ...CORR,
      gates: [{ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 10, timedOut: false, cancelled: false }],
      observedAt: OBSERVED_AT,
    });
    if (!built.ok) throw new Error('fixture gate inválida');
    expect(guardCanonicalResidentWrite('host_observed_gate_evidence', built.value)).toEqual({ ok: true });
  });

  test('autoriza evidência de git válida', () => {
    const built = buildHostObservedGitEvidence({
      ...CORR,
      baseSha: 'a'.repeat(40),
      observedCommitSha: 'b'.repeat(40),
      observedChangedFiles: ['src/x.ts'],
      observedDiffFiles: [{ path: 'src/x.ts', insertions: 1, deletions: 0 }],
      observedAt: OBSERVED_AT,
    });
    if (!built.ok) throw new Error('fixture git inválida');
    expect(guardCanonicalResidentWrite('host_observed_evidence', built.value)).toEqual({ ok: true });
  });

  test('autoriza parecer do Verifier válido', () => {
    expect(guardCanonicalResidentWrite('verifier_opinion', verifierOpinion())).toEqual({ ok: true });
  });

  test('recusa contrato canônico desconhecido (formato novo não registrado)', () => {
    const guard = guardCanonicalResidentWrite(
      'formato_futuro_nao_registrado' as CanonicalResidentContractId,
      coderEvidence(),
    );
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.reason).toBe('unknown_canonical_contract');
  });

  test('recusa carga cujo transcript carrega chave que o reader não conhece (mecanismo do 51929)', () => {
    const valid = coderEvidence();
    // Simula uma linha divergente que introduz um NOVO campo no transcript sem
    // reconciliar o reader: o projector canônico o rejeita, então a guarda fecha
    // ANTES de tocar o estado residente — o oposto de deixar o Evolution quebrar.
    const corrupted = {
      ...valid,
      transcripts: [{ ...(valid.transcripts![0]), chaveFutura: 'x' }],
    } as unknown as HostObservedCoderEvidenceV1;
    const guard = guardCanonicalResidentWrite('host_observed_coder_evidence', corrupted);
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.reason).toBe('unreadable_by_authoritative_reader');
  });
});

function coderEvent(opts: {
  readonly stamp?: { id: string; version: number };
  readonly malformedStamp?: unknown;
  readonly corrupt?: boolean;
}): WorkEvent {
  const ev = coderEvidence();
  const evidence = opts.corrupt
    ? ({ ...ev, transcripts: [{ ...(ev.transcripts![0]), chaveFutura: 'x' }] } as unknown as HostObservedCoderEvidenceV1)
    : ev;
  const payload: Record<string, unknown> = {
    schema_version: 1,
    data: {
      work_item_id: ev.workItemId,
      attempt_id: ev.attemptId,
      approved_proposal_version: ev.approvedProposalVersion,
      origin: 'host',
      evidence,
    },
  };
  if (opts.stamp !== undefined) payload.canonical_contract = opts.stamp;
  if (opts.malformedStamp !== undefined) payload.canonical_contract = opts.malformedStamp;
  return {
    id: 'e',
    workItemId: ev.workItemId,
    type: 'host_observed_coder_evidence_recorded',
    author: 'system',
    proposalVersion: ev.approvedProposalVersion,
    payload: payload as unknown as WorkEvent['payload'],
    occurredAt: new Date(0),
  };
}

describe('classifyCanonicalResidentEvent — distingue as 4 situações do 51929', () => {
  test('A: contrato + versão atuais (carimbado) → readable', () => {
    const c = classifyCanonicalResidentEvent(coderEvent({ stamp: { id: 'host_observed_coder_evidence', version: 1 } }));
    expect(c.kind).toBe('readable');
  });

  test('B/H: contrato conhecido + versão FUTURA → unsupported_contract_version, NUNCA invalid_payload', () => {
    const c = classifyCanonicalResidentEvent(coderEvent({ stamp: { id: 'host_observed_coder_evidence', version: 2 } }));
    expect(c.kind).toBe('unsupported_contract_version');
    expect(c.kind).not.toBe('invalid_payload');
  });

  test('C: contractId desconhecido → unsupported_contract', () => {
    const c = classifyCanonicalResidentEvent(coderEvent({ stamp: { id: 'formato_de_outra_linha', version: 1 } }));
    expect(c.kind).toBe('unsupported_contract');
  });

  test('D: contrato+versão suportados, payload corrompido → invalid_payload', () => {
    const c = classifyCanonicalResidentEvent(coderEvent({ stamp: { id: 'host_observed_coder_evidence', version: 1 }, corrupt: true }));
    expect(c.kind).toBe('invalid_payload');
  });

  test('E: evento legado SEM carimbo → readable (versão 1 inferida deterministicamente)', () => {
    const c = classifyCanonicalResidentEvent(coderEvent({}));
    expect(c.kind).toBe('readable');
    if (c.kind !== 'readable') return;
    expect(c.version).toBe(1);
  });

  test('carimbo malformado (versão < 1) → invalid_payload', () => {
    const c = classifyCanonicalResidentEvent(coderEvent({ malformedStamp: { id: 'host_observed_coder_evidence', version: 0 } }));
    expect(c.kind).toBe('invalid_payload');
  });

  test('G: a versão de escrita é a autoridade do registry (não arbitrária)', () => {
    expect(canonicalResidentWriteVersion('host_observed_coder_evidence')).toBe(1);
    // Um evento carimbado com a versão de escrita atual é sempre readable.
    const c = classifyCanonicalResidentEvent(
      coderEvent({ stamp: { id: 'host_observed_coder_evidence', version: canonicalResidentWriteVersion('host_observed_coder_evidence') } }),
    );
    expect(c.kind).toBe('readable');
  });
});

describe('isCanonicalResidentEventReadable — mesma régua da leitura', () => {
  test('evento fora do escopo canônico não é reinterpretado (retorna true)', () => {
    const event: WorkEvent = {
      id: 'e1',
      workItemId: 'work-1',
      type: 'work_proposed',
      author: 'system',
      proposalVersion: 1,
      payload: { schema_version: 1, data: {} } as unknown as WorkEvent['payload'],
      occurredAt: new Date(0),
    };
    expect(isCanonicalResidentEventReadable(event)).toBe(true);
  });

  test('evento canônico com envelope incoerente falha fechado', () => {
    const event: WorkEvent = {
      id: 'e2',
      workItemId: 'work-1',
      type: 'host_observed_coder_evidence_recorded',
      author: 'system',
      proposalVersion: 1,
      // Envelope declara uma tentativa diferente da carga: o projector rejeita.
      payload: {
        schema_version: 1,
        data: {
          work_item_id: 'work-1',
          attempt_id: 'attempt-divergente',
          approved_proposal_version: 1,
          origin: 'host',
          evidence: coderEvidence(),
        },
      } as unknown as WorkEvent['payload'],
      occurredAt: new Date(0),
    };
    expect(isCanonicalResidentEventReadable(event)).toBe(false);
  });
});
