-- Fixtures locais idempotentes para packages/supabase/src/integration.test.ts.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('31000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','integration-a@test.invalid','',now(),'{}','{}',now(),now()),
  ('31000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','integration-b@test.invalid','',now(),'{}','{}',now(),now()),
  ('31000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','integration-off@test.invalid','',now(),'{}','{}',now(),now())
ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at;

DELETE FROM public.work_items
WHERE user_id IN (
  '31000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000002',
  '31000000-0000-0000-0000-000000000003'
);

INSERT INTO public.ai_conversations (id, user_id, role, content)
VALUES
  ('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','user','Pedido de integração A'),
  ('32000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000002','user','Pedido de integração B'),
  ('32000000-0000-0000-0000-000000000003','31000000-0000-0000-0000-000000000003','user','Pedido sem habilitação'),
  ('32000000-0000-0000-0000-000000000004','31000000-0000-0000-0000-000000000001','assistant','Mensagem inadequada')
ON CONFLICT (id) DO UPDATE SET content = excluded.content;

INSERT INTO private.work_orchestration_allowlist (user_id, enabled_by, reason)
VALUES
  ('31000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','teste de integração local'),
  ('31000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000002','teste de integração local')
ON CONFLICT (user_id) DO UPDATE SET reason = excluded.reason;

DELETE FROM private.work_orchestration_allowlist
WHERE user_id = '31000000-0000-0000-0000-000000000003';
