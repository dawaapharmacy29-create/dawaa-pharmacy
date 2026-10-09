-- Synthetic isolated fixture for native PostgreSQL. No production IDs, data or connections.
-- Loaded into a throwaway database by scripts/test-followup-branch-provenance-db.mjs.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end;
$roles$;

create extension if not exists pgcrypto;
grant usage on schema public to anon, authenticated, service_role;

create table public.staff_accounts(
  id uuid primary key, staff_id text, name text, staff_name text, username text,
  role text, branch text, active boolean, can_login boolean);

create table public.customers(
  id uuid primary key, name text, customer_code text, phone text, mobile text, branch text);

create table public.customer_metrics_summary(customer_code text, branch text, last_purchase timestamptz);

create table public.daily_followups(
  id text primary key,
  customer_id text, customer_code text, customer_name text, name text,
  customer_phone text, phone text, branch text,
  status text, followup_status text, request_type text, identity_key text,
  client_request_id text unique,
  is_hidden boolean default false, is_duplicate boolean default false,
  duplicate_of text, canonical_followup_id text,
  hidden_at timestamptz, hidden_by text, hidden_reason text,
  archived_at timestamptz, archive_reason text,
  completed_at timestamptz, cancelled_at timestamptz,
  attempt_count integer, last_attempt_at timestamptz, contacted_at timestamptz,
  customer_metrics jsonb, data_quality_status text, data_issues text[],
  created_at timestamptz default now(), updated_at timestamptz, updated_by text);

create table public.customer_service_daily_queue_items(
  id text primary key, customer_id text, customer_code text, customer_phone text, branch text,
  linked_followup_id text, queue_date date, status text, completed_at timestamptz,
  updated_at timestamptz, metadata jsonb);

create table public.customer_service_followup_events(
  id uuid primary key default gen_random_uuid(), followup_id text, event_type text, event_status text,
  actor_staff_id text, actor_name text, notes text, metadata jsonb, created_at timestamptz default now());

create table public.customer_followup_audit_log(
  id uuid primary key default gen_random_uuid(), followup_id text, customer_id text, action text,
  actor_staff_id text, actor_name text, branch text, metadata jsonb, created_at timestamptz default now());

create table public.customer_branch_overrides(
  id uuid primary key default gen_random_uuid(), customer_code text, customer_id text, customer_phone text,
  customer_name text, old_branch text, new_branch text, suggested_branch text, reason text,
  created_by text, created_by_name text, active boolean, created_at timestamptz default now());

create table public.whatsapp_review_sources(id uuid primary key, branch text, customer_id uuid);

create table public.whatsapp_conversation_actions(
  id uuid primary key, source_id uuid, action_key text, action_type text,
  followup_identity text unique, customer_id uuid, branch text,
  target_table text, target_id text, evidence jsonb, payload jsonb, status text,
  recovered_invoice_id text, recovered_invoice_value numeric, recovered_at timestamptz,
  unique(source_id, action_key));

-- RLS on, no client policies: a security-invoker lineage read by a client would see nothing.
alter table public.whatsapp_conversation_actions enable row level security;
alter table public.whatsapp_review_sources enable row level security;
alter table public.customer_service_followup_events enable row level security;

-- Supabase gives service_role full table privileges (and BYPASSRLS); clients get none here.
grant all on all tables in schema public to service_role;
alter role service_role bypassrls;

-- Synthetic auth: the current staff account comes from a session setting.
create function public.dawaa_current_staff_account_id_strict() returns uuid
language sql stable as $$ select nullif(current_setting('dawaa.test_actor', true), '')::uuid $$;
grant execute on function public.dawaa_current_staff_account_id_strict() to anon, authenticated, service_role;

create function public.resolve_staff_account_safe(p_actor text)
returns table(id uuid, active boolean, can_login boolean, role text)
language sql stable as $$
  select a.id, a.active, a.can_login, a.role from public.staff_accounts a where a.id::text = p_actor $$;

-- Seed. Branch keys: 'فرع شكري' -> shokry, 'فرع الشامي' -> elshamy.
insert into public.staff_accounts values
 ('00000000-0000-4000-8000-0000000000a1','S-A1','مدير شكري',null,'mgr_shokry','branch_manager','فرع شكري',true,true),
 ('00000000-0000-4000-8000-0000000000a2','S-A2','مدير عام',null,'gm','general_manager',null,true,true),
 ('00000000-0000-4000-8000-0000000000a3','S-A3','خدمة الشامي',null,'cs_elshamy','customer_service','فرع الشامي',true,true),
 ('00000000-0000-4000-8000-0000000000a4','S-A4','سائق',null,'driver','driver','فرع شكري',true,true),
 ('00000000-0000-4000-8000-0000000000a5','S-A5','موقوف',null,'inactive','branch_manager','فرع شكري',false,false);

insert into public.customers values
 ('00000000-0000-4000-8000-0000000000c1','عميل واحد','C001','01011111111','01011111111','فرع شكري'),
 ('00000000-0000-4000-8000-0000000000c2','عميل اثنين','C002','01022222222','01022222222','فرع شكري');

insert into public.whatsapp_review_sources values
 ('00000000-0000-4000-8000-000000000051','فرع شكري','00000000-0000-4000-8000-0000000000c1'),
 ('00000000-0000-4000-8000-000000000052','فرع الشامي','00000000-0000-4000-8000-0000000000c1'),
 ('00000000-0000-4000-8000-000000000053','فرع شكري','00000000-0000-4000-8000-0000000000c2');

insert into public.whatsapp_conversation_actions
 (id,source_id,action_key,action_type,followup_identity,customer_id,branch,target_table,target_id,evidence,payload,status,recovered_invoice_id,recovered_invoice_value,recovered_at)
values
 ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-000000000051','customer-followup','customer_followup','fu1|chat:aa01|2026-09-15T06:00:00.000Z|customer_followup|','00000000-0000-4000-8000-0000000000c1','فرع شكري','daily_followups','f-conv','["m1"]','{"saleProof":"invoice_verified"}','materialized','INV-1',120,'2026-09-16T10:00:00Z'),
 ('00000000-0000-4000-8000-0000000000e2','00000000-0000-4000-8000-000000000051','request:0:x','customer_request','fu1|chat:aa01|2026-09-15T06:00:00.000Z|customer_request|x','00000000-0000-4000-8000-0000000000c1','فرع شكري',null,null,'["m2"]','{}','ready',null,null,null),
 ('00000000-0000-4000-8000-0000000000e3','00000000-0000-4000-8000-000000000052','complaint-followup','complaint_followup','fu1|chat:bb02|2026-09-17T08:00:00.000Z|complaint_followup|','00000000-0000-4000-8000-0000000000c1','فرع الشامي',null,null,'["m3"]','{}','ready',null,null,null),
 ('00000000-0000-4000-8000-0000000000e4','00000000-0000-4000-8000-000000000051','recommendation-followup:0:y','recommendation_followup','fu1|chat:aa01|2026-09-15T06:00:00.000Z|recommendation_followup|y','00000000-0000-4000-8000-0000000000c1','فرع شكري','daily_followups','f-ambig','["m4"]','{}','materialized',null,null,null),
 ('00000000-0000-4000-8000-0000000000e5','00000000-0000-4000-8000-000000000099','customer-followup','customer_followup','fu1|chat:zz99|2026-09-18T08:00:00.000Z|customer_followup|',null,'فرع شكري','daily_followups','f-orphan','["m5"]','{}','materialized',null,null,null),
 ('00000000-0000-4000-8000-0000000000e6','00000000-0000-4000-8000-000000000051','customer-followup:c2','customer_followup','fu1|chat:cc03|2026-09-19T08:00:00.000Z|customer_followup|','00000000-0000-4000-8000-0000000000c2','فرع شكري','daily_followups','g-conv1','["m6"]','{}','materialized',null,null,null),
 ('00000000-0000-4000-8000-0000000000e7','00000000-0000-4000-8000-000000000053','customer-followup','customer_followup','fu1|chat:dd04|2026-09-20T08:00:00.000Z|customer_followup|','00000000-0000-4000-8000-0000000000c2','فرع شكري','daily_followups','g-conv2','["m7"]','{}','materialized',null,null,null),
 ('00000000-0000-4000-8000-0000000000e8','00000000-0000-4000-8000-000000000052','customer-followup:c2','customer_followup','fu1|chat:ee05|2026-09-21T08:00:00.000Z|customer_followup|','00000000-0000-4000-8000-0000000000c2','فرع الشامي','daily_followups','g-conv3','["m8"]','{}','materialized',null,null,null);

insert into public.daily_followups(id,customer_id,customer_code,customer_name,name,customer_phone,phone,branch,status,request_type,identity_key,client_request_id,attempt_count,created_at)
values
 ('f-conv','00000000-0000-4000-8000-0000000000c1','C001','عميل واحد','عميل واحد','01011111111','01011111111','فرع شكري','not_started','general','phone:01011111111','whatsapp-action:00000000-0000-4000-8000-0000000000e1',0,'2026-09-15T07:00:00Z'),
 ('f-key','00000000-0000-4000-8000-0000000000c1','C001','عميل واحد','عميل واحد','01011111111','01011111111','فرع شكري','not_started','customer_request','phone:01011111111','whatsapp-action:00000000-0000-4000-8000-0000000000e2',0,'2026-09-15T07:01:00Z'),
 ('f-event','00000000-0000-4000-8000-0000000000c1','C001','عميل واحد','عميل واحد','01011111111','01011111111','فرع الشامي','not_started','complaint','phone:01011111111','manual:f-event',0,'2026-09-17T09:00:00Z'),
 ('f-ambig','00000000-0000-4000-8000-0000000000c1','C001','عميل واحد','عميل واحد','01011111111','01011111111','فرع شكري','not_started','recommendation','phone:01011111111','manual:f-ambig',0,'2026-09-15T07:02:00Z'),
 ('f-manual','00000000-0000-4000-8000-0000000000c1','C001','عميل واحد','عميل واحد','01011111111','01011111111','فرع شكري','not_started','general','phone:01011111111','manual:f-manual',3,'2026-09-10T07:00:00Z'),
 ('f-manual-dup','00000000-0000-4000-8000-0000000000c1','C001','عميل واحد','عميل واحد','01011111111','01011111111','فرع شكري','not_started','general','phone:01011111111','manual:f-manual-dup',0,'2026-09-11T07:00:00Z'),
 ('f-orphan','00000000-0000-4000-8000-0000000000c1','C001','عميل واحد','عميل واحد','01011111111','01011111111','فرع شكري','not_started','general','phone:01011111111','manual:f-orphan',0,'2026-09-12T07:00:00Z'),
 ('g-conv1','00000000-0000-4000-8000-0000000000c2','C002','عميل اثنين','عميل اثنين','01022222222','01022222222','فرع شكري','not_started','general','phone:01022222222','manual:g-conv1',0,'2026-09-19T09:00:00Z'),
 ('g-conv2','00000000-0000-4000-8000-0000000000c2','C002','عميل اثنين','عميل اثنين','01022222222','01022222222','فرع شكري','not_started','general','phone:01022222222','manual:g-conv2',0,'2026-09-20T09:00:00Z'),
 ('g-conv3','00000000-0000-4000-8000-0000000000c2','C002','عميل اثنين','عميل اثنين','01022222222','01022222222','فرع الشامي','not_started','general','phone:01022222222','manual:g-conv3',0,'2026-09-21T09:00:00Z'),
 ('g-manual','00000000-0000-4000-8000-0000000000c2','C002','عميل اثنين','عميل اثنين','01022222222','01022222222','فرع شكري','not_started','general','phone:01022222222','manual:g-manual',0,'2026-09-01T09:00:00Z');

insert into public.customer_service_followup_events(followup_id,event_type,event_status,metadata) values
 ('f-event','request_linked','open','{"client_request_id":"whatsapp-action:00000000-0000-4000-8000-0000000000e3"}'),
 ('f-ambig','request_linked','open','{"client_request_id":"whatsapp-action:00000000-0000-4000-8000-0000000000e3"}');

insert into public.customer_service_daily_queue_items(id,customer_id,customer_code,customer_phone,branch,linked_followup_id,queue_date,status,metadata) values
 ('q-conv','00000000-0000-4000-8000-0000000000c1','C001','01011111111','فرع شكري','f-conv',(now() at time zone 'Africa/Cairo')::date,'open','{"original":true}'),
 ('q-manual','00000000-0000-4000-8000-0000000000c1','C001','01011111111','فرع شكري','f-manual',(now() at time zone 'Africa/Cairo')::date,'open','{}'),
 ('q-unlinked','00000000-0000-4000-8000-0000000000c1','C001','01011111111','فرع شكري',null,(now() at time zone 'Africa/Cairo')::date,'open','{}');
