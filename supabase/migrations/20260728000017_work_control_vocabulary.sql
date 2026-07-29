-- UX-01 — pedidos persistidos de pausa/cancelamento e pausa aplicada.
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'work_control_requested';
ALTER TYPE public.work_event_type ADD VALUE IF NOT EXISTS 'work_paused';
