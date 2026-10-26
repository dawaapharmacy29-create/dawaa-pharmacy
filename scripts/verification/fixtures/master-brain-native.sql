-- Synthetic isolated PostgreSQL 17 fixture for the WhatsApp Master Brain native verification.
-- Never run against an application database. Auth/permission functions are deterministic stubs
-- driven by session settings; follow-up creation/linking/materialization use the production
-- function bodies (captured read-only 2026-10-26) so concurrency is exercised on real code.
set client_min_messages = warning;
create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create table public.staff_accounts(
  id uuid primary key, staff_id text, username text, name text, role text, staff_role text, branch text,
  active boolean default true, is_active boolean default true, can_login boolean default true, status text default 'active');

create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable as $$
  select nullif(current_setting('test.actor', true), '')::uuid $$;
create function public.dawaa_current_actor_can(text[]) returns boolean language sql stable as $$ select true $$;
create function public.dawaa_can_read_conversation_review_row_v2(uuid,uuid,uuid,text,uuid) returns boolean language sql stable as $$ select true $$;
create function public.dawaa_can_access_customer_request_branch(text,text) returns boolean language sql stable as $$ select true $$;
create function public.dawaa_is_transaction_branch_v1(text) returns boolean language sql immutable as $$ select $1 in ('فرع شكري','فرع الشامي') $$;
create function public.resolve_staff_account_safe(p text)
returns table(id uuid, staff_id text, username text, name text, staff_name text, role text, branch text, active boolean, can_login boolean)
language sql stable as $$
  select a.id, a.staff_id, a.username, a.name, a.name, a.role, a.branch, a.active, a.can_login
  from public.staff_accounts a where a.id::text = p or a.staff_id = p limit 1 $$;
create function public.dawaa_require_customer_service_actor_v1(p_manager_only boolean default false)
returns public.staff_accounts language plpgsql stable as $$
declare v public.staff_accounts;
begin
  select * into v from public.staff_accounts where id = public.dawaa_current_staff_account_id_strict() and active and can_login;
  if not found then raise exception 'يجب تسجيل الدخول بحساب موظف نشط'; end if;
  return v;
end $$;
create function public.create_customer_request_canonical_v2(uuid,uuid,uuid,text,numeric,text,text,text,date,text,text,text,text,text)
returns jsonb language sql as $$ select '{}'::jsonb $$;

CREATE FUNCTION public.dawaa_normalize_egyptian_mobile_v1(p_value text) RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  select case
    when digits ~ '^00201[0125][0-9]{8}$' then '0' || substr(digits, 5)
    when digits ~ '^201[0125][0-9]{8}$' then '0' || substr(digits, 3)
    when digits ~ '^1[0125][0-9]{8}$' then '0' || digits
    else digits
  end
  from (select regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g') as digits) s;
$function$;
CREATE FUNCTION public.dawaa_customer_identity_key_v1(p_customer_id text, p_customer_code text, p_phone text, p_name text)
 RETURNS text LANGUAGE plpgsql IMMUTABLE AS $function$
declare
  v_phone text := public.dawaa_normalize_egyptian_mobile_v1(p_phone);
  v_name text;
begin
  if nullif(btrim(p_customer_id), '') is not null then return 'id:' || btrim(p_customer_id); end if;
  if nullif(btrim(p_customer_code), '') is not null
     and lower(btrim(p_customer_code)) not in ('0','null','undefined','غير محدد','غير معروف') then
    return 'code:' || btrim(p_customer_code);
  end if;
  if v_phone ~ '^01[0125][0-9]{8}$' then return 'phone:' || v_phone; end if;
  v_name := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  if v_name <> '' and v_name not in ('0','غير محدد','غير معروف','عميل غير مسجل','عميل الصيدلية') then
    return 'name:' || v_name;
  end if;
  return null;
end;
$function$;

create table public.daily_followups(
  id text primary key default gen_random_uuid()::text, date text, customer_id text, customer_name text, name text,
  phone text, customer_phone text, customer_code text, branch text, status text, followup_status text default 'pending',
  contact_status text default 'pending', followup_type text, request_type text, request_details text, followup_reason text,
  priority text, next_followup_date date, created_by text, created_by_name text, requested_by_staff_id text,
  request_source text, identity_key text, client_request_id text, is_hidden boolean default false,
  is_duplicate boolean default false, duplicate_of text, completed_at timestamptz, cancelled_at timestamptz,
  archived_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create unique index daily_followups_one_open_case_per_customer_branch_uidx on public.daily_followups
  (identity_key, coalesce(nullif(trim(branch), ''), 'غير محدد'))
  where identity_key is not null and coalesce(is_hidden,false) = false and coalesce(is_duplicate,false) = false
    and duplicate_of is null and completed_at is null and cancelled_at is null and archived_at is null
    and lower(coalesce(status,'')) <> all (array['completed','cancelled','archived','closed','merged_duplicate'])
    and lower(coalesce(followup_status,'')) <> all (array['completed','تم','تم التواصل','تم الشراء بعد المتابعة']);
create unique index daily_followups_client_request_id_uidx on public.daily_followups(client_request_id)
  where client_request_id is not null and btrim(client_request_id) <> '';
create table public.customer_service_followup_events(
  id uuid primary key default gen_random_uuid(), followup_id text references public.daily_followups(id) on delete cascade,
  queue_item_id uuid, event_type text, event_status text, actor_staff_id text, actor_name text, notes text,
  metadata jsonb default '{}'::jsonb, created_at timestamptz default now());

create table public.whatsapp_review_sources(id uuid primary key, customer_id uuid, customer_name text, customer_code text,
  branch text, staff_id uuid, canonical boolean default true);
create view public.whatsapp_operational_canonical_sources_v1 as
  select id source_id from public.whatsapp_review_sources where canonical;
create table public.sales_intelligence_cases(case_id text primary key, conversation_id uuid,
  is_active boolean default true, published_analysis_id uuid);
create table public.sales_intelligence_case_analyses(analysis_id uuid primary key, case_id text,
  is_current boolean default true, superseded_at timestamptz, evidence_snapshot jsonb);
create table public.whatsapp_conversation_actions(
  id uuid primary key default gen_random_uuid(), source_id uuid, action_key text, action_type text,
  status text check (status in ('proposed','ready','created','dismissed','error')),
  work_status text default 'unassigned', auto_eligible boolean default false, branch text,
  customer_id uuid, customer_code text, customer_name text, customer_phone text, product_id uuid, staff_id uuid,
  product_name text, quantity numeric, due_at timestamptz, reason text, evidence jsonb, payload jsonb,
  followup_identity text unique, assigned_to_id uuid, assigned_to_name text, created_by text,
  target_table text, target_id text, last_error text, updated_at timestamptz default now(),
  unique (source_id, action_key));
create table public.whatsapp_review_audit(id bigserial primary key, source_id uuid, action text, actor_id text,
  actor_name text, actor_role text, before_state jsonb, after_state jsonb, note text, created_at timestamptz default now());

-- Production body (read-only capture 2026-10-26).
CREATE FUNCTION public.dawaa_create_or_link_customer_followup_v1(p_customer_id text DEFAULT NULL::text, p_customer_code text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text, p_customer_phone text DEFAULT NULL::text, p_branch text DEFAULT NULL::text, p_request_type text DEFAULT 'general'::text, p_request_details text DEFAULT NULL::text, p_followup_reason text DEFAULT NULL::text, p_priority text DEFAULT 'متوسطة'::text, p_next_followup_date date DEFAULT NULL::date, p_client_request_id text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
declare a public.staff_accounts; v_role text; v_branch text:=trim(coalesce(p_branch,''));
begin
  a:=public.dawaa_require_customer_service_actor_v1(false);
  v_role:=lower(trim(coalesce(a.role,a.staff_role,'')));
  if nullif(trim(coalesce(p_customer_name,'')),'') is null then raise exception 'اسم العميل مطلوب'; end if;
  if v_branch not in ('فرع الشامي','فرع شكري') then raise exception 'فرع العميل غير صحيح'; end if;
  if v_role not in ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager')
     and nullif(trim(coalesce(a.branch,'')),'') is distinct from v_branch then raise exception 'لا يمكن إنشاء متابعة خارج فرع الحساب'; end if;
  return public.find_or_create_open_customer_followup(p_customer_id,p_customer_code,trim(p_customer_name),p_customer_phone,v_branch,
    coalesce(nullif(trim(coalesce(p_request_type,'')),''),'general'),p_request_details,p_followup_reason,p_priority,p_next_followup_date,
    a.id::text,coalesce(a.name,a.username),coalesce(nullif(trim(coalesce(p_client_request_id,'')),''),'followup:'||gen_random_uuid()::text),
    coalesce(nullif(trim(coalesce(p_source,'')),''),'manual'));
end $function$;

-- Production body (read-only capture 2026-10-26), unchanged.
CREATE FUNCTION public.dawaa_materialize_whatsapp_action_core_v2(p_action_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_action public.whatsapp_conversation_actions%rowtype;
  v_source public.whatsapp_review_sources%rowtype;
  v_result jsonb; v_target_id text; v_priority text; v_request_type text; v_needed_date date;
begin
  if public.dawaa_current_staff_account_id_strict() is null then raise exception 'not_authorized'; end if;
  select * into v_action from public.whatsapp_conversation_actions where id = p_action_id for update;
  if v_action.id is null then raise exception 'whatsapp_action_not_found'; end if;
  select * into v_source from public.whatsapp_review_sources where id = v_action.source_id;
  if v_source.id is null then raise exception 'whatsapp_source_not_found'; end if;
  if not public.dawaa_can_read_conversation_review_row_v2(public.dawaa_current_staff_account_id_strict(), v_source.staff_id, null::uuid, v_source.branch, null::uuid)
  then raise exception 'whatsapp_action_access_denied'; end if;
  if v_action.status = 'created' then
    return jsonb_build_object('ok',true,'already_created',true,'action_id',v_action.id,'target_table',v_action.target_table,'target_id',v_action.target_id);
  end if;
  if v_action.status not in ('ready','proposed') then raise exception 'whatsapp_action_not_materializable'; end if;
  if v_action.action_type in ('customer_followup','recommendation_followup','complaint_followup') then
    if nullif(trim(coalesce(v_action.customer_name,'')),'') is null then raise exception 'followup_customer_name_required'; end if;
    if nullif(trim(coalesce(v_action.branch,'')),'') is null then raise exception 'followup_branch_required'; end if;
    v_request_type := case v_action.action_type when 'recommendation_followup' then 'recommendation' when 'complaint_followup' then 'complaint' else 'general' end;
    v_priority := case when v_action.action_type='complaint_followup' then 'عالية' when coalesce(v_action.payload->>'priority','')='urgent' then 'عالية' else 'متوسطة' end;
    v_needed_date := case when v_action.due_at is null then null else (v_action.due_at at time zone 'Africa/Cairo')::date end;
    v_result := public.dawaa_create_or_link_customer_followup_v1(
      v_action.customer_id::text, v_action.customer_code, v_action.customer_name, v_action.customer_phone,
      v_action.branch, v_request_type,
      concat_ws(E'\n',v_action.reason,case when v_action.product_name is not null then 'الصنف: '||v_action.product_name else null end),
      v_action.reason, v_priority, v_needed_date, 'whatsapp-action:'||v_action.id::text, 'whatsapp_review_v6');
    v_target_id := nullif(v_result->>'followup_id','');
    if v_target_id is null then raise exception 'followup_creation_did_not_return_id'; end if;
    update public.whatsapp_conversation_actions set status='created',target_table='daily_followups',target_id=v_target_id,last_error=null,updated_at=now() where id=v_action.id;
  else
    raise exception 'action_type_requires_manual_handling';
  end if;
  insert into public.whatsapp_review_audit(source_id,action,actor_id,actor_name,actor_role,before_state,after_state,note)
  select v_action.source_id,'operational_action_materialized',a.id::text,coalesce(a.name,a.username),coalesce(a.role,a.staff_role),to_jsonb(v_action),
         jsonb_build_object('action_id',v_action.id,'target_table','daily_followups','target_id',v_target_id,'result',v_result),
         'isolated fixture'
  from public.staff_accounts a where a.id=public.dawaa_current_staff_account_id_strict() limit 1;
  return jsonb_build_object('ok',true,'already_created',false,'action_id',v_action.id,'target_id',v_target_id,'result',v_result);
end;
$function$;

-- Pre-change Contract A body is replaced by the obligations migration; a minimal placeholder lets
-- create_or_link compile before it is loaded.
CREATE FUNCTION public.find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text DEFAULT NULL,text DEFAULT 'manual')
RETURNS jsonb LANGUAGE sql AS $$ select '{}'::jsonb $$;

-- Conversation reviews and the points ledger (subset of production columns).
create table public.conversation_sales_reviews(
  id uuid primary key default gen_random_uuid(), staff_id uuid, doctor_id uuid, branch text, reviewer_id text,
  reviewer_name text, staff_name text, staff_role text, customer_id text, customer_name text, customer_code text,
  customer_phone text, invoice_number text, invoice_time text, evaluation_reason text, raw_scores jsonb,
  has_complaint boolean, has_medical_error boolean, has_invoice_error boolean, reviewer_notes text,
  training_recommendation text, reviewed_at timestamptz, base_score numeric, positive_points numeric,
  negative_points numeric, severe_error_points numeric, conversation_level text, top_positive_reason text,
  top_deduction_reason text, forgotten_customer boolean, missed_sale_opportunity boolean, has_critical_error boolean,
  repeated_error_type text, repeat_count integer, repeat_multiplier numeric, month_cycle text, branch_id uuid,
  conversation_type text, level text, base_points_impact numeric, extra_penalty_points numeric,
  total_applicable_items integer, total_not_applicable_items integer, total_applicable_points numeric,
  earned_points numeric, main_positive_reason text, main_negative_reason text, review_items jsonb,
  first_customer_message_at timestamptz, first_staff_reply_at timestamptz, first_response_minutes numeric,
  response_speed_score numeric, greeting_score numeric, greeting_message_used boolean,
  doctor_name_used_in_greeting boolean, doctor_name_used boolean, doctor_name_score numeric,
  customer_name_used boolean, customer_name_score numeric, tone_language_score numeric, bad_tone_flag boolean,
  severe_bad_tone_flag boolean, understanding_score numeric, rushed_response_flag boolean,
  misunderstood_customer_flag boolean, follow_up_promised boolean, follow_up_delay_minutes numeric,
  follow_up_score numeric, consultation_quality_score numeric, dosage_explanation_score numeric,
  alternative_handling_score numeric, bad_alternative_flag boolean, sales_quality_score numeric,
  upsell_cross_sell_score numeric, successful_cross_sell boolean, complaint_handling_score numeric,
  handled_angry_customer_well boolean, excellent_case boolean, order_confirmation_score numeric,
  has_delivery_issue boolean, missed_sales_opportunity boolean, closing_message_score numeric,
  closing_message_used boolean, doctor_name text, review_date date, reviewer_message text,
  manager_review_score numeric, manager_review_notes text, converted_to_sale boolean, submission_fingerprint text,
  reviewer_role text, conversation_date timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
  final_score numeric, total_score numeric, impact_status text, point_impact numeric, doctor_points_impact numeric,
  manager_reviewed_at timestamptz, manager_reviewed_by text, automatic_evaluation_version text, evaluation_kind text,
  is_current boolean default true, superseded_at timestamptz, whatsapp_review_source_id uuid, sales_intelligence_case_id text);
create view public.conversation_sales_reviews_canonical_v2 with (security_invoker = true) as
  select * from public.conversation_sales_reviews r
  where coalesce(r.is_current, true) and (r.whatsapp_review_source_id is null
    or exists (select 1 from public.whatsapp_operational_canonical_sources_v1 s where s.source_id = r.whatsapp_review_source_id));
-- Production pre-change definition: same 103 columns, canonical-source membership only.
create view public.conversation_sales_reviews_official_v1 with (security_invoker = true) as
  select id, reviewer_id, reviewer_name, reviewer_role, staff_id, staff_name, staff_role, branch, customer_id, customer_name, customer_code, customer_phone, evaluation_kind, invoice_number, invoice_time, evaluation_reason, total_score, raw_scores, has_complaint, has_medical_error, has_invoice_error, reviewer_notes, training_recommendation, final_score, point_impact, impact_status, reviewed_at, created_at, base_score, positive_points, negative_points, severe_error_points, doctor_points_impact, conversation_level, top_positive_reason, top_deduction_reason, forgotten_customer, missed_sale_opportunity, has_critical_error, repeated_error_type, repeat_count, repeat_multiplier, month_cycle, doctor_id, branch_id, conversation_date, conversation_type, level, base_points_impact, extra_penalty_points, total_applicable_items, total_not_applicable_items, total_applicable_points, earned_points, main_positive_reason, main_negative_reason, review_items, first_customer_message_at, first_staff_reply_at, first_response_minutes, response_speed_score, greeting_score, greeting_message_used, doctor_name_used_in_greeting, doctor_name_used, doctor_name_score, customer_name_used, customer_name_score, tone_language_score, bad_tone_flag, severe_bad_tone_flag, understanding_score, rushed_response_flag, misunderstood_customer_flag, follow_up_promised, follow_up_delay_minutes, follow_up_score, consultation_quality_score, dosage_explanation_score, alternative_handling_score, bad_alternative_flag, sales_quality_score, upsell_cross_sell_score, successful_cross_sell, complaint_handling_score, handled_angry_customer_well, excellent_case, order_confirmation_score, has_delivery_issue, missed_sales_opportunity, closing_message_score, closing_message_used, updated_at, doctor_name, review_date, reviewer_message, manager_review_score, manager_review_notes, manager_reviewed_by, manager_reviewed_at, converted_to_sale, submission_fingerprint, whatsapp_review_source_id
  from public.conversation_sales_reviews r
  where r.whatsapp_review_source_id is null
    or exists (select 1 from public.whatsapp_operational_canonical_sources_v1 o where o.source_id = r.whatsapp_review_source_id);
create table public.employee_transactions(
  id uuid primary key default gen_random_uuid(), staff_id uuid, type text default 'reward', points numeric, amount numeric,
  source text, source_id uuid, status text, month_cycle text, created_at timestamptz default now(), updated_at timestamptz default now());
create index on public.employee_transactions(source, source_id);
create view public.customer_followup_operations_v2 as
  select null::uuid id, null::uuid staff_id, null::uuid assigned_staff_id, null::text requested_by_staff_id,
    null::text assigned_to_staff_id, null::text handled_by_staff_id, false is_hidden, null::timestamptz archived_at,
    now() created_at where false;
create table public.attendance(staff_id text, attendance_date date, date date);
create table public.staff_attendance_logs(staff_id uuid, status text, shift_date date);
