import {
  deriveCapabilityAssessmentsFromWorkHistory,
  projectHostObservedCoderEvidence,
  projectHostObservedEvidence,
  projectHostObservedGateEvidence,
  projectVerifierOpinionHistory,
  type CapabilityAssessmentProjection,
  type WorkEvent,
} from '@anima/core';
import { mapWorkEvent } from '@anima/supabase';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 500;

/**
 * Os projectors usados pelo Proof Engine normalmente são tolerantes:
 * evidência persistida incoerente simplesmente não participa da projeção.
 *
 * Isso é adequado para presentation/read-models comuns, mas NÃO para esta
 * boundary epistemológica. Aqui um evento crítico inválido não pode virar
 * "ausência de evidência", porque isso pode preservar indevidamente uma prova
 * positiva anterior.
 */
function isSemanticallyValidEvidenceEvent(
  event: WorkEvent,
): boolean {
  switch (event.type) {
    case 'host_observed_evidence_recorded':
      return (
        projectHostObservedEvidence([event]) !==
        null
      );

    case 'host_observed_gate_evidence_recorded':
      return (
        projectHostObservedGateEvidence([event]) !==
        null
      );

    case 'host_observed_coder_evidence_recorded':
      return (
        projectHostObservedCoderEvidence([event]) !==
        null
      );

    case 'verifier_opinion_recorded':
      return (
        projectVerifierOpinionHistory([event])
          .length === 1
      );

    default:
      return true;
  }
}
export type CapabilityAssessmentReadResult =
  | {
      readonly ok: true;
      readonly projection: CapabilityAssessmentProjection;
      readonly eventCount: number;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'event_history_read_failed'
        | 'event_history_invalid';
    };

/**
 * Read-model server-side do Evolution.
 *
 * Regras:
 *
 * - usa o client autenticado recebido pelo caller;
 * - isolamento continua sendo responsabilidade do RLS;
 * - lê o histórico inteiro, paginado;
 * - usa o mapper canônico `mapWorkEvent`;
 * - row inválida falha fechado: não deriva maturidade de histórico parcial;
 * - nunca envia rows do banco ao cliente por esta primitive.
 */
export async function readCapabilityAssessments(
  client: SupabaseClient<Database>,
): Promise<CapabilityAssessmentReadResult> {
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
         * Eventos que carregam evidência usada pelo Capability Proof Engine
         * precisam sobreviver ao projector canônico do próprio contrato.
         *
         * Rejeição aqui é fatal para a leitura inteira: "evidência inválida"
         * nunca é reinterpretada como "evidência inexistente".
         */
        if (
          !isSemanticallyValidEvidenceEvent(
            event,
          )
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

  return {
    ok: true,
    projection:
      deriveCapabilityAssessmentsFromWorkHistory(events),
    eventCount: events.length,
  };
}