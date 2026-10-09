-- STAGING BOOTSTRAP 40 — synthetic seed. Invented names, codes and phones only (the 0100000xxxx
-- range and SYN- codes); no real customer, invoice, staff or WhatsApp content. It deliberately
-- contains rows the two historical one-time UPDATEs would rewrite, so the bootstrap can prove they
-- never run again.
insert into public.staff_accounts (id, staff_id, username, name, role, branch, active, is_active, can_login, status, permissions) values
  ('00000000-0000-4000-8000-0000000000a1', 'SYN-S1', 'syn_agent_shokry', 'Synthetic Agent Shokry', 'customer_service', 'فرع شكري', true, true, true, 'active', '{}'),
  ('00000000-0000-4000-8000-0000000000a2', 'SYN-S2', 'syn_manager', 'Synthetic General Manager', 'general_manager', null, true, true, true, 'active', '{}'),
  ('00000000-0000-4000-8000-0000000000a3', 'SYN-S3', 'syn_agent_elshamy', 'Synthetic Agent Elshamy', 'customer_service', 'فرع الشامي', true, true, true, 'active', '{}'),
  ('00000000-0000-4000-8000-0000000000a4', 'SYN-S4', 'syn_inactive', 'Synthetic Inactive', 'branch_manager', 'فرع شكري', false, false, false, 'inactive', '{}');

insert into public.customers (id, customer_code, name, phone, mobile, branch) values
  ('00000000-0000-4000-8000-0000000000c1', 'SYN-C1', 'Synthetic Customer One', '01000000001', '01000000001', 'فرع شكري'),
  ('00000000-0000-4000-8000-0000000000c2', 'SYN-C2', 'Synthetic Customer Two', '01000000002', '01000000002', 'فرع الشامي');

insert into public.whatsapp_review_sources (id, staff_id, branch, source_filename, customer_id) values
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-0000000000a1', 'فرع شكري', 'synthetic-chat-1.txt', '00000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-0000000000a3', 'فرع الشامي', 'synthetic-chat-2.txt', '00000000-0000-4000-8000-0000000000c2');
insert into public.whatsapp_operational_canonical_sources_v1 (source_id) values
  ('00000000-0000-4000-8000-000000000051'), ('00000000-0000-4000-8000-000000000052');

-- Ready customer_request actions without a target: the 20261005141000 one-time UPDATE would demote them.
insert into public.whatsapp_conversation_actions
  (id, source_id, action_key, action_type, followup_identity, customer_id, customer_name, branch, status, auto_eligible, evidence, payload, updated_at, target_table, target_id)
values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000051', 'request:0:syn', 'customer_request', 'fu1|chat:syn01|2026-09-15T06:00:00.000Z|customer_request|syn', '00000000-0000-4000-8000-0000000000c1', 'Synthetic Customer One', 'فرع شكري', 'ready', true, '["m1"]', '{}', '2026-09-15T06:00:00Z', null, null),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-000000000052', 'request:0:syn2', 'customer_request', 'fu1|chat:syn02|2026-09-16T06:00:00.000Z|customer_request|syn2', '00000000-0000-4000-8000-0000000000c2', 'Synthetic Customer Two', 'فرع الشامي', 'ready', true, '["m2"]', '{}', '2026-09-16T06:00:00Z', null, null),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-000000000051', 'customer-followup', 'customer_followup', 'fu1|chat:syn01|2026-09-15T06:00:00.000Z|customer_followup|', '00000000-0000-4000-8000-0000000000c1', 'Synthetic Customer One', 'فرع شكري', 'created', false, '["m3"]', '{}', '2026-09-15T06:00:00Z', 'daily_followups', 'syn-f-conv');

insert into public.daily_followups (id, customer_id, customer_code, customer_name, name, customer_phone, phone, branch, status, request_type, identity_key, client_request_id, created_at)
values ('syn-f-conv', '00000000-0000-4000-8000-0000000000c1', 'SYN-C1', 'Synthetic Customer One', 'Synthetic Customer One', '01000000001', '01000000001',
        'فرع شكري', 'not_started', 'general', 'id:00000000-0000-4000-8000-0000000000c1', 'whatsapp-action:00000000-0000-4000-8000-0000000000e3', '2026-09-15T07:00:00Z');
insert into public.customer_service_followup_events (followup_id, event_type, event_status, metadata)
values ('syn-f-conv', 'created', 'open', '{"client_request_id":"whatsapp-action:00000000-0000-4000-8000-0000000000e3","request_type":"general"}');

-- Reviews: a legacy source review superseded by a current case review, and a case review whose case is
-- no longer current. The two 20261005133000 one-time UPDATEs would flip both is_current flags.
insert into public.sales_intelligence_cases (case_id, is_active) values ('syn-case-1', true), ('syn-case-2', false);
insert into public.sales_intelligence_current_case_analyses (case_id) values ('syn-case-1');
insert into public.conversation_sales_reviews (id, staff_name, customer_name, whatsapp_review_source_id, sales_intelligence_case_id, is_current, updated_at) values
  ('00000000-0000-4000-8000-0000000000d1', 'Synthetic Agent Shokry', 'Synthetic Customer One', '00000000-0000-4000-8000-000000000051', null, true, '2026-09-15T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000000d2', 'Synthetic Agent Shokry', 'Synthetic Customer One', '00000000-0000-4000-8000-000000000051', 'syn-case-1', true, '2026-09-15T08:00:00Z'),
  ('00000000-0000-4000-8000-0000000000d3', 'Synthetic Agent Elshamy', 'Synthetic Customer Two', '00000000-0000-4000-8000-000000000052', 'syn-case-2', true, '2026-09-16T08:00:00Z');
