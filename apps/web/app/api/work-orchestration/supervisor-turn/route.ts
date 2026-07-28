import { createClient } from '@/lib/supabase/server';
import { localRunnerFromEnvironment } from '@/lib/work-orchestration/execution';
import { runSupervisorTurn } from '@/lib/work-orchestration/supervisor';

export const runtime = 'nodejs';
export const maxDuration = 1800;

// Ponto de entrada do laço mínimo do Supervisor V0: UMA volta por invocação.
// Não há daemon, agendador nem polling — a periodicidade, se um dia existir,
// pertence a quem chama. A autenticação real é obrigatória porque toda RPC do
// ciclo resolve `auth.uid()` e consulta a allowlist de orquestração.

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });

  // O laço supervisionado liga os checkpoints mid-flight (AUTO-05); o caminho
  // comandado (INT-04) não, mantendo-se single-shot.
  const adapter = localRunnerFromEnvironment({ emitCheckpoints: true });
  if (!adapter) {
    return Response.json({ ok: false, error: { code: 'local_runner_not_configured', message: 'Executor local não configurado.' } }, { status: 503 });
  }

  const result = await runSupervisorTurn({
    client, adapter,
    ownerInstanceId: process.env.ANIMA_SUPERVISOR_INSTANCE_ID ?? 'supervisor-v0',
    newId: () => crypto.randomUUID(),
    signal: request.signal,
  });

  // Toda volta que o laço conduziu até um desfecho conhecido responde 200 com o
  // desfecho tipado: perder a corrida do claim é resultado normal do supervisor,
  // não erro de transporte. Só a incerteza real — tentativa aberta sem terminal
  // confiável — sobe como 500, porque exige nova invocação para fechar.
  const incomplete = result.outcome === 'execution_interrupted' || result.outcome === 'terminal_refused';
  return Response.json({ ok: true, value: result }, { status: incomplete ? 500 : 200 });
}
