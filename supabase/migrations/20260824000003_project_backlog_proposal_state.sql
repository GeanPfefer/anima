CREATE OR REPLACE VIEW public.project_backlog_proposal_state WITH(security_invoker=true) AS
SELECT p.*, COALESCE((SELECT CASE e.event_type WHEN 'materialization_confirmed' THEN 'materialized' ELSE e.event_type::text END FROM public.project_backlog_events e WHERE e.proposal_id=p.id AND e.event_type IN ('changes_requested','materialization_confirmed') ORDER BY e.seq DESC LIMIT 1),'awaiting_confirmation') status
FROM public.project_backlog_proposals p;
