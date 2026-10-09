-- Synthetic isolated fixture; no production IDs or connections. Transaction rolled back.
begin;
create role anon;
create role authenticated;
create role service_role;
create role supabase_admin;
create schema extensions;
create extension pgcrypto with schema extensions;
create table public.staff_accounts(id uuid primary key, name text,username text,role text,status text,
 active boolean,is_active boolean,can_login boolean,branch text,permissions jsonb);
create table public.staff_login_sessions(staff_account_id uuid references public.staff_accounts(id),token_hash text,
 revoked_at timestamptz,expires_at timestamptz);
create table public.customers(id uuid primary key,customer_code text,effective_customer_code text,code text,
 name text,display_name text,customer_name text,branch text,effective_branch text,is_duplicate boolean,
 normalized_phone text,phone text,customer_phone text,mobile text,whatsapp_phone text,whatsapp text,phone_alt text);
create table public.whatsapp_review_sources(id uuid primary key,staff_id uuid,branch text,source_filename text,
 conversation_started_at timestamptz,conversation_ended_at timestamptz,raw_text text,customer_id uuid);
create table public.whatsapp_conversation_actions(
  id uuid primary key,
  source_id uuid references public.whatsapp_review_sources(id),
  action_key text,
  action_type text,
  followup_identity text unique,
  customer_id uuid,
  customer_code text,
  customer_name text,
  customer_phone text,
  staff_id uuid,
  product_id uuid,
  quantity numeric,
  confidence numeric,
  auto_eligible boolean,
  payload jsonb,
  evidence jsonb,
  updated_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  recovered_at timestamptz,
  recovered_invoice_value numeric,
  branch text,
  created_by text,
  last_error text,
  outcome text,
  outcome_note text,
  product_code text,
  product_name text,
  reason text,
  recovered_invoice_id text,
  recovered_invoice_number text,
  staff_name text,
  status text,
  target_id text,
  target_table text,
  work_status text, unique(source_id,action_key));
create table public.whatsapp_auto_followup_requests(id uuid primary key,followup_identity text unique,
 customer_id uuid,customer_code text,customer_name text,customer_phone text,customer_identity_status text,
 branch text,source_file_name text,conversation_session_id text,signal_type text,requested_product_name text,
 evidence_timestamp timestamptz,evidence_quote text,status text);
create table public.whatsapp_review_audit(id uuid default gen_random_uuid(),source_id uuid not null references public.whatsapp_review_sources(id),
 action text,actor_id text,actor_name text,actor_role text,before_state jsonb,after_state jsonb,note text);
-- Authorization dependencies are synthetic equivalents for the session/permission/branch cases.
create function public.get_user_permissions(p_id uuid) returns jsonb language sql as $$
 select permissions from public.staff_accounts where id=p_id $$;
create function public.dawaa_jsonb_has_true_any(p_permissions jsonb,p_keys text[]) returns boolean language sql as $$
 select coalesce(bool_or(p_permissions->>key='true'),false) from unnest(p_keys) key $$;
create function public.dawaa_can_read_conversation_review_row_v2(p_actor uuid,p_staff uuid,p_a uuid,p_branch text,p_b uuid)
 returns boolean language sql as $$ select exists(select 1 from public.staff_accounts a where a.id=p_actor and
 (a.role in ('admin','general_manager') or a.branch=p_branch)) $$;
create function public.dawaa_current_staff_account_id_strict() returns uuid language sql as $$
 select '00000000-0000-4000-8000-000000000001'::uuid $$;
