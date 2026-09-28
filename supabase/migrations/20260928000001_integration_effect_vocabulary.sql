-- Completed → Integrated V0 (2026-09-28): vocabulário da integração canônica em dev.
--
-- `integration_effect_authorized` (author=user): autorização humana ESPECÍFICA de UM
-- efeito Git (merge --no-ff do commit exato do resultado aceito em refs/heads/dev,
-- sobre um SHA-alvo esperado congelado). NÃO é `integration_decided` (V1: decisão
-- genérica que alimenta branch publication / PR) — são autorizações distintas.
--
-- `integration_completed` (author=system): receipt do efeito Git OBSERVADO. Não muda
-- `work_items.state` (continua `completed`); `integrated` é projeção do evento.
--
-- Migração separada: `ALTER TYPE ... ADD VALUE` não pode ser usado na mesma transação.
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'integration_effect_authorized';
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'integration_completed';
