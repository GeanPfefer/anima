import {
  buildHostObservedCoderEvidence,
  parseHostObservedCoderEvidence,
  projectHostObservedCoderEvidence,
  type HostObservedCoderEvidenceV1,
  type WorkEvent,
} from './index';
import type { Json } from '@anima/types';

const build = (over: Partial<Parameters<typeof buildHostObservedCoderEvidence>[0]> = {}) =>
  buildHostObservedCoderEvidence({
    workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
    backendId: 'ollama-coder', durationMs: 84_000, outcome: 'succeeded',
    observedAt: '2026-08-17T12:00:00.000Z', ...over,
  });

describe('buildHostObservedCoderEvidence', () => {
  test('aceita identidade de placement remoto observada pelo host', () => {
    expect(build({ placement: 'remote', nodeId: 'gpu-a', model: 'qwen3-coder:latest' })).toMatchObject({
      ok: true,
      value: { placement: 'remote', nodeId: 'gpu-a', model: 'qwen3-coder:latest' },
    });
  });

  test('recusa placement remoto sem node e identidade parcial', () => {
    expect(build({ placement: 'remote', nodeId: null, model: 'm' })).toMatchObject({ ok: false, defect: 'invalid_backend' });
    expect(build({ placement: 'local' })).toMatchObject({ ok: false, defect: 'invalid_backend' });
  });

  test('constrói evidência válida com a duração host-observed e o backendId', () => {
    const result = build();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      schemaVersion: 1, backendId: 'ollama-coder', durationMs: 84_000, outcome: 'succeeded',
    });
    // Identidade de placement e usage só aparecem quando suas proveniências são declaradas.
    expect(result.value).not.toHaveProperty('model');
    expect(result.value).not.toHaveProperty('tokens');
  });

  test('preserva usage provider-reported e recusa totais incoerentes', () => {
    expect(build({ providerUsage: { schemaVersion: 1, inputTokens: 10, outputTokens: 4, totalTokens: 14, cachedInputTokens: 2 } })).toMatchObject({ ok: true, value: { providerUsage: { totalTokens: 14 } } });
    expect(build({ providerUsage: { schemaVersion: 1, inputTokens: 10, outputTokens: 4, totalTokens: 99 } })).toMatchObject({ ok: false, defect: 'invalid_correlation' });
  });

  test('cancelled é um desfecho distinto (medição parcial), não colapsa em failed', () => {
    const cancelled = build({ outcome: 'cancelled', durationMs: 300 });
    expect(cancelled.ok && cancelled.value.outcome).toBe('cancelled');
    const failed = build({ outcome: 'failed' });
    expect(failed.ok && failed.value.outcome).toBe('failed');
  });

  test.each([
    ['correlação', { workItemId: '' }, 'invalid_correlation'],
    ['versão não positiva', { approvedProposalVersion: 0 }, 'invalid_correlation'],
    ['backendId em branco', { backendId: '  ' }, 'invalid_backend'],
    ['duração negativa', { durationMs: -1 }, 'invalid_duration'],
    ['duração não inteira', { durationMs: 12.5 }, 'invalid_duration'],
    ['desfecho fora do conjunto', { outcome: 'timeout' as unknown as 'failed' }, 'invalid_outcome'],
    ['timestamp inválido', { observedAt: 'ontem' }, 'invalid_timestamp'],
  ])('fail-closed: %s', (_label, over, defect) => {
    const result = build(over as Partial<Parameters<typeof buildHostObservedCoderEvidence>[0]>);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.defect).toBe(defect);
  });

  test('rejeita backendId com credencial ou caminho local (sensitive_data)', () => {
    expect(build({ backendId: 'C:/Users/segredo/coder' }).ok).toBe(false);
    expect(build({ backendId: 'coder --secret=abcdef' }).ok).toBe(false);
  });
});

describe('parseHostObservedCoderEvidence', () => {
  const serialized = (): Json => {
    const built = build();
    if (!built.ok) throw new Error('build falhou');
    return built.value as unknown as Json;
  };

  test('ida e volta', () => {
    const parsed = parseHostObservedCoderEvidence(serialized());
    expect(parsed).toMatchObject({ backendId: 'ollama-coder', durationMs: 84_000, outcome: 'succeeded' });
  });

  test.each([
    ['schemaVersion errado', (v: Record<string, Json>) => { v.schemaVersion = 2; }],
    ['duração negativa', (v: Record<string, Json>) => { v.durationMs = -5; }],
    ['desfecho inválido', (v: Record<string, Json>) => { v.outcome = 'aborted' as unknown as Json; }],
    ['backendId ausente', (v: Record<string, Json>) => { delete v.backendId; }],
  ])('fail-closed no persistido: %s ⇒ null', (_label, mutate) => {
    const raw = JSON.parse(JSON.stringify(serialized())) as Record<string, Json>;
    mutate(raw);
    expect(parseHostObservedCoderEvidence(raw as Json)).toBeNull();
  });
});

describe('projectHostObservedCoderEvidence', () => {
  const evidence = (over: Partial<Parameters<typeof build>[0]> = {}): HostObservedCoderEvidenceV1 => {
    const built = build(over);
    if (!built.ok) throw new Error('build falhou');
    return built.value;
  };
  const event = (ev: HostObservedCoderEvidenceV1, over: Record<string, Json> = {}): WorkEvent => ({
    id: 'ev', workItemId: 'work-1', type: 'host_observed_coder_evidence_recorded', author: 'system', proposalVersion: 2,
    payload: { schema_version: 1, data: { work_item_id: ev.workItemId, attempt_id: ev.attemptId, approved_proposal_version: ev.approvedProposalVersion, origin: 'host', evidence: ev as unknown as Json, ...over } } as unknown as Json,
    occurredAt: new Date('2026-08-17T00:00:00Z'),
  });

  test('reconstrói a última evidência do coder do log', () => {
    expect(projectHostObservedCoderEvidence([event(evidence())])?.backendId).toBe('ollama-coder');
  });
  test('a mais recente vence (histórico atravessa tentativas)', () => {
    const first = event(evidence({ attemptId: 'attempt-1' }));
    const second = event(evidence({ attemptId: 'attempt-2', backendId: 'gpt-coder' }));
    expect(projectHostObservedCoderEvidence([first, second])?.backendId).toBe('gpt-coder');
  });
  test('sem evento ⇒ null', () => {
    expect(projectHostObservedCoderEvidence([])).toBeNull();
  });
  test('envelope discordante da evidência ⇒ null', () => {
    expect(projectHostObservedCoderEvidence([event(evidence(), { attempt_id: 'outro' })])).toBeNull();
  });
});
