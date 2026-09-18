import {
  classifyCanonicalResidentEvent,
  deriveCapabilityAssessmentsFromWorkHistory,
  type CapabilityAssessmentProjection,
  type WorkEvent,
} from '@anima/core';
import { mapWorkEvent } from '@anima/supabase';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 500;

/** Razões de falha do carregamento canônico do histórico — compartilhadas por
 * todos os read-models que consomem `work_events` (assessments, deficiências). */
export type CanonicalWorkHistoryFailure =
  | 'event_history_read_failed'
  // Payload realmente inválido/corrompido de um contrato conhecido, OU
  // envelope temporal inválido: o histórico não é confiável.
  | 'event_history_invalid'
  // Um evento canônico carrega um contrato/versão que ESTA linha não
  // reconhece (formato de uma linha divergente/mais nova). NÃO é corrupção:
  // é sinal de reconciliação de contrato. Distingui-lo evita derivar
  // assessment incorreto e evita alarmar "histórico corrompido".
  | 'canonical_contract_incompatibility';

export type CanonicalWorkHistoryResult =
  | { readonly ok: true; readonly events: readonly WorkEvent[] }
  | { readonly ok: false; readonly reason: CanonicalWorkHistoryFailure };

export type CapabilityAssessmentReadResult =
  | {
      readonly ok: true;
      readonly projection: CapabilityAssessmentProjection;
      readonly eventCount: number;
    }
  | {
      readonly ok: false;
      readonly reason: CanonicalWorkHistoryFailure;
    };

/**
 * Carregador CANÔNICO do histórico de `work_events` — a ÚNICA leitura confiável
 * de eventos, com as mesmas proteções do incidente 51929. Fonte única reutilizada
 * pelos read-models (Proof Engine e Self-Deficiency), para que ESCRITA e LEITURA
 * nunca divirjam por leitores separados.
 *
 * - usa o client autenticado recebido pelo caller (RLS user-scoped);
 * - lê o histórico inteiro, paginado, em ordem de `seq`;
 * - usa o mapper canônico `mapWorkEvent`;
 * - envelope temporal inválido / payload corrompido → fecha `event_history_invalid`;
 * - contrato/versão não reconhecidos → `canonical_contract_incompatibility`;
 * - row inválida NUNCA é pulada (poderia remover a evidência que muda a conclusão).
 */
export async function readCanonicalWorkHistory(
  client: SupabaseClient<Database>,
): Promise<CanonicalWorkHistoryResult> {
  const events: WorkEvent[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;

    const result = await client
      .from('work_events')
      .select('*')
      .order('seq', { ascending: true })
      .range(from, to);

    if (result.error || result.data === null) {
      return {
        ok: false,
        reason: 'event_history_read_failed',
      };
    }

    for (const row of result.data) {
      /**
       * `mapWorkEvent` é um mapper de representação, não uma boundary de
       * validação temporal. Um `new Date(valorInválido)` pode existir como
       * objeto Date sem lançar.
       *
       * Para o Proof Engine isso é crítico: alguns tipos de evidência carregam
       * também seu próprio `observedAt`. Se aceitássemos um envelope com
       * `created_at` inválido, poderíamos produzir maturidade a partir de um
       * evento cuja posição temporal canônica é desconhecida.
       */
      const persistedTimestamp =
        new Date(row.created_at).getTime();

      if (!Number.isFinite(persistedTimestamp)) {
        return {
          ok: false,
          reason: 'event_history_invalid',
        };
      }

      try {
        const event = mapWorkEvent(row);

        /**
         * Defesa redundante no boundary: mesmo que a implementação do mapper
         * mude, o read-model nunca entrega ao Proof Engine um WorkEvent sem
         * timestamp canônico válido.
         */
        if (
          !Number.isFinite(
            event.occurredAt.getTime(),
          )
        ) {
          return {
            ok: false,
            reason: 'event_history_invalid',
          };
        }

        /**
         * Eventos que carregam um contrato canônico precisam ser classificados
         * pela MESMA régua do core que o write-guard aplica — a única fonte da
         * verdade, o que impede escrita e leitura de divergirem numa linha.
         *
         * A classificação distingue as situações que o incidente 51929 confundia:
         * - readable / not_canonical → participa da projeção;
         * - unsupported_contract(_version) → contrato/versão de uma linha que esta
         *   não reconhece; é INCOMPATIBILIDADE (reconciliação), não corrupção, e
         *   fecha a leitura com um diagnóstico próprio em vez de derivar errado;
         * - invalid_payload → corrupção real de um contrato conhecido: fecha como
         *   histórico inválido (evidência inválida nunca vira "inexistente").
         */
        const classification =
          classifyCanonicalResidentEvent(event);

        if (
          classification.kind ===
            'unsupported_contract' ||
          classification.kind ===
            'unsupported_contract_version'
        ) {
          return {
            ok: false,
            reason:
              'canonical_contract_incompatibility',
          };
        }

        if (
          classification.kind ===
          'invalid_payload'
        ) {
          return {
            ok: false,
            reason: 'event_history_invalid',
          };
        }

        events.push(event);
      } catch {
        /**
         * Não pulamos linha inválida.
         *
         * Ignorá-la poderia remover justamente a evidência negativa ou a
         * observação que muda a maturidade derivada.
         */
        return {
          ok: false,
          reason: 'event_history_invalid',
        };
      }
    }

    if (result.data.length < PAGE_SIZE) {
      break;
    }
  }

  return { ok: true, events };
}

/**
 * Read-model server-side do Evolution. Deriva a maturidade das capacidades do
 * histórico canônico. Isolamento continua sendo responsabilidade do RLS; nunca
 * envia rows do banco ao cliente por esta primitive.
 */
export async function readCapabilityAssessments(
  client: SupabaseClient<Database>,
): Promise<CapabilityAssessmentReadResult> {
  const history = await readCanonicalWorkHistory(client);
  if (!history.ok) return { ok: false, reason: history.reason };

  return {
    ok: true,
    projection: deriveCapabilityAssessmentsFromWorkHistory(history.events),
    eventCount: history.events.length,
  };
}