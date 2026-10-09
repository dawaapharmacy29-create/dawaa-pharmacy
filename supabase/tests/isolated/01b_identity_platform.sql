-- Isolated rehearsal — identity layer as it is in production BEFORE 20261009080000 / 20261009081000.
-- Replaces the test.actor stub of 00_platform.sql with the real chain, copied verbatim from production on 2026-10-09:
--   dawaa_current_staff_account_id_strict → dawaa_request_staff_identifier (reads x-dawaa-user-id today).
-- Also verbatim: the 6 sibling header readers, record_conversation_review_points_v1 (md5 8d119972…) and
-- import_base44_purchase_invoices_v1 (md5 db806d85…) with its permission helpers.
-- The 52 functions that 20261009081000 binds are placeholders with the production signature, language and
-- argument names; each returns the p_actor_id it ends up using, so the binding can be observed.
-- Stubs (not production code): auth.uid(), record_employee_points_transaction_v4 (records the identity it sees),
-- match_base44_entered_by_v1 and dawaa_map_base44_branch_v1.
set client_min_messages = warning;
set check_function_bodies = off;

create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;

alter table public.staff_accounts
  add column is_active boolean, add column status text, add column username text, add column auth_user_id uuid,
  add column updated_at timestamptz, add column created_at timestamptz default now();
create table public.user_profiles (id uuid primary key default gen_random_uuid(), auth_user_id uuid, staff_account_id uuid, active boolean);
create table public.staff_login_sessions (
  id uuid primary key default gen_random_uuid(), staff_account_id uuid not null, token_hash text not null unique,
  expires_at timestamptz not null, revoked_at timestamptz, last_used_at timestamptz, created_at timestamptz default now()
);
create table public.conversation_sales_reviews (
  id uuid primary key, reviewer_id uuid, staff_id uuid, branch text, doctor_points_impact numeric, point_impact numeric,
  impact_status text, final_score numeric, total_score numeric, reviewer_notes text, training_recommendation text, month_cycle text
);
create table public.employee_points_test_log (id bigserial primary key, staff_id uuid, points numeric, status text,
  headers text, strict_account uuid, notification_account text);
create table public.assistant_operational_eligible_staff (staff_id uuid primary key);
create table public.base44_purchase_invoice_sync (
  base44_id text primary key, system_invoice_number text, supplier_invoice_number text, branch text, transaction_type text,
  entered_by_raw text, entered_by_staff_id uuid, match_status text, invoice_date date, total_value numeric, base44_status text,
  base44_supplier_id text, purchase_category text, source_branch text, destination_branch text, cash_amount numeric,
  payment_type text, notes text, transfer_authorization_number text, review_id uuid, synced_at timestamptz default now()
);
revoke all on public.staff_login_sessions, public.base44_purchase_invoice_sync, public.employee_points_test_log from anon, authenticated;

-- ---- verbatim production identity chain (pre-hardening) ----
CREATE OR REPLACE FUNCTION public.dawaa_request_staff_identifier()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select nullif(trim(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', '')), '');
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_request_staff_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when coalesce(current_setting('request.headers', true), '') = '' then null::uuid
    when ((current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      then (current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id')::uuid
    else null::uuid
  end;
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_current_staff_account_id_strict()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_catalog'
AS $function$
  with request_identity as (
    select public.dawaa_request_staff_identifier() as value
  )
  select coalesce(
    (
      select a.id
      from public.staff_accounts a
      where auth.uid() is not null
        and a.auth_user_id = auth.uid()
        and coalesce(a.active,false)
        and coalesce(a.can_login,false)
      limit 1
    ),
    (
      select a.id
      from public.user_profiles up
      join public.staff_accounts a on a.id = up.staff_account_id
      where auth.uid() is not null
        and up.auth_user_id = auth.uid()
        and coalesce(up.active,false)
        and coalesce(a.active,false)
        and coalesce(a.can_login,false)
      limit 1
    ),
    (
      select a.id
      from public.staff_accounts a, request_identity r
      where r.value is not null
        and coalesce(a.active,false)
        and coalesce(a.can_login,false)
        and (
          a.id::text = r.value
          or a.staff_id::text = r.value
          or lower(trim(coalesce(a.username,''))) = lower(r.value)
        )
      order by
        case
          when a.id::text = r.value then 1
          when a.staff_id::text = r.value then 2
          else 3
        end,
        coalesce(a.updated_at,a.created_at) desc nulls last
      limit 1
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_current_notification_account_id_v1()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_catalog'
AS $function$
  select coalesce(
    nullif(trim(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', '')), ''),
    nullif(auth.uid()::text, '')
  )
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_current_staff_id_v1()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select sa.staff_id::text
  from public.staff_accounts sa
  where sa.id::text = coalesce(
    nullif(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', ''),
    nullif(auth.uid()::text, '')
  )
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_has_active_app_session()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1
    from public.staff_accounts sa
    where sa.id::text = coalesce(
      nullif(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id',''),
      nullif(auth.uid()::text,'')
    )
      and coalesce(sa.active,true)=true
      and coalesce(sa.can_login,true)=true
  );
$function$;

CREATE OR REPLACE FUNCTION public.employee_operating_actor_id()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(
    nullif((nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-dawaa-user-id'), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_current_staff_subject_uuid_v1()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_account_id uuid;
  v_staff_id text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return null; end if;

  select nullif(trim(sa.staff_id), '')
    into v_staff_id
  from public.staff_accounts sa
  where sa.id = v_account_id
    and sa.active = true
    and sa.can_login = true;

  if v_staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return v_staff_id::uuid;
  end if;

  return v_account_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_is_customer_service_evaluator_v1(p_staff_id uuid, p_role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select p_role in ('customer_service_manager', 'general_manager', 'branches_manager')
    or exists (select 1 from public.assistant_operational_eligible_staff where staff_id = p_staff_id)
$function$;

-- ---- stubs for downstream dependencies (not production code) ----
create function public.match_base44_entered_by_v1(p_entered_by text) returns table(staff_id uuid, match_status text)
language sql stable as $$ select null::uuid, case when p_entered_by is null then 'empty' else 'unmatched' end $$;
create function public.dawaa_map_base44_branch_v1(p_branch text) returns text
language sql immutable as $$ select nullif(btrim(p_branch), '') $$;
-- Records the identity the downstream points writer would see after record_conversation_review_points_v1
-- rewrites request.headers.
create function public.record_employee_points_transaction_v4(
  p_staff_id uuid, p_points numeric, p_reason text, p_notes text, p_source text, p_source_id uuid, p_a text,
  p_month_cycle text, p_branch text, p_status text, p_b text, p_meta jsonb, p_c boolean)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_catalog' as $$
declare v_id bigint;
begin
  insert into public.employee_points_test_log(staff_id, points, status, headers, strict_account, notification_account)
  values (p_staff_id, p_points, p_status, current_setting('request.headers', true),
          public.dawaa_current_staff_account_id_strict(), public.dawaa_current_notification_account_id_v1())
  returning id into v_id;
  return jsonb_build_object('log_id', v_id, 'strict_account', public.dawaa_current_staff_account_id_strict());
end $$;
revoke all on function public.record_employee_points_transaction_v4(uuid,numeric,text,text,text,uuid,text,text,text,text,text,jsonb,boolean) from anon, authenticated, public;

-- ---- verbatim production: review points command and Base44 import ----
CREATE OR REPLACE FUNCTION public.record_conversation_review_points_v1(p_session_token text, p_review_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
declare
  v_account public.staff_accounts%rowtype;
  v_review public.conversation_sales_reviews%rowtype;
  v_points numeric; v_status text; v_actor_role text; v_actor_branch text;
  v_is_global boolean; v_is_branch_manager boolean; v_result jsonb;
begin
  if nullif(btrim(coalesce(p_session_token,'')),'') is null then raise exception 'staff_session_required' using errcode='42501'; end if;
  select a.* into v_account from public.staff_login_sessions s join public.staff_accounts a on a.id=s.staff_account_id
  where s.token_hash=encode(extensions.digest(btrim(p_session_token),'sha256'),'hex') and s.revoked_at is null and s.expires_at>now()
    and coalesce(a.active,true)=true and coalesce(a.is_active,true)=true and coalesce(a.can_login,true)=true and coalesce(a.status,'active')='active' limit 1;
  if not found then raise exception 'invalid_or_expired_staff_session' using errcode='42501'; end if;
  select * into v_review from public.conversation_sales_reviews where id=p_review_id for update;
  if not found then raise exception 'conversation_review_not_found' using errcode='P0002'; end if;
  if v_review.reviewer_id is null or (v_review.reviewer_id::text is distinct from v_account.id::text and v_review.reviewer_id::text is distinct from coalesce(v_account.staff_id::text,'')) then
    raise exception 'review_author_session_mismatch' using errcode='42501'; end if;
  if v_review.staff_id is null then raise exception 'conversation_review_staff_missing' using errcode='23514'; end if;
  v_actor_role:=lower(btrim(coalesce(v_account.role,''))); v_actor_branch:=nullif(btrim(coalesce(v_account.branch,'')),'');
  v_is_global:=v_actor_role in ('general_manager','admin','executive_manager','branches_manager','manager','مدير عام','مدير تنفيذي','مديرة الفروع','مدير الفروع');
  v_is_branch_manager:=v_actor_role in ('branch_manager','customer_service_manager','مدير فرع','مديرة فرع','مسؤولة خدمة العملاء','مسؤول خدمة العملاء');
  if not v_is_global and not v_is_branch_manager then null;
  elsif v_is_branch_manager and not v_is_global and coalesce(btrim(v_review.branch),'') is distinct from coalesce(v_actor_branch,'') then
    raise exception 'not_authorized_for_branch' using errcode='42501'; end if;
  v_points:=coalesce(v_review.doctor_points_impact,v_review.point_impact,0);
  if v_points=0 then return jsonb_build_object('review_id',v_review.id,'status','no_points','points_delta',0); end if;
  v_status:=case when lower(coalesce(v_review.impact_status,''))='approved' then 'approved' else 'pending' end;
  perform set_config('request.headers',jsonb_build_object('x-dawaa-user-id',v_account.id::text)::text,true);
  v_result:=public.record_employee_points_transaction_v4(v_review.staff_id,v_points,
    format('تقييم محادثة عميل - النتيجة %s/100',coalesce(v_review.final_score,v_review.total_score,0)),
    coalesce(nullif(btrim(coalesce(v_review.reviewer_notes,'')),''),nullif(btrim(coalesce(v_review.training_recommendation,'')),'')),
    'conversation_evaluation',v_review.id,null,v_review.month_cycle,v_review.branch,v_status,null,
    jsonb_build_object('source_module','conversation_evaluation','review_id',v_review.id,'reviewer_account_id',v_account.id,'session_command','record_conversation_review_points_v1'),false);
  update public.staff_login_sessions set last_used_at=now(),expires_at=now()+interval '12 hours'
   where staff_account_id=v_account.id and token_hash=encode(extensions.digest(btrim(p_session_token),'sha256'),'hex') and revoked_at is null;
  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object('review_id',v_review.id,'session_authorized',true);
end;$function$;

CREATE OR REPLACE FUNCTION public.import_base44_purchase_invoices_v1(p_records jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_account public.staff_accounts%rowtype;
  v_record jsonb;
  v_match record;
  v_matched int := 0;
  v_ambiguous int := 0;
  v_unmatched int := 0;
  v_empty int := 0;
  v_total int := 0;
begin
  select * into v_account
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception using errcode = '42501', message = 'active staff actor required'; end if;

  if not public.dawaa_is_customer_service_evaluator_v1(public.dawaa_current_staff_subject_uuid_v1(), lower(trim(coalesce(v_account.role, '')))) then
    raise exception using errcode = '42501', message = 'purchase invoice sync permission required';
  end if;

  for v_record in select * from jsonb_array_elements(coalesce(p_records, '[]'::jsonb))
  loop
    v_total := v_total + 1;
    select * into v_match from public.match_base44_entered_by_v1(nullif(trim(v_record ->> 'entered_by'), ''));

    insert into public.base44_purchase_invoice_sync (
      base44_id, system_invoice_number, supplier_invoice_number, branch, transaction_type,
      entered_by_raw, entered_by_staff_id, match_status, invoice_date, total_value, base44_status,
      base44_supplier_id, purchase_category, source_branch, destination_branch, cash_amount,
      payment_type, notes, transfer_authorization_number
    ) values (
      v_record ->> 'id',
      nullif(v_record ->> 'system_invoice_number', ''),
      nullif(v_record ->> 'supplier_invoice_number', ''),
      public.dawaa_map_base44_branch_v1(v_record ->> 'branch'),
      nullif(v_record ->> 'transaction_type', ''),
      nullif(trim(v_record ->> 'entered_by'), ''),
      v_match.staff_id,
      v_match.match_status,
      nullif(v_record ->> 'invoice_date', '')::date,
      nullif(v_record ->> 'total_value', '')::numeric,
      nullif(v_record ->> 'status', ''),
      nullif(v_record ->> 'supplier_id', ''),
      nullif(v_record ->> 'purchase_category', ''),
      public.dawaa_map_base44_branch_v1(v_record ->> 'source_branch'),
      public.dawaa_map_base44_branch_v1(v_record ->> 'destination_branch'),
      nullif(v_record ->> 'cash_amount', '')::numeric,
      nullif(v_record ->> 'payment_type', ''),
      nullif(v_record ->> 'notes', ''),
      nullif(v_record ->> 'transfer_authorization_number', '')
    )
    on conflict (base44_id) do update set
      system_invoice_number = excluded.system_invoice_number,
      supplier_invoice_number = excluded.supplier_invoice_number,
      branch = excluded.branch,
      transaction_type = excluded.transaction_type,
      entered_by_raw = excluded.entered_by_raw,
      entered_by_staff_id = case when public.base44_purchase_invoice_sync.review_id is null then excluded.entered_by_staff_id else public.base44_purchase_invoice_sync.entered_by_staff_id end,
      match_status = case when public.base44_purchase_invoice_sync.review_id is null then excluded.match_status else public.base44_purchase_invoice_sync.match_status end,
      invoice_date = excluded.invoice_date,
      total_value = excluded.total_value,
      base44_status = excluded.base44_status,
      base44_supplier_id = excluded.base44_supplier_id,
      purchase_category = excluded.purchase_category,
      source_branch = excluded.source_branch,
      destination_branch = excluded.destination_branch,
      cash_amount = excluded.cash_amount,
      payment_type = excluded.payment_type,
      notes = excluded.notes,
      transfer_authorization_number = excluded.transfer_authorization_number,
      synced_at = now();

    case v_match.match_status
      when 'matched' then v_matched := v_matched + 1;
      when 'ambiguous' then v_ambiguous := v_ambiguous + 1;
      when 'unmatched' then v_unmatched := v_unmatched + 1;
      else v_empty := v_empty + 1;
    end case;
  end loop;

  return jsonb_build_object(
    'total', v_total, 'matched', v_matched, 'ambiguous', v_ambiguous,
    'unmatched', v_unmatched, 'empty', v_empty
  );
end;
$function$;

-- ---- the 52 functions bound by 20261009081000 (production signature, language and argument names) ----
create function public.app_actor_is_team_dawaa(p_actor_id text) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$ select to_jsonb(p_actor_id) $$;
create function public.app_role_allowed(p_actor_id text, p_allowed text[]) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$ select to_jsonb(p_actor_id) $$;
create function public.app_staff_role(p_actor_id text) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$ select to_jsonb(p_actor_id) $$;
create function public.calculate_customer_loyalty_cycle(p_setting_id uuid, p_period_start date, p_period_end date, p_manual_purchase_total numeric, p_actor_id text, p_actor_name text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.calculate_customer_loyalty_cycle_internal_v1(p_setting_id uuid, p_period_start date, p_period_end date, p_manual_purchase_total numeric, p_actor_id text, p_actor_name text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.customer_followup_performance_v1(p_actor_id text, p_branch text, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.dawaa_assert_customer_intelligence_branch_v2(p_branch text, p_actor_id uuid) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.dawaa_can_access_customer_intelligence_branch_v2(p_branch text, p_actor_id uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$ select to_jsonb(p_actor_id) $$;
create function public.dawaa_can_access_review_coverage_branch_v1(p_actor_id uuid, p_branch text, p_write boolean) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.dawaa_can_manage_branch_targets(p_actor_id uuid) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.dawaa_can_manage_customer_intelligence_v2(p_actor_id uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$ select to_jsonb(p_actor_id) $$;
create function public.dawaa_cancel_customer_followup_v1(p_followup_id text, p_reason text, p_actor_id text, p_actor_name text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.dawaa_complete_customer_followup_v1(p_followup_id text, p_result text, p_summary text, p_score numeric, p_notes text, p_actor_id text, p_actor_name text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.dawaa_customer_request_permission_allowed(p_actor_id uuid, p_permission text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.dawaa_customer_service_queue_scope_v3(p_actor_id uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$ select to_jsonb(p_actor_id) $$;
create function public.dawaa_log_customer_followup_event_v1(p_followup_id text, p_event_type text, p_old_status text, p_new_status text, p_event_note text, p_event_payload jsonb, p_actor_id text, p_actor_name text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.dawaa_shortage_permission_allowed_v1(p_actor_id uuid, p_permission text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.fetch_customer_welcome_message_logs(p_actor_id text, p_customer_code text, p_customer_phone text, p_customer_id text, p_search text, p_branch text, p_status text, p_doctor text, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.get_customer_followup_records_v1(p_actor_id text, p_branch text, p_mode text, p_search text, p_from date, p_to date, p_limit integer, p_offset integer) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.get_customer_points_daily20_v2(p_date date, p_actor_id uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$ select to_jsonb(p_actor_id) $$;
create function public.get_customer_service_at_risk_completion_v1(p_date date, p_actor_id uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$ select to_jsonb(p_actor_id) $$;
create function public.get_customer_service_at_risk_daily_v2(p_date date, p_actor_id uuid) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.get_customer_service_cycle_cohorts(p_branch text, p_as_of_date date, p_cycles integer, p_actor_id uuid) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.get_customer_service_daily_queue_completion_v1(p_date date, p_actor_id uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$ select to_jsonb(p_actor_id) $$;
create function public.get_customer_service_daily_vip7_v2(p_date date, p_actor_id uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$ select to_jsonb(p_actor_id) $$;
create function public.get_customer_service_first_purchase_save_v2(p_date date, p_actor_id uuid) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.get_customer_service_plus500_v2(p_date date, p_actor_id uuid) returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog' as $$ select to_jsonb(p_actor_id) $$;
create function public.get_customer_service_recent_top50_v2(p_days integer, p_actor_id uuid) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.get_customer_service_three_cycle_intelligence_v1(p_as_of date, p_actor_id uuid) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.get_customer_service_watchlist_performance(p_branch text, p_as_of_date date, p_cycles integer, p_actor_id uuid) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.get_weekly_manager_metrics_cached_v1(p_actor_id uuid, p_evaluation_type text, p_branch text, p_week_start date, p_week_end date) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.get_weekly_manager_metrics_fast_v1(p_actor_id uuid, p_evaluation_type text, p_branch text, p_week_start date, p_week_end date, p_max_age_seconds integer) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.import_customer_followup_results_legacy_v1(p_actor_id uuid, p_branch text, p_file_name text, p_rows jsonb) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.import_customer_followup_results_v1(p_actor_id uuid, p_branch text, p_file_name text, p_rows jsonb) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.import_customer_service_queue_results_legacy_v4(p_actor_id uuid, p_branch text, p_file_name text, p_rows jsonb) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.import_customer_service_queue_results_v2(p_actor_id uuid, p_branch text, p_file_name text, p_rows jsonb) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.import_customer_service_queue_results_v3(p_actor_id uuid, p_branch text, p_file_name text, p_rows jsonb) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.import_customer_service_queue_results_v4(p_actor_id uuid, p_branch text, p_file_name text, p_rows jsonb) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.list_weekly_manager_evaluation_subjects_v1(p_actor_id uuid, p_evaluation_type text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.mark_customer_points_contacted_v2(p_branch text, p_customer_code text, p_actor_name text, p_actor_id uuid) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.review_customer_loyalty_approval(p_request_id uuid, p_decision text, p_review_notes text, p_actor_id text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.review_customer_loyalty_approval_internal_v1(p_request_id uuid, p_decision text, p_review_notes text, p_actor_id text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.run_due_customer_loyalty_cycles(p_actor_id text, p_actor_name text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.run_due_customer_loyalty_cycles_internal_v1(p_actor_id text, p_actor_name text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.save_branch_sales_target_v2(p_actor_id uuid, p_branch text, p_target numeric) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.save_quick_reply_script(p_id uuid, p_shortcut text, p_title text, p_category text, p_script_type text, p_doctor_name text, p_branch text, p_message_body text, p_questions jsonb, p_suggested_products jsonb, p_tags jsonb, p_active boolean, p_actor_id text, p_actor_name text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.save_staff_monthly_evaluation_safe(p_actor_id uuid, p_payload jsonb) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.set_branch_daily_task_status(p_task_id uuid, p_status text, p_actor_id uuid, p_actor_name text, p_note text, p_evidence_url text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.set_branch_sales_target(p_branch_name text, p_target_amount numeric, p_actor_id uuid) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.submit_customer_loyalty_approval(p_setting_id uuid, p_period_start date, p_period_end date, p_manual_purchase_total numeric, p_request_notes text, p_actor_id text, p_actor_name text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.submit_customer_loyalty_approval_internal_v1(p_setting_id uuid, p_period_start date, p_period_end date, p_manual_purchase_total numeric, p_request_notes text, p_actor_id text, p_actor_name text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
create function public.update_customer_welcome_message_status(p_id uuid, p_status text, p_actor_id text, p_actor_name text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog' as $$ begin return to_jsonb(p_actor_id); end $$;
