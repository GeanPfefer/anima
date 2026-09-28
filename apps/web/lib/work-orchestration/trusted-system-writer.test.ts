/** @jest-environment node */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { buildHostObservedGateEvidence, type HostObservedGateEvidenceV1, type IntegrationEffectAuthorizationV1, type IntegrationEffectReceiptV1, type VerifierOpinionV1 } from '@anima/core';
import { verifyAndReleaseCandidate } from './mandated-verification';
import {
  createTrustedSystemWriter,
  TRUSTED_SYSTEM_WRITER_UNAVAILABLE,
  trustedSystemWriterFromEnvironment,
  UNAVAILABLE_TRUSTED_SYSTEM_WRITER,
} from './trusted-system-writer';

// Credenciais FICTÍCIAS de teste (nunca reais); o teste só prova que elas não vazam.
const FAKE_PASSWORD = 'fake-writer-password-for-tests';
const FAKE_TOKEN = 'fake-writer-access-token';

function fakeClient() {
  const calls: { name: string; args: unknown }[] = [];
  const client = {
    rpc: jest.fn(async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: { action: 'recorded', event_seq: 1 }, error: null };
    }),
  };
  return { client, calls };
}

describe('Trusted System Writer V0 — porta única dos fatos de sistema', () => {
  test('sem configuração ⇒ writer indisponível; todo sink falha fechado (nunca cai para a sessão humana)', async () => {
    const writer = trustedSystemWriterFromEnvironment({} as unknown as NodeJS.ProcessEnv);
    expect(writer.available).toBe(false);
    await expect(writer.verifierOpinion.record({} as VerifierOpinionV1)).resolves.toEqual({ ok: false, message: TRUSTED_SYSTEM_WRITER_UNAVAILABLE });
    await expect(writer.gateEvidence.record({} as HostObservedGateEvidenceV1)).resolves.toEqual({ ok: false, message: TRUSTED_SYSTEM_WRITER_UNAVAILABLE });
    await expect(writer.integrationReceipt({} as IntegrationEffectAuthorizationV1, {} as IntegrationEffectReceiptV1)).rejects.toThrow(TRUSTED_SYSTEM_WRITER_UNAVAILABLE);
  });

  test('credencial pública (NEXT_PUBLIC) não conta; writer = residente é recusado', () => {
    const base = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' };
    expect(trustedSystemWriterFromEnvironment({ ...base, NEXT_PUBLIC_ANIMA_SYSTEM_WRITER_EMAIL: 'w@x', NEXT_PUBLIC_ANIMA_SYSTEM_WRITER_PASSWORD: FAKE_PASSWORD } as unknown as NodeJS.ProcessEnv).available).toBe(false);
    expect(trustedSystemWriterFromEnvironment({ ...base, ANIMA_SYSTEM_WRITER_EMAIL: 'same@x', ANIMA_SYSTEM_WRITER_PASSWORD: FAKE_PASSWORD, ANIMA_RESIDENT_EMAIL: 'SAME@x' } as unknown as NodeJS.ProcessEnv).available).toBe(false);
    expect(trustedSystemWriterFromEnvironment({ ...base, ANIMA_SYSTEM_WRITER_EMAIL: 'writer@x', ANIMA_SYSTEM_WRITER_PASSWORD: FAKE_PASSWORD, ANIMA_RESIDENT_EMAIL: 'resident@x' } as unknown as NodeJS.ProcessEnv).available).toBe(true);
  });

  test('cada sink usa um cliente do WRITER por operação; credencial nunca vai nos argumentos da RPC', async () => {
    const { client, calls } = fakeClient();
    const clientFor = jest.fn(() => client as never);
    const writer = createTrustedSystemWriter(async () => ({ accessToken: FAKE_TOKEN }), clientFor);
    const gate = buildHostObservedGateEvidence({
      workItemId: 'w', attemptId: 'a', approvedProposalVersion: 1,
      gates: [{ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 10, timedOut: false, cancelled: false }],
      observedAt: '2026-09-28T00:00:00.000Z',
    });
    if (!gate.ok) throw new Error(gate.explanation);
    await expect(writer.gateEvidence.record(gate.value)).resolves.toMatchObject({ ok: true });
    await writer.integrationReceipt(
      { workItemId: 'w', proposalVersion: 1, authorizationId: 'auth-1' } as IntegrationEffectAuthorizationV1,
      { kind: 'integration_effect' } as IntegrationEffectReceiptV1,
    );
    expect(clientFor).toHaveBeenCalledWith(FAKE_TOKEN);
    expect(calls.map((c) => c.name)).toEqual(['record_host_observed_gate_evidence', 'record_integration_completed']);
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain(FAKE_TOKEN);
    expect(serialized).not.toContain(FAKE_PASSWORD);
    // O writer não expõe cliente algum: só os cinco sinks.
    expect(Object.keys(writer).sort()).toEqual(['available', 'coderEvidence', 'gateEvidence', 'hostEvidence', 'integrationReceipt', 'verifierOpinion']);
  });

  test('identidade do writer falha ⇒ sink recusa, sem tentar outra identidade', async () => {
    const clientFor = jest.fn();
    const writer = createTrustedSystemWriter(async () => { throw new Error('gotrue down'); }, clientFor as never);
    await expect(writer.hostEvidence.record({} as never)).resolves.toEqual({ ok: false, message: TRUSTED_SYSTEM_WRITER_UNAVAILABLE });
    expect(clientFor).not.toHaveBeenCalled();
  });

  test('lane obrigatório sem writer ⇒ parecer não persiste ⇒ candidato RETIDO', async () => {
    const item = { id: 'w', state: 'in_progress', proposalVersion: 1, intent: { execution_spec: { verifier_requirement: 'required_fail_closed' } } };
    const outcome = await verifyAndReleaseCandidate('w', {
      getItem: async () => ({ ok: true, value: item as never }),
      listEvents: async () => ({ ok: true, value: [] }),
      sink: UNAVAILABLE_TRUSTED_SYSTEM_WRITER.verifierOpinion,
      computeAndPersist: async (_input, sink) => {
        const persisted = await sink.record({ verdict: 'verified' } as VerifierOpinionV1);
        return persisted.ok ? { ok: true, action: persisted.action, opinion: { verdict: 'verified' } as VerifierOpinionV1 } : { ok: false, stage: 'persist', reason: persisted.message };
      },
    });
    expect(outcome).toEqual({ status: 'held', reason: 'persist_failed', detail: TRUSTED_SYSTEM_WRITER_UNAVAILABLE });
  });
});

describe('Trusted System Writer V0 — nenhum vazamento de credencial / cliente privilegiado', () => {
  const webRoot = resolve(__dirname, '..', '..');
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (['node_modules', '.next', '_session'].includes(name)) return [];
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  const all = ['lib', 'app', 'cli', 'scripts', 'components'].flatMap((dir) => {
    try { return sources(join(webRoot, dir)); } catch { return []; }
  });

  test('credencial do writer nunca é NEXT_PUBLIC', () => {
    for (const file of all) expect(readFileSync(file, 'utf8')).not.toMatch(/NEXT_PUBLIC_ANIMA_SYSTEM_WRITER/);
  });

  test('nenhum componente client importa o writer; nenhuma rota o exporta', () => {
    for (const file of all) {
      const text = readFileSync(file, 'utf8');
      if (/^['"]use client['"]/m.test(text)) expect(text).not.toMatch(/trusted-system-writer/);
      if (/[\\/]app[\\/].*route\.ts$/.test(file)) expect(text).not.toMatch(/export\s+.*TrustedSystemWriter/);
    }
  });

  test('a credencial do writer só é lida em trusted-system-writer.ts (e no manifesto de recuperação)', () => {
    const readers = all
      .filter((file) => /ANIMA_SYSTEM_WRITER_PASSWORD/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(webRoot, file).replace(/\\/g, '/'))
      .sort();
    expect(readers).toEqual(['lib/recovery-config/manifest.ts', 'lib/work-orchestration/trusted-system-writer.ts']);
  });

  test('o módulo não faz log de credencial nem exporta o cliente', () => {
    const text = readFileSync(join(webRoot, 'lib/work-orchestration/trusted-system-writer.ts'), 'utf8');
    expect(text).not.toMatch(/console\./);
    expect(text).not.toMatch(/export\s+(const|function)\s+\w*[cC]lient/);
  });
});
