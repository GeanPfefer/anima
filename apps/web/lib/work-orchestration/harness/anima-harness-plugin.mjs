// ============================================================
// Plugin cordis do DeepSeek Harness, carregado pelo host via `dsh --patch`.
//
// É a forma PÚBLICA (sem editar node_modules) de aplicar, dentro do processo
// filho do Harness, duas coisas que o host precisa e o profile não expõe por
// config estática:
//
//   1. temperature=0 (configurável) — intercepta o waterfall `agent/request` e
//      devolve a call-config com a temperature do host. O POC provou que
//      temperature=0 estabiliza o protocolo de tool calls (10/10 vs 8/10).
//
//   2. step budget — escuta o waterfall `agent/pre-step`; quando o passo prestes
//      a rodar ultrapassa o orçamento, chama `agent.cancel({ kind:"hook",
//      reason:"step-budget-exhausted:N" })` (o seam oficial; a causa fica durável
//      no `turn/end` como `aborted`/`reason.kind=hook`). Limita runaway
//      estruturalmente. O valor é configuração experimental, não política final.
//
// Autocontido de propósito: roda no processo do dsh (não no do Anima), então NÃO
// importa nada do @anima/core. A semântica canônica e os testes vivem em
// packages/core/.../harness-turn-lifecycle.ts; a régua de coerência do formato do
// motivo é reproduzida no teste do binding do host. NÃO decide sucesso: o host
// classifica sucesso pelos gates. Qualquer coisa fora disso é ignorada aqui.
// ============================================================

import { writeFileSync } from 'node:fs';

/** Nome estável do plugin cordis. */
export const name = 'anima-harness-budget';

/** Orçamento de passos padrão quando o host não passa um (o valor com que o POC
 * provou o mecanismo — NÃO ratificado). */
const DEFAULT_STEP_BUDGET = 12;

const resolveBudget = value =>
  Number.isInteger(value) && value >= 1 && value <= 200 ? value : DEFAULT_STEP_BUDGET;

/**
 * Monta o plugin no contexto do agente do Harness.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ stepBudget?: number, temperature?: number, marker?: string }} [config]
 */
export function apply(ctx, config) {
  const budget = resolveBudget(config && config.stepBudget);
  const temperature = config && typeof config.temperature === 'number' ? config.temperature : 0;

  // Marcador de saúde OPCIONAL: o host pode pedir uma prova durável de que o
  // plugin carregou (o binding usa isso para falhar fechado se o hook não montar).
  const marker = config && typeof config.marker === 'string' ? config.marker : '';
  if (marker) {
    try { writeFileSync(marker, `anima-harness-budget: budget=${budget} temperature=${temperature}\n`); } catch { /* diagnóstico best-effort */ }
  }

  // temperature host-controlada em cada requisição de modelo (waterfall).
  ctx.on('agent/request', async (_payload, next) => {
    const callConfig = await next();
    return { ...callConfig, temperature };
  });

  // Step budget: cancela o turno ao ultrapassar o orçamento, com causa observável.
  ctx.on('agent/pre-step', async (payload, next) => {
    if (payload.step > budget) {
      payload.agent.cancel({ kind: 'hook', reason: `step-budget-exhausted:${budget}` });
      return { kind: 'reject' };
    }
    return next();
  });
}
