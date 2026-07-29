-- INTEL-02: decisão de roteamento append-only.
ALTER TYPE public.work_event_type
  ADD VALUE IF NOT EXISTS 'work_routing_decided';
