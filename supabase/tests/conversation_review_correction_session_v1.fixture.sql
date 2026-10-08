-- Local fixture for the conversation-review manager correction command (NOT a migration; never
-- applied to Supabase). Table columns, indexes, triggers, RLS policies, views and the points
-- functions mirror the live definitions read on 2026-10-08. Helpers that resolve identity from
-- Supabase Auth are reduced to their x-dawaa-user-id header path, and get_user_permissions returns
-- staff_accounts.permissions (the live resolver composes role/page/override grants).
create extension if not exists pgcrypto with schema public;
create schema if not exists extensions;
create or replace function extensions.digest(text,text) returns bytea language sql immutable as $$ select public.digest($1,$2) $$;
create or replace function extensions.digest(bytea,text) returns bytea language sql immutable as $$ select public.digest($1,$2) $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public, extensions to anon, authenticated, service_role;

-- Identity -------------------------------------------------------------------------------------
create table public.staff_accounts (
  id uuid primary key, staff_id text, username text, name text, staff_name text, role text, branch text,
  active boolean, is_active boolean, can_login boolean, status text, auth_user_id uuid,
  permissions jsonb default '{}'::jsonb, created_at timestamptz default now(), updated_at timestamptz
);
create table public.staff_login_sessions (
  id uuid primary key default gen_random_uuid(), staff_account_id uuid references public.staff_accounts(id),
  token_hash text not null, created_at timestamptz default now(), expires_at timestamptz not null,
  last_used_at timestamptz, revoked_at timestamptz
);
create table public.staff (id uuid primary key, name text, role text, branch text, branch_id uuid, active boolean, is_active boolean);
create table public.whatsapp_review_sources (id uuid primary key, branch text, staff_id uuid);
create table public.whatsapp_operational_canonical_sources_v1 (source_id uuid primary key);
create table public.sales_intelligence_cases (
  case_id text primary key, conversation_id uuid, is_active boolean default false,
  retired_at timestamptz, retire_reason text
);

create function public.dawaa_jsonb_has_true_any(p_permissions jsonb, p_keys text[]) returns boolean language sql immutable as $$
  select coalesce(bool_or(coalesce((p_permissions ->> k)::boolean, false)), false)
  from unnest(coalesce(p_keys, '{}'::text[])) as k where p_permissions ? k;
$$;
create function public.get_user_permissions(p_user_id uuid) returns jsonb language sql security definer set search_path to 'public' as $$
  select coalesce((select permissions from public.staff_accounts where id=p_user_id and coalesce(active,false) and coalesce(can_login,false)),'{}'::jsonb);
$$;
create function public.dawaa_customer_request_branch_key(p text) returns text language sql immutable as $$ select nullif(lower(btrim(coalesce(p,''))),'') $$;
create function public.dawaa_can_read_conversation_review_row_v2(p_actor_id uuid, p_staff_id uuid, p_doctor_id uuid, p_branch text, p_reviewer_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $$
  with me as (select sa.* from public.staff_accounts sa where sa.id = p_actor_id and coalesce(sa.active,false) and coalesce(sa.can_login,false) limit 1)
  select exists (
    select 1 from me
    where lower(trim(coalesce(me.role,''))) in ('general_manager','executive_manager','branches_manager','admin','team_dawaa_alpha')
      or me.id = p_reviewer_id or me.staff_id = p_staff_id::text or me.staff_id = p_doctor_id::text
      or (lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
          and public.dawaa_customer_request_branch_key(me.branch) is not null
          and public.dawaa_customer_request_branch_key(me.branch)=public.dawaa_customer_request_branch_key(p_branch)))
$$;
create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable security definer set search_path to 'public' as $$
  select a.id from public.staff_accounts a
  where coalesce(a.active,false) and coalesce(a.can_login,false)
    and a.id::text = nullif(current_setting('request.headers', true),'')::jsonb ->> 'x-dawaa-user-id'
  limit 1
$$;
create function public.dawaa_current_actor_can(required_permissions text[]) returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text; v_permissions jsonb;
begin
  select sa.role, public.get_user_permissions(sa.id) into v_role, v_permissions
  from public.staff_accounts sa where sa.id = public.dawaa_current_staff_account_id_strict();
  if not found then return false; end if;
  if lower(trim(coalesce(v_role,''))) in ('general_manager','admin') then return true; end if;
  return public.dawaa_jsonb_has_true_any(coalesce(v_permissions,'{}'::jsonb), required_permissions);
end $$;
create function public.dawaa_actor_is_top_management_v1() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.staff_accounts sa where sa.id = public.dawaa_current_staff_account_id_strict()
    and lower(trim(coalesce(sa.role, ''))) in ('general_manager', 'executive_manager', 'branches_manager', 'admin'));
$$;

-- conversation_sales_reviews (live columns) -----------------------------------------------------
create table public.conversation_sales_reviews (
  id uuid not null default gen_random_uuid() primary key,
  reviewer_id uuid, reviewer_name text, reviewer_role text, staff_id uuid, staff_name text, staff_role text, branch text,
  customer_id text, customer_name text, customer_code text, customer_phone text, evaluation_kind text, invoice_number text,
  invoice_time timestamp without time zone, evaluation_reason text, total_score numeric, raw_scores jsonb,
  has_complaint boolean default false, has_medical_error boolean default false, has_invoice_error boolean default false,
  reviewer_notes text, training_recommendation text, final_score numeric, point_impact numeric,
  impact_status text default 'approved'::text, reviewed_at timestamptz default now(), created_at timestamptz default now(),
  base_score numeric default 100, positive_points numeric default 0, negative_points numeric default 0,
  severe_error_points numeric default 0, doctor_points_impact numeric default 0, conversation_level text,
  top_positive_reason text, top_deduction_reason text, forgotten_customer boolean default false,
  missed_sale_opportunity boolean default false, has_critical_error boolean default false, repeated_error_type text,
  repeat_count integer default 0, repeat_multiplier numeric default 1, month_cycle text, doctor_id uuid, branch_id uuid,
  conversation_date timestamptz, conversation_type text, level text, base_points_impact numeric default 0,
  extra_penalty_points numeric default 0, total_applicable_items integer default 0, total_not_applicable_items integer default 0,
  total_applicable_points numeric default 0, earned_points numeric default 0, main_positive_reason text,
  main_negative_reason text, review_items jsonb default '[]'::jsonb, first_customer_message_at timestamptz,
  first_staff_reply_at timestamptz, first_response_minutes integer, response_speed_score numeric, greeting_score numeric,
  greeting_message_used text, doctor_name_used_in_greeting boolean default false, doctor_name_used boolean default false,
  doctor_name_score numeric, customer_name_used boolean default false, customer_name_score numeric,
  tone_language_score numeric, bad_tone_flag boolean default false, severe_bad_tone_flag boolean default false,
  understanding_score numeric, rushed_response_flag boolean default false, misunderstood_customer_flag boolean default false,
  follow_up_promised boolean default false, follow_up_delay_minutes integer, follow_up_score numeric,
  consultation_quality_score numeric, dosage_explanation_score numeric, alternative_handling_score numeric,
  bad_alternative_flag boolean default false, sales_quality_score numeric, upsell_cross_sell_score numeric,
  successful_cross_sell boolean default false, complaint_handling_score numeric, handled_angry_customer_well boolean default false,
  excellent_case boolean default false, order_confirmation_score numeric, has_delivery_issue boolean default false,
  missed_sales_opportunity boolean default false, closing_message_score numeric, closing_message_used boolean default false,
  updated_at timestamptz default now(), doctor_name text, review_date date, reviewer_message text,
  manager_review_score numeric, manager_review_notes text, manager_reviewed_by text, manager_reviewed_at timestamptz,
  converted_to_sale boolean, submission_fingerprint text,
  whatsapp_review_source_id uuid references public.whatsapp_review_sources(id),
  sales_intelligence_case_id text, automatic_evaluation_version text, automatic_evaluation_json jsonb,
  evidence_coverage_percent numeric, automatic_reliability_percent numeric, manual_clinical_review_required boolean,
  is_current boolean not null default true, superseded_at timestamptz, superseded_reason text
);
create unique index ux_conversation_review_submission_fingerprint_v2 on public.conversation_sales_reviews (submission_fingerprint) where submission_fingerprint is not null;
create unique index idx_conversation_reviews_unique_submission on public.conversation_sales_reviews (staff_name, customer_name, conversation_date, reviewer_name) where conversation_date is not null;
create unique index conversation_sales_reviews_whatsapp_source_legacy_uk on public.conversation_sales_reviews (whatsapp_review_source_id) where whatsapp_review_source_id is not null and sales_intelligence_case_id is null;
create unique index conversation_sales_reviews_whatsapp_case_uk on public.conversation_sales_reviews (whatsapp_review_source_id, sales_intelligence_case_id) where whatsapp_review_source_id is not null and sales_intelligence_case_id is not null;
create index conversation_sales_reviews_current_si_case_idx on public.conversation_sales_reviews (sales_intelligence_case_id, whatsapp_review_source_id) where is_current = true and sales_intelligence_case_id is not null;
grant select, insert, update on public.conversation_sales_reviews to anon, authenticated, service_role;
grant select on public.staff_accounts to anon, authenticated, service_role;

-- Live trigger functions (pre-migration bodies) ------------------------------------------------
create function public.resolve_review_staff_id(p_review jsonb) returns uuid language sql as $$ select null::uuid $$;
create function public.attach_review_staff_id() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin if new.staff_id is null then new.staff_id := public.resolve_review_staff_id(to_jsonb(new)); end if; return new; end $$;
create function public.set_conversation_review_report_date() returns trigger language plpgsql set search_path to 'public' as $$
begin new.review_date := coalesce(new.review_date, new.conversation_date::date, new.created_at::date, current_date); return new; end $$;
create function public.set_conversation_review_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create table public.t_notifications (recipient uuid, title text, entity_id text, dedupe_key text, created_at timestamptz default now());
create function public.create_staff_notification(p_recipient_staff_id uuid, p_notification_type text, p_title text, p_message text, p_entity_type text, p_entity_id text, p_action_url text, p_priority text, p_metadata jsonb, p_dedupe_key text, p_created_by_staff_id uuid, p_branch text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin insert into public.t_notifications(recipient,title,entity_id,dedupe_key) values (p_recipient_staff_id,p_title,p_entity_id,p_dedupe_key); return gen_random_uuid(); end $$;
create function public.notify_doctor_on_conversation_review() returns trigger language plpgsql security definer set search_path to 'public','pg_catalog' as $$
begin
  if new.staff_id is null then return new; end if;
  perform public.create_staff_notification(new.staff_id,'conversation_review',
    case when tg_op='INSERT' then 'تم حفظ تقييم محادثة' else 'تم تعديل تقييم محادثتك' end,
    '', 'conversation_review', new.id::text, '', 'normal', '{}'::jsonb,
    lower(format('conversation_review:%s:conversation_review:%s:current:%s', new.staff_id, new.id, new.staff_id)), null, new.branch);
  return new;
end $$;
CREATE FUNCTION public.bind_conversation_review_reviewer_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
declare
  v_actor_id uuid;
  v_name text;
  v_role text;
begin
  if lower(trim(coalesce(new.evaluation_kind, ''))) = 'automatic' then
    new.reviewer_id := null;
    new.reviewer_name := null;
    new.reviewer_role := null;
    return new;
  end if;

  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then
    raise exception 'identified_reviewer_required';
  end if;

  select sa.name, sa.role
    into v_name, v_role
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false)
  limit 1;

  if v_name is null then
    raise exception 'active_reviewer_account_required';
  end if;

  new.reviewer_id := v_actor_id;
  new.reviewer_name := v_name;
  new.reviewer_role := v_role;
  return new;
end;
$function$;
CREATE FUNCTION public.set_conversation_review_submission_fingerprint_v2() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
declare
  v_staff_key text; v_reviewer_key text; v_customer_key text; v_payload text;
begin
  if new.conversation_date is null then new.submission_fingerprint := null; return new; end if;
  v_staff_key := coalesce(new.staff_id::text, nullif(lower(trim(coalesce(new.staff_name, ''))), ''), '__no_staff__');
  v_reviewer_key := coalesce(new.reviewer_id::text, nullif(lower(trim(coalesce(new.reviewer_name, ''))), ''), '__no_reviewer__');
  v_customer_key := coalesce(nullif(trim(coalesce(new.customer_code, '')), ''), nullif(trim(coalesce(new.customer_id, '')), ''), nullif(lower(trim(coalesce(new.customer_name, ''))), ''), '__no_customer__');
  v_payload := concat_ws('|', v_staff_key, v_reviewer_key, to_char(new.conversation_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), v_customer_key);
  new.submission_fingerprint := encode(extensions.digest(convert_to(v_payload, 'UTF8'), 'sha256'::text), 'hex');
  return new;
end;
$function$;
create function public.dawaa_supersede_legacy_review_on_automatic_v2() returns trigger language plpgsql security definer set search_path to 'public','pg_catalog' as $function$
begin
  if coalesce(new.is_current,true) is not true
     or lower(trim(coalesce(new.evaluation_kind,''))) <> 'automatic'
     or new.whatsapp_review_source_id is null
     or new.sales_intelligence_case_id is null then
    return new;
  end if;
  update public.conversation_sales_reviews r set is_current=false, updated_at=now()
  where r.id<>new.id and r.whatsapp_review_source_id=new.whatsapp_review_source_id
    and r.sales_intelligence_case_id is null and coalesce(r.is_current,true)=true;
  return new;
end;
$function$;

create trigger bind_conversation_review_reviewer_v1 before insert on public.conversation_sales_reviews for each row execute function public.bind_conversation_review_reviewer_v1();
create trigger conversation_review_supersede_legacy_v2 after insert or update of is_current, evaluation_kind, whatsapp_review_source_id, sales_intelligence_case_id on public.conversation_sales_reviews for each row execute function public.dawaa_supersede_legacy_review_on_automatic_v2();
create trigger trg_attach_review_staff_id before insert or update on public.conversation_sales_reviews for each row execute function public.attach_review_staff_id();
create trigger trg_conversation_review_report_date before insert or update of conversation_date, created_at, review_date on public.conversation_sales_reviews for each row execute function public.set_conversation_review_report_date();
create trigger trg_conversation_review_updated_at before update on public.conversation_sales_reviews for each row execute function public.set_conversation_review_updated_at();
create trigger trg_notify_doctor_on_conversation_review after insert or update on public.conversation_sales_reviews for each row execute function public.notify_doctor_on_conversation_review();
create trigger zz_set_conversation_review_submission_fingerprint_v2 before insert on public.conversation_sales_reviews for each row execute function public.set_conversation_review_submission_fingerprint_v2();
-- (zzzz_automatic_conversation_review_writer_guard_v2 comes from the committed guard migrations.)

alter table public.conversation_sales_reviews enable row level security;
create policy conversation_sales_reviews_insert_canonical on public.conversation_sales_reviews for insert to public
with check (dawaa_current_actor_can(ARRAY['add_reviews'::text, 'reviews.action.create'::text]) AND (((lower(TRIM(BOTH FROM COALESCE(evaluation_kind, ''::text))) = 'automatic'::text) AND (reviewer_id IS NULL) AND (reviewer_name IS NULL) AND (reviewer_role IS NULL) AND (whatsapp_review_source_id IS NOT NULL) AND (submission_fingerprint ~~ 'auto:%'::text)) OR (reviewer_id = dawaa_current_staff_account_id_strict()) OR (EXISTS ( SELECT 1 FROM staff_accounts sa WHERE ((sa.id = dawaa_current_staff_account_id_strict()) AND COALESCE(sa.active, false) AND COALESCE(sa.can_login, false) AND ((conversation_sales_reviews.reviewer_id)::text = sa.staff_id)))) OR dawaa_actor_is_top_management_v1()));
create policy conversation_sales_reviews_select_canonical on public.conversation_sales_reviews for select to public
using ((is_current = true) AND ( SELECT dawaa_current_actor_can(ARRAY['view_reviews'::text]) AS dawaa_current_actor_can) AND dawaa_can_read_conversation_review_row_v2(( SELECT dawaa_current_staff_account_id_strict() AS dawaa_current_staff_account_id_strict), staff_id, doctor_id, branch, reviewer_id));
create policy conversation_sales_reviews_update_canonical on public.conversation_sales_reviews for update to public
using (dawaa_current_actor_can(ARRAY['edit_reviews'::text, 'approve_reviews'::text]))
with check (dawaa_current_actor_can(ARRAY['edit_reviews'::text, 'approve_reviews'::text]) AND (((lower(TRIM(BOTH FROM COALESCE(evaluation_kind, ''::text))) = 'automatic'::text) AND (reviewer_id IS NULL) AND (reviewer_name IS NULL) AND (reviewer_role IS NULL) AND (whatsapp_review_source_id IS NOT NULL)) OR (reviewer_id = dawaa_current_staff_account_id_strict()) OR (EXISTS ( SELECT 1 FROM staff_accounts sa WHERE ((sa.id = dawaa_current_staff_account_id_strict()) AND COALESCE(sa.active, false) AND COALESCE(sa.can_login, false) AND ((conversation_sales_reviews.reviewer_id)::text = sa.staff_id)))) OR dawaa_actor_is_top_management_v1()));

-- Live views (pre-migration) -------------------------------------------------------------------
create view public.conversation_sales_reviews_official_v1 with (security_invoker = true) as
select id, reviewer_id, reviewer_name, reviewer_role, staff_id, staff_name, staff_role, branch,
  customer_id, customer_name, customer_code, customer_phone, evaluation_kind, invoice_number,
  invoice_time, evaluation_reason, total_score, raw_scores, has_complaint, has_medical_error,
  has_invoice_error, reviewer_notes, training_recommendation, final_score, point_impact,
  impact_status, reviewed_at, created_at, base_score, positive_points, negative_points,
  severe_error_points, doctor_points_impact, conversation_level, top_positive_reason,
  top_deduction_reason, forgotten_customer, missed_sale_opportunity, has_critical_error,
  repeated_error_type, repeat_count, repeat_multiplier, month_cycle, doctor_id, branch_id,
  conversation_date, conversation_type, level, base_points_impact, extra_penalty_points,
  total_applicable_items, total_not_applicable_items, total_applicable_points, earned_points,
  main_positive_reason, main_negative_reason, review_items, first_customer_message_at,
  first_staff_reply_at, first_response_minutes, response_speed_score, greeting_score,
  greeting_message_used, doctor_name_used_in_greeting, doctor_name_used, doctor_name_score,
  customer_name_used, customer_name_score, tone_language_score, bad_tone_flag,
  severe_bad_tone_flag, understanding_score, rushed_response_flag, misunderstood_customer_flag,
  follow_up_promised, follow_up_delay_minutes, follow_up_score, consultation_quality_score,
  dosage_explanation_score, alternative_handling_score, bad_alternative_flag, sales_quality_score,
  upsell_cross_sell_score, successful_cross_sell, complaint_handling_score,
  handled_angry_customer_well, excellent_case, order_confirmation_score, has_delivery_issue,
  missed_sales_opportunity, closing_message_score, closing_message_used, updated_at, doctor_name,
  review_date, reviewer_message, manager_review_score, manager_review_notes, manager_reviewed_by,
  manager_reviewed_at, converted_to_sale, submission_fingerprint, whatsapp_review_source_id
from public.conversation_sales_reviews r
where r.whatsapp_review_source_id is null
   or exists (select 1 from public.whatsapp_operational_canonical_sources_v1 o where o.source_id = r.whatsapp_review_source_id);
create view public.conversation_sales_reviews_canonical_v2 with (security_invoker = true) as
with current_rows as (
  select r.* from public.conversation_sales_reviews r
  where coalesce(r.is_current,true)=true
    and (r.whatsapp_review_source_id is null
      or exists (select 1 from public.whatsapp_operational_canonical_sources_v1 s where s.source_id=r.whatsapp_review_source_id))
)
select r.* from current_rows r
where r.whatsapp_review_source_id is null or r.sales_intelligence_case_id is not null
   or not exists (select 1 from current_rows a where a.whatsapp_review_source_id=r.whatsapp_review_source_id and a.sales_intelligence_case_id is not null);
grant select on public.conversation_sales_reviews_official_v1, public.conversation_sales_reviews_canonical_v2 to anon, authenticated, service_role;

-- employee_transactions + live points boundary --------------------------------------------------
create table public.employee_transactions (
  id uuid not null default gen_random_uuid() primary key, staff_id uuid not null, type text not null, title text, reason text,
  amount numeric default 0, points numeric default 0, source text default 'manual'::text, source_id uuid,
  transaction_date date default CURRENT_DATE, created_at timestamptz default now(), updated_at timestamptz default now(),
  description text, points_delta numeric, created_by text, month_cycle text, branch text, status text default 'approved'::text,
  employee_name text, rule_id uuid, category text, repeat_count integer default 1, base_points numeric, final_points numeric,
  approved_by text, approved_at timestamptz, employee_visible boolean default true, corrective_action text, executor_name text,
  created_by_name text, approved_by_name text, clean_reason text, display_reason text, item_name text, item_quantity numeric,
  source_label text, display_source text, metadata jsonb not null default '{}'::jsonb, employee_id uuid
);
CREATE FUNCTION public.protect_conversation_review_points_payload_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
begin
  if old.source = 'conversation_evaluation' and old.source_id is not null and new.source = old.source and new.source_id = old.source_id then
    new.staff_id := old.staff_id; new.employee_id := old.employee_id; new.employee_name := old.employee_name; new.type := old.type;
    new.title := old.title; new.reason := old.reason; new.description := old.description; new.amount := old.amount;
    new.points := old.points; new.points_delta := old.points_delta; new.base_points := old.base_points; new.final_points := old.final_points;
    new.repeat_count := old.repeat_count; new.source := old.source; new.source_id := old.source_id; new.transaction_date := old.transaction_date;
    new.month_cycle := old.month_cycle; new.branch := old.branch; new.category := old.category; new.metadata := old.metadata;
  end if;
  return new;
end;
$function$;
CREATE FUNCTION public.dawaa_guard_conversation_review_points_v53() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
begin
  if coalesce(new.source,'') in ('whatsapp_automatic_review','conversation_evaluation','conversation_review','conversation_sales_reviews')
     and new.source_id is not null and coalesce(new.status,'active') in ('active','approved','pending') then
    if not exists (select 1 from public.conversation_sales_reviews_official_v1 r where r.id = new.source_id) then
      raise exception using errcode = '23514', message = 'conversation_review_points_require_official_review';
    end if;
  end if;
  return new;
end
$function$;
create trigger protect_conversation_review_points_payload_v1 before update on public.employee_transactions for each row execute function public.protect_conversation_review_points_payload_v1();
create trigger trg_conversation_review_points_official_v53 before insert or update of source, source_id, status on public.employee_transactions for each row execute function public.dawaa_guard_conversation_review_points_v53();

CREATE FUNCTION public.dawaa_current_points_cycle_label_v1() RETURNS text LANGUAGE sql STABLE SET search_path TO 'public', 'pg_catalog' AS $function$
  select case when extract(day from (now() at time zone 'Africa/Cairo')) >= 26
    then to_char(((now() at time zone 'Africa/Cairo')::date + interval '1 month')::date, 'YYYY-MM')
    else to_char((now() at time zone 'Africa/Cairo')::date, 'YYYY-MM') end
$function$;
CREATE FUNCTION public.employee_operating_actor_id() RETURNS text LANGUAGE sql STABLE SET search_path TO 'public', 'pg_catalog' AS $function$
  select coalesce(nullif((nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-dawaa-user-id'), ''), nullif(current_setting('request.jwt.claim.sub', true), ''));
$function$;
CREATE FUNCTION public.employee_operating_actor_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select lower(trim(coalesce(sa.role, ''))) from public.staff_accounts sa where sa.id::text = public.employee_operating_actor_id() and coalesce(sa.active, true) = true and coalesce(sa.can_login, true) = true limit 1;
$function$;
CREATE FUNCTION public.employee_operating_actor_branch() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select nullif(trim(coalesce(sa.branch, '')), '') from public.staff_accounts sa where sa.id::text = public.employee_operating_actor_id() and coalesce(sa.active, true) = true and coalesce(sa.can_login, true) = true limit 1;
$function$;
-- Exact live definition (pg_get_functiondef, 2026-10-08).
CREATE OR REPLACE FUNCTION public.dawaa_points_same_event_conflicts_v1(p_incoming_rule text, p_existing_rules text[])
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_group text[];
  v_conflicts text[];
  v_incoming text:=upper(trim(coalesce(p_incoming_rule,'')));
begin
  if v_incoming='' then return array[]::text[]; end if;

  if v_incoming=any(array['CHAT-009','CHAT-010']) then
    v_group:=array['CHAT-009','CHAT-010'];
  elsif v_incoming=any(array['CLASS-001','CLASS-002','CLASS-003']) then
    v_group:=array['CLASS-001','CLASS-002','CLASS-003'];
  elsif v_incoming=any(array['SALE-002A','SALE-002B','SALE-003','SALE-004']) then
    v_group:=array['SALE-002A','SALE-002B','SALE-003','SALE-004'];
  elsif v_incoming=any(array['APP-006','APP-007']) then
    v_group:=array['APP-006','APP-007'];
  else
    return array[]::text[];
  end if;

  select coalesce(array_agg(distinct upper(trim(x))),array[]::text[])
  into v_conflicts
  from unnest(coalesce(p_existing_rules,array[]::text[])) x
  where upper(trim(x))=any(v_group)
    and upper(trim(x))<>v_incoming;

  return v_conflicts;
end;
$function$;
CREATE FUNCTION public.record_employee_points_transaction_v3(p_staff_id uuid, p_signed_points numeric, p_reason text, p_description text DEFAULT NULL::text, p_source text DEFAULT 'manual_admin'::text, p_source_id uuid DEFAULT NULL::uuid, p_rule_code text DEFAULT NULL::text, p_month_cycle text DEFAULT NULL::text, p_branch text DEFAULT NULL::text, p_status text DEFAULT 'active'::text, p_category text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
declare
  v_actor_id text := public.employee_operating_actor_id();
  v_actor_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_staff public.staff%rowtype;
  v_cycle text := coalesce(nullif(trim(coalesce(p_month_cycle,'')),''), public.dawaa_current_points_cycle_label_v1());
  v_source text := coalesce(nullif(trim(coalesce(p_source,'')),''),'manual_admin');
  v_rule text := coalesce(nullif(trim(coalesce(p_rule_code,'')),''),'__event__');
  v_status text := lower(trim(coalesce(p_status,'active')));
  v_type text;
  v_existing uuid;
  v_saved public.employee_transactions%rowtype;
  v_global boolean := v_actor_role in ('general_manager','admin','executive_manager','branches_manager','manager','مدير عام','مدير تنفيذي','مديرة الفروع','مدير الفروع');
  v_branch_manager boolean := v_actor_role in ('branch_manager','customer_service_manager','مدير فرع','مديرة فرع','مسؤولة خدمة العملاء','مسؤول خدمة العملاء');
  v_review_authorized boolean := false;
begin
  if v_actor_id is null then raise exception 'not_authenticated'; end if;
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found'; end if;
  if v_source in ('conversation_review','conversation_evaluation','conversation_sales_reviews') and p_source_id is not null then
    select exists(select 1 from public.conversation_sales_reviews r where r.id=p_source_id and r.reviewer_id::text=v_actor_id and r.staff_id=p_staff_id
      and coalesce(trim(r.branch),'')=coalesce(trim(coalesce(p_branch,v_staff.branch)), '')) into v_review_authorized;
  end if;
  if not v_global then
    if v_review_authorized then null;
    elsif v_branch_manager then
      if coalesce(v_staff.branch,'') is distinct from coalesce(v_actor_branch,'') then raise exception 'not_authorized_for_branch'; end if;
    else raise exception 'not_authorized';
    end if;
  end if;
  if v_status not in ('active','approved','pending','cancelled') then raise exception 'invalid_status'; end if;
  v_type := case when coalesce(p_signed_points,0)<0 then 'penalty' else 'reward' end;
  if p_source_id is not null then
    select et.id into v_existing from public.employee_transactions et
    where et.staff_id=p_staff_id and et.month_cycle=v_cycle and coalesce(et.source,'')=v_source and et.source_id=p_source_id
      and coalesce(nullif(trim(et.metadata->>'rule_code'),''),'__event__')=v_rule and coalesce(et.status,'active') in ('active','approved','pending')
    order by coalesce(et.updated_at,et.created_at) desc,et.id desc limit 1;
  end if;
  if v_existing is null then
    insert into public.employee_transactions(staff_id,employee_id,employee_name,type,title,reason,description,amount,points,points_delta,final_points,source,source_id,transaction_date,month_cycle,branch,status,category,created_by,created_by_name,approved_by,approved_by_name,approved_at,employee_visible,metadata)
    values(p_staff_id,p_staff_id,v_staff.name,v_type,p_reason,p_reason,nullif(trim(coalesce(p_description,'')),''),0,abs(coalesce(p_signed_points,0)),coalesce(p_signed_points,0),coalesce(p_signed_points,0),v_source,p_source_id,current_date,v_cycle,coalesce(nullif(trim(coalesce(p_branch,'')),''),v_staff.branch),v_status,p_category,v_actor_id,null,case when v_status in ('active','approved') then v_actor_id else null end,null,case when v_status in ('active','approved') then now() else null end,true,coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('engine_version',3,'rule_code',v_rule))
    returning * into v_saved;
  else
    update public.employee_transactions set type=v_type,reason=p_reason,title=p_reason,description=nullif(trim(coalesce(p_description,'')),''),points=abs(coalesce(p_signed_points,0)),points_delta=coalesce(p_signed_points,0),final_points=coalesce(p_signed_points,0),branch=coalesce(nullif(trim(coalesce(p_branch,'')),''),v_staff.branch),status=v_status,category=p_category,approved_by=case when v_status in ('active','approved') then v_actor_id else null end,approved_at=case when v_status in ('active','approved') then now() else null end,updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('engine_version',3,'rule_code',v_rule) where id=v_existing returning * into v_saved;
  end if;
  return jsonb_build_object('id',v_saved.id,'staff_id',v_saved.staff_id,'source',v_saved.source,'source_id',v_saved.source_id,'rule_code',v_rule,'points_delta',v_saved.points_delta,'status',v_saved.status,'month_cycle',v_saved.month_cycle);
end;
$function$;
-- Exact live definition (pg_get_functiondef, 2026-10-08) and live ACL.
CREATE OR REPLACE FUNCTION public.record_employee_points_transaction_v4(p_staff_id uuid, p_signed_points numeric, p_reason text, p_description text DEFAULT NULL::text, p_source text DEFAULT 'manual_admin'::text, p_source_id uuid DEFAULT NULL::uuid, p_rule_code text DEFAULT NULL::text, p_month_cycle text DEFAULT NULL::text, p_branch text DEFAULT NULL::text, p_status text DEFAULT 'active'::text, p_category text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_manager_override boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_cycle text:=coalesce(nullif(trim(coalesce(p_month_cycle,'')),''),public.dawaa_current_points_cycle_label_v1());
  v_rule text:=upper(coalesce(nullif(trim(coalesce(p_rule_code,'')),''),'__EVENT__'));
  v_existing_rules text[]:=array[]::text[];
  v_conflicts text[]:=array[]::text[];
  v_can_override boolean:=false;
begin
  if p_manager_override then
    v_can_override:=public.dawaa_current_actor_can(array['manage_points','manage_payroll']);
    if not v_can_override then
      raise exception 'not_authorized_for_points_overlap_override' using errcode='42501';
    end if;
  end if;

  if coalesce(p_signed_points,0)<0 and p_source_id is not null and v_rule<>'__EVENT__' then
    select coalesce(array_agg(distinct existing_code),array[]::text[])
    into v_existing_rules
    from (
      select coalesce(
        nullif(upper(trim(et.metadata->>'rule_code')),''),
        nullif(upper((regexp_match(coalesce(et.description,et.reason,''),'__RULE__:([A-Za-z0-9_-]+)','i'))[1]),'')
      ) existing_code
      from public.employee_transactions et
      where et.staff_id=p_staff_id
        and et.source_id=p_source_id
        and et.month_cycle=v_cycle
        and et.type='penalty'
        and coalesce(et.status,'active') in ('active','approved','pending')
    ) q
    where existing_code is not null;

    v_conflicts:=public.dawaa_points_same_event_conflicts_v1(v_rule,v_existing_rules);

    if coalesce(array_length(v_conflicts,1),0)>0 and not p_manager_override then
      raise exception 'overlapping_points_deduction:%',array_to_string(v_conflicts,',')
        using errcode='23514';
    end if;
  end if;

  return public.record_employee_points_transaction_v3(
    p_staff_id,
    p_signed_points,
    p_reason,
    p_description,
    p_source,
    p_source_id,
    v_rule,
    v_cycle,
    p_branch,
    p_status,
    p_category,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'command_version',4,
      'same_event_overlap_checked',true,
      'manager_overlap_override',coalesce(p_manager_override,false),
      'overlap_conflicts',to_jsonb(v_conflicts)
    )
  );
end;
$function$;
revoke all on function public.record_employee_points_transaction_v4(uuid,numeric,text,text,text,uuid,text,text,text,text,text,jsonb,boolean) from public, anon;
grant execute on function public.record_employee_points_transaction_v4(uuid,numeric,text,text,text,uuid,text,text,text,text,text,jsonb,boolean) to authenticated, service_role;

-- Exact live PRE-MIGRATION definition of the Production review-points caller (pg_get_functiondef,
-- 2026-10-08), including its fail-open account-state line, and its live ACL. The migration under
-- test must harden it in place without changing its contract or grants.
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
revoke all on function public.record_conversation_review_points_v1(text,uuid) from public;
grant execute on function public.record_conversation_review_points_v1(text,uuid) to anon, authenticated, service_role;

-- Pre-migration snapshot of the Production caller, so the tests can prove the migration changed
-- only its account-state predicate (same signature, result, owner, security, config and ACL).
create table public.t_points_v1_before as
select p.prosrc, p.proacl::text as acl, p.proowner, p.prosecdef, p.proconfig::text as cfg,
       pg_get_function_result(p.oid) as res, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p where p.oid = 'public.record_conversation_review_points_v1(text,uuid)'::regprocedure;
