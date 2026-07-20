-- AUTO-02: vocabulário do claim exclusivo.
--
-- Isolado em migration própria porque um valor novo de enum só pode ser usado
-- depois de commitado. Claim não muda o estado do work item — por isso nenhum
-- destes eventos entra em private.work_state_transitions.

ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'work_claimed';
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'work_claim_released';
