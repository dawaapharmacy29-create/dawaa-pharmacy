-- EMERGENCY ROLLBACK for the 20261017 security identity hardening candidates (090000-090600).
-- Restores the exact pre-change Production bodies (captured read-only 2026-10-16), the 15 policy
-- expressions and the 7 client grants. THIS RE-OPENS the x-dawaa-user-id and p_actor_id exposures:
-- use only for a confirmed functional emergency, then re-apply the forward fix.
-- Business rows are not touched. Run as one transaction.
begin;

-- 1. Function bodies (CREATE OR REPLACE keeps owner and EXECUTE grants).
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
$function$
;

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
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.app_staff_role(p_actor_id text)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select lower(coalesce(role, ''))
  from public.staff_accounts
  where id::text = p_actor_id
    and coalesce(active, true) = true
    and coalesce(can_login, true) = true
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.app_actor_is_team_dawaa(p_actor_id text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.staff_accounts sa
    join public.assistant_operational_eligible_staff e on e.staff_id::text = sa.staff_id
    where sa.id::text = p_actor_id
      and coalesce(sa.active, true)
      and coalesce(sa.can_login, true)
  )
$function$
;

CREATE OR REPLACE FUNCTION public.dawaa_can_read_conversation_review_row_v2(p_actor_id uuid, p_staff_id uuid, p_doctor_id uuid, p_branch text, p_reviewer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with me as (
    select sa.* from public.staff_accounts sa
    where sa.id = p_actor_id and coalesce(sa.active,false) and coalesce(sa.can_login,false)
    limit 1
  )
  select exists (
    select 1 from me
    where lower(trim(coalesce(me.role,''))) in ('general_manager','executive_manager','branches_manager','admin','team_dawaa_alpha')
      or me.id = p_reviewer_id
      or me.staff_id = p_staff_id::text
      or me.staff_id = p_doctor_id::text
      or (
        lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
        and public.dawaa_customer_request_branch_key(me.branch) is not null
        and public.dawaa_customer_request_branch_key(me.branch)=public.dawaa_customer_request_branch_key(p_branch)
      )
  )
$function$
;

CREATE OR REPLACE FUNCTION public.dawaa_shortage_permission_allowed_v1(p_actor_id uuid, p_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_role text;
  v_permissions jsonb := '{}'::jsonb;
  v_override boolean;
  v_role_allowed boolean := false;
begin
  if p_actor_id is null or p_permission not in ('view_shortages','manage_shortages') then
    return false;
  end if;

  select lower(trim(coalesce(sa.role,''))),coalesce(sa.permissions,'{}'::jsonb)
    into v_role,v_permissions
  from public.staff_accounts sa
  where sa.id=p_actor_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if not found then return false; end if;

  if p_permission='view_shortages' then
    v_role_allowed := v_role in (
      'general_manager','executive_manager','branches_manager','admin',
      'branch_manager','procurement_manager','inventory_assistant'
    );
  else
    v_role_allowed := v_role in (
      'general_manager','executive_manager','branches_manager','admin',
      'branch_manager','procurement_manager','inventory_assistant'
    );
  end if;

  if v_permissions ? p_permission then
    v_role_allowed := v_role_allowed and coalesce((v_permissions->>p_permission)::boolean,false);
  end if;

  select spo.allowed
    into v_override
  from public.staff_permission_overrides spo
  where spo.staff_account_id=p_actor_id
    and spo.permission_key=p_permission
  order by spo.created_at desc,spo.id desc
  limit 1;

  if found then
    v_role_allowed := v_role_allowed and coalesce(v_override,false);
  end if;

  return v_role_allowed;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.dawaa_customer_service_queue_scope_v3(p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select case
    when lower(coalesce(a.role,'')) in ('admin','owner','general_manager','executive_manager','branches_manager','manager') then 'ALL'
    when lower(coalesce(a.role,'')) in ('branch_manager','customer_service_manager','customer_service','pharmacist','shift_supervisor_morning','shift_supervisor_evening','shift_supervisor_night')
      then lower(btrim(coalesce(a.branch,'')))
    when a.role = 'team_dawaa_alpha' and a.staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and exists (
      select 1 from public.dawaa_team_alpha_my_track_v1(a.staff_id::uuid, (timezone('Africa/Cairo', now()))::date) t
      where t.track in ('cs_shami', 'cs_shokry')
    ) then (
      select lower(btrim(t.branch))
      from public.dawaa_team_alpha_my_track_v1(a.staff_id::uuid, (timezone('Africa/Cairo', now()))::date) t
      where t.track in ('cs_shami', 'cs_shokry')
      limit 1
    )
    else ''
  end
  from public.staff_accounts a
  where a.id = coalesce(p_actor_id, public.dawaa_current_staff_account_id_strict())
    and coalesce(a.active,false) and coalesce(a.can_login,false)
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.dawaa_can_access_customer_intelligence_branch_v2(p_branch text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.staff_accounts a
    where a.id = coalesce(p_actor_id, public.dawaa_current_staff_account_id_strict())
      and coalesce(a.active,false) and coalesce(a.can_login,false)
      and (
        lower(coalesce(a.role,'')) in ('admin','owner','general_manager','executive_manager','branches_manager','manager')
        or (
          lower(coalesce(a.role,'')) in ('customer_service_manager','customer_service')
          and lower(btrim(coalesce(a.branch,'')))=lower(btrim(coalesce(p_branch,'')))
        )
      )
  )
$function$
;

CREATE OR REPLACE FUNCTION public.dawaa_can_manage_customer_intelligence_v2(p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.staff_accounts a
    where a.id = coalesce(p_actor_id, public.dawaa_current_staff_account_id_strict())
      and coalesce(a.active, false) and coalesce(a.can_login, false)
      and lower(coalesce(a.role, '')) in (
        'admin','owner','general_manager','executive_manager','branches_manager',
        'customer_service_manager','customer_service','manager'
      )
  )
$function$
;

CREATE OR REPLACE FUNCTION public.customer_followup_performance_v1(p_actor_id text, p_branch text DEFAULT 'كل الفروع'::text, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor record;
  v_branch text;
  v_daily jsonb;
  v_summary jsonb;
begin
  select a.id,a.staff_id,lower(coalesce(a.role,'')) role,coalesce(a.branch,'') branch
  into v_actor
  from public.staff_accounts a
  where (a.id::text=p_actor_id or a.staff_id::text=p_actor_id or lower(a.username)=lower(p_actor_id))
    and coalesce(a.active,false)=true and coalesce(a.can_login,false)=true
  order by case when a.id::text=p_actor_id then 0 when a.staff_id::text=p_actor_id then 1 else 2 end
  limit 1;
  if not found then raise exception 'unauthorized'; end if;
  if p_from is null or p_to is null or p_from>p_to then raise exception 'invalid date range'; end if;
  if p_to-p_from>366 then raise exception 'date range too large'; end if;

  v_branch:=coalesce(nullif(btrim(p_branch),''),'كل الفروع');
  if v_actor.role not in ('general_manager','branches_manager','executive_manager') then
    v_branch:=case when v_actor.branch in ('فرع الشامي','فرع شكري') then v_actor.branch else v_branch end;
  end if;
  if v_branch not in ('كل الفروع','فرع الشامي','فرع شكري') then raise exception 'invalid branch'; end if;

  with base as materialized (
    select
      (coalesce(d.contacted_at,d.completed_at,d.created_at) at time zone 'Africa/Cairo')::date activity_date,
      case when d.branch ilike '%الشامي%' then 'فرع الشامي'
           when d.branch ilike '%شكري%' then 'فرع شكري'
           else coalesce(nullif(d.branch,''),'غير محدد') end normalized_branch,
      d.contacted_at,d.completed_at,d.contact_status,d.response_status,d.followup_result,
      d.status,d.followup_status,d.needs_next_followup,d.purchase_after_followup,d.purchase_amount
    from public.daily_followups d
    where (coalesce(d.contacted_at,d.completed_at,d.created_at) at time zone 'Africa/Cairo')::date between p_from and p_to
  ), scoped as materialized (
    select * from base b where v_branch='كل الفروع' or b.normalized_branch=v_branch
  ), days as (
    select g::date activity_date from generate_series(p_from,p_to,interval '1 day') g
  ), agg as materialized (
    select s.activity_date,
      count(*) total,
      count(*) filter(where s.contacted_at is not null or s.contact_status in ('responded','no_answer') or s.response_status in ('responded','no_answer')) contacted,
      count(*) filter(where s.contact_status='responded' or s.response_status='responded') responded,
      count(*) filter(where s.contact_status='no_answer' or s.response_status='no_answer' or s.followup_result='لم يرد') no_answer,
      count(*) filter(where s.status='completed' or s.followup_status='completed') completed,
      count(*) filter(where s.followup_status='scheduled' or s.needs_next_followup is true) scheduled,
      count(*) filter(where s.purchase_after_followup is true) purchased,
      coalesce(sum(coalesce(s.purchase_amount,0)) filter(where s.purchase_after_followup is true),0) purchase_value
    from scoped s group by s.activity_date
  ), daily_data as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'date',d.activity_date,'total',coalesce(a.total,0),'contacted',coalesce(a.contacted,0),
      'responded',coalesce(a.responded,0),'noAnswer',coalesce(a.no_answer,0),
      'completed',coalesce(a.completed,0),'scheduled',coalesce(a.scheduled,0),
      'purchased',coalesce(a.purchased,0),'purchaseValue',coalesce(a.purchase_value,0)
    ) order by d.activity_date),'[]'::jsonb) daily
    from days d left join agg a using(activity_date)
  ), summary_data as (
    select jsonb_build_object(
      'total',coalesce(sum(a.total),0),'contacted',coalesce(sum(a.contacted),0),
      'responded',coalesce(sum(a.responded),0),'noAnswer',coalesce(sum(a.no_answer),0),
      'completed',coalesce(sum(a.completed),0),'scheduled',coalesce(sum(a.scheduled),0),
      'purchased',coalesce(sum(a.purchased),0),'purchaseValue',coalesce(sum(a.purchase_value),0)
    ) summary from agg a
  )
  select d.daily,s.summary into v_daily,v_summary from daily_data d cross join summary_data s;

  return jsonb_build_object('branch',v_branch,'from',p_from,'to',p_to,'summary',v_summary,'daily',v_daily);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_customer_followup_records_v1(p_actor_id text, p_branch text DEFAULT 'كل الفروع'::text, p_mode text DEFAULT 'completed'::text, p_search text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor record;
  v_branch text;
  v_limit integer := greatest(1, least(coalesce(p_limit,50), 200));
  v_offset integer := greatest(0, coalesce(p_offset,0));
  v_mode text := lower(coalesce(nullif(btrim(p_mode),''),'completed'));
  v_search text := nullif(btrim(coalesce(p_search,'')),'');
  v_rows jsonb;
  v_total bigint;
begin
  select a.id,a.staff_id,lower(coalesce(a.role,'')) role,coalesce(a.branch,'') branch
    into v_actor
  from public.staff_accounts a
  where (a.id::text=p_actor_id or a.staff_id::text=p_actor_id or lower(a.username)=lower(p_actor_id))
    and coalesce(a.active,false)=true and coalesce(a.can_login,false)=true
  order by case when a.id::text=p_actor_id then 0 when a.staff_id::text=p_actor_id then 1 else 2 end
  limit 1;
  if not found then raise exception 'unauthorized'; end if;

  if v_mode not in ('exceptional','waiting','no_answer','completed','performance') then raise exception 'invalid mode'; end if;
  if p_from is not null and p_to is not null and p_from>p_to then raise exception 'invalid date range'; end if;
  if p_from is not null and p_to is not null and p_to-p_from>366 then raise exception 'date range too large'; end if;

  v_branch:=coalesce(nullif(btrim(p_branch),''),'كل الفروع');
  if v_actor.role not in ('general_manager','branches_manager','executive_manager') then
    v_branch:=case when v_actor.branch in ('فرع الشامي','فرع شكري') then v_actor.branch else v_branch end;
  end if;
  if v_branch not in ('كل الفروع','فرع الشامي','فرع شكري') then raise exception 'invalid branch'; end if;

  with base as materialized (
    select d.*,
      lower(concat_ws(' ',d.followup_status,d.status,d.contact_status,d.response_status,d.followup_result,d.contact_result)) as combined_status,
      coalesce(d.completed_at,d.closed_at,d.updated_at,d.created_at) as effective_completed_at,
      lower(concat_ws(' ',d.request_type,d.request_source,d.followup_reason,d.notes)) as request_text,
      (d.needs_next_followup is true and d.next_followup_date is not null) as has_next
    from public.daily_followups d
    where (v_branch='كل الفروع' or d.branch=v_branch)
      and (p_from is null or coalesce(d.completed_at,d.closed_at,d.updated_at,d.created_at)::date >= p_from)
      and (p_to is null or coalesce(d.completed_at,d.closed_at,d.updated_at,d.created_at)::date <= p_to)
      and (
        v_search is null
        or coalesce(d.customer_name,d.name,'') ilike '%'||v_search||'%'
        or coalesce(d.customer_code,'') ilike '%'||v_search||'%'
        or coalesce(d.customer_phone,d.phone,'') ilike '%'||v_search||'%'
      )
  ), classified as materialized (
    select b.*,
      (b.combined_status ~ '(cancel|cancelled|archived|ملغي|ملغاة|مؤرشف|الأرشيف)') as is_cancelled,
      (
        not (b.combined_status ~ '(cancel|cancelled|archived|ملغي|ملغاة|مؤرشف|الأرشيف)')
        and not b.has_next
        and (
          b.completed_at is not null or b.closed_at is not null
          or b.combined_status ~ '(completed|closed|resolved|مكتمل|تم الشراء|تم الحل|تم التنفيذ|تم الرد|رد العميل|replied|customer_replied)'
        )
      ) as is_completed
    from base b
  ), scoped as materialized (
    select c.* from classified c
    where case v_mode
      when 'exceptional' then c.request_text ~ '(exceptional_followup|متابعة استثنائية)' and not c.is_completed and not c.is_cancelled
      when 'waiting' then not c.is_completed and not c.is_cancelled and c.combined_status ~ '(waiting|awaiting|sent|message_sent|انتظار الرد|في انتظار|تم الإرسال|تم ارسال|بعتنا|أرسلنا)'
      when 'no_answer' then not c.is_completed and not c.is_cancelled and c.combined_status ~ '(no.?answer|unreachable|لم يرد|لا يرد|مغلق|غير متاح)'
      when 'completed' then c.is_completed and coalesce(c.import_source,'') <> 'historical_excel_import'
      when 'performance' then c.is_completed
      else false end
  ), counted as (select count(*)::bigint total from scoped),
  paged as (
    select s.* from scoped s
    order by s.created_at desc nulls last,s.id
    limit v_limit offset v_offset
  )
  select
    coalesce(jsonb_agg(to_jsonb(p) - 'combined_status' - 'effective_completed_at' - 'request_text' - 'has_next' - 'is_cancelled' - 'is_completed' order by p.created_at desc nulls last,p.id),'[]'::jsonb),
    (select total from counted)
  into v_rows,v_total
  from paged p;

  return jsonb_build_object('branch',v_branch,'mode',v_mode,'total',coalesce(v_total,0),'limit',v_limit,'offset',v_offset,'rows',coalesce(v_rows,'[]'::jsonb));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_customer_welcome_message_status(p_id uuid, p_status text, p_actor_id text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text)
 RETURNS customer_welcome_message_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.customer_welcome_message_logs;
begin
  if not (
    public.app_role_allowed(p_actor_id, array['general_manager','admin','customer_service_manager','customer_service','branch_manager','pharmacist'])
    or public.app_actor_is_team_dawaa(p_actor_id)
  ) then
    raise exception 'ليس لديك صلاحية تحديث الرسائل الترحيبية';
  end if;

  update public.customer_welcome_message_logs
  set status = coalesce(nullif(trim(p_status), ''), status),
      sent_by = coalesce(p_actor_id, sent_by),
      sent_by_name = coalesce(p_actor_name, sent_by_name)
  where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'لم يتم العثور على الرسالة الترحيبية';
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_quick_reply_script(p_id uuid, p_shortcut text, p_title text, p_category text, p_script_type text, p_doctor_name text, p_branch text, p_message_body text, p_questions jsonb, p_suggested_products jsonb, p_tags jsonb, p_active boolean, p_actor_id text, p_actor_name text)
 RETURNS quick_reply_scripts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.quick_reply_scripts;
  v_questions text[];
  v_suggested_products text[];
  v_tags text[];
begin
  if not public.app_role_allowed(p_actor_id, array['general_manager','admin','customer_service_manager','customer_service','branch_manager']) then
    raise exception 'ليس لديك صلاحية حفظ الردود السريعة أو لم يتم تفعيل صلاحيات الجدول.';
  end if;

  v_questions := case when p_questions is null then array[]::text[] when jsonb_typeof(p_questions) = 'array' then array(select jsonb_array_elements_text(p_questions)) else array[]::text[] end;
  v_suggested_products := case when p_suggested_products is null then array[]::text[] when jsonb_typeof(p_suggested_products) = 'array' then array(select jsonb_array_elements_text(p_suggested_products)) else array[]::text[] end;
  v_tags := case when p_tags is null then array[]::text[] when jsonb_typeof(p_tags) = 'array' then array(select jsonb_array_elements_text(p_tags)) else array[]::text[] end;

  if p_id is not null then
    update public.quick_reply_scripts
    set shortcut = case when left(trim(p_shortcut), 1) = '/' then trim(p_shortcut) else '/' || trim(p_shortcut) end,
        title = trim(p_title),
        category = coalesce(nullif(trim(p_category), ''), 'عام'),
        script_type = coalesce(nullif(trim(p_script_type), ''), 'quick_reply'),
        doctor_name = nullif(trim(coalesce(p_doctor_name, '')), ''),
        branch = nullif(trim(coalesce(p_branch, '')), ''),
        message_body = trim(p_message_body),
        questions = v_questions,
        suggested_products = v_suggested_products,
        tags = v_tags,
        active = coalesce(p_active, true),
        created_by = coalesce(created_by, p_actor_id),
        created_by_name = coalesce(created_by_name, p_actor_name),
        updated_at = now()
    where id = p_id
    returning * into v_row;
  else
    insert into public.quick_reply_scripts (
      shortcut, title, category, script_type, doctor_name, branch, message_body,
      questions, suggested_products, tags, active, usage_count, created_by, created_by_name, created_at, updated_at
    ) values (
      case when left(trim(p_shortcut), 1) = '/' then trim(p_shortcut) else '/' || trim(p_shortcut) end,
      trim(p_title),
      coalesce(nullif(trim(p_category), ''), 'عام'),
      coalesce(nullif(trim(p_script_type), ''), 'quick_reply'),
      nullif(trim(coalesce(p_doctor_name, '')), ''),
      nullif(trim(coalesce(p_branch, '')), ''),
      trim(p_message_body),
      v_questions,
      v_suggested_products,
      v_tags,
      coalesce(p_active, true),
      0,
      p_actor_id,
      p_actor_name,
      now(),
      now()
    ) returning * into v_row;
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_weekly_manager_metrics_cached_v1(p_actor_id uuid, p_evaluation_type text, p_branch text, p_week_start date, p_week_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor_role text;
  v_branch_key text := coalesce(p_branch,'');
  v_metrics jsonb;
begin
  if p_week_start is null or p_week_end is null or p_week_end < p_week_start then
    raise exception 'invalid period';
  end if;

  select lower(coalesce(a.role,'')) into v_actor_role
  from public.staff_accounts a
  where a.id=p_actor_id
    and coalesce(a.active,false)=true
    and coalesce(a.can_login,false)=true
  limit 1;

  if v_actor_role is null then raise exception 'unauthorized'; end if;
  if p_evaluation_type='branch_manager' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type='branches_manager' and v_actor_role <> 'general_manager' then raise exception 'not allowed'; end if;
  if p_evaluation_type='customer_service' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type not in ('branch_manager','branches_manager','customer_service') then raise exception 'invalid evaluation type'; end if;

  select c.metrics into v_metrics
  from public.manager_weekly_metrics_cache c
  where c.evaluation_type=p_evaluation_type
    and c.branch_key=v_branch_key
    and c.week_start=p_week_start
    and c.week_end=p_week_end;

  return v_metrics;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_weekly_manager_metrics_fast_v1(p_actor_id uuid, p_evaluation_type text, p_branch text, p_week_start date, p_week_end date, p_max_age_seconds integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor_role text;
  v_branch_key text := coalesce(p_branch,'');
  v_metrics jsonb;
  v_refreshed_at timestamptz;
begin
  if p_week_start is null or p_week_end is null or p_week_end < p_week_start then raise exception 'invalid period'; end if;
  select lower(coalesce(a.role,'')) into v_actor_role
  from public.staff_accounts a
  where a.id=p_actor_id
    and coalesce(a.active,false)=true
    and coalesce(a.can_login,false)=true
  limit 1;
  if v_actor_role is null then raise exception 'unauthorized'; end if;
  if p_evaluation_type='branch_manager' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type='branches_manager' and v_actor_role <> 'general_manager' then raise exception 'not allowed'; end if;
  if p_evaluation_type='customer_service' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type not in ('branch_manager','branches_manager','customer_service') then raise exception 'invalid evaluation type'; end if;

  select c.metrics,c.refreshed_at into v_metrics,v_refreshed_at
  from public.manager_weekly_metrics_cache c
  where c.evaluation_type=p_evaluation_type
    and c.branch_key=v_branch_key
    and c.week_start=p_week_start
    and c.week_end=p_week_end;

  if v_metrics is not null and v_refreshed_at >= now() - make_interval(secs => greatest(30,coalesce(p_max_age_seconds,300))) then
    return v_metrics;
  end if;

  v_metrics := public.calculate_weekly_manager_metrics_v5(p_evaluation_type,p_branch,p_week_start,p_week_end);
  insert into public.manager_weekly_metrics_cache(evaluation_type,branch_key,week_start,week_end,metrics,refreshed_at)
  values(p_evaluation_type,v_branch_key,p_week_start,p_week_end,v_metrics,now())
  on conflict(evaluation_type,branch_key,week_start,week_end)
  do update set metrics=excluded.metrics, refreshed_at=excluded.refreshed_at;
  return v_metrics;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.list_weekly_manager_evaluation_subjects_v1(p_actor_id uuid, p_evaluation_type text)
 RETURNS TABLE(id uuid, name text, role text, branch text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor_role text;
begin
  select lower(coalesce(a.role,'')) into v_actor_role
  from public.staff_accounts a
  where a.id=p_actor_id
    and coalesce(a.active,false)=true
    and coalesce(a.can_login,false)=true
  limit 1;

  if v_actor_role is null then raise exception 'unauthorized'; end if;
  if p_evaluation_type='branch_manager' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type='branches_manager' and v_actor_role not in ('general_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type='customer_service' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type not in ('branch_manager','branches_manager','customer_service') then raise exception 'invalid evaluation type'; end if;

  return query
  select s.id, btrim(s.name), lower(sa.role), coalesce(s.branch,'')
  from public.staff s
  join public.staff_accounts sa
    on sa.staff_id=s.id::text
   and coalesce(sa.active,false)=true
   and coalesce(sa.can_login,false)=true
  where coalesce(s.active,s.is_active,true)=true
    and not (coalesce(s.status,'') ~* 'inactive|disabled|archived|موقوف|غير نشط')
    and (
      (p_evaluation_type='branch_manager' and lower(sa.role)='branch_manager')
      or (p_evaluation_type='branches_manager' and lower(sa.role)='branches_manager')
      or (p_evaluation_type='customer_service' and lower(sa.role) in ('customer_service_manager','team_dawaa_alpha'))
    )
  order by coalesce(s.branch,''), btrim(s.name);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.dawaa_can_manage_branch_targets(p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_id uuid := coalesce(p_actor_id, public.dawaa_request_staff_id());
  v_role text;
  v_permissions jsonb;
begin
  if v_id is null then return false; end if;

  select lower(trim(coalesce(sa.role,''))), public.get_user_permissions(sa.id)
    into v_role, v_permissions
  from public.staff_accounts sa
  where sa.id = v_id
    and coalesce(sa.active,false) = true
    and coalesce(sa.can_login,false) = true
  limit 1;

  if not found then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','branch_manager') then return true; end if;
  return coalesce((v_permissions ->> 'manage_settings')::boolean,false);
end;
$function$
;

-- 2. Policies: drop + recreate inside this transaction (never absent to other sessions).
drop policy if exists employee_compensation_admin_delete_v2 on public.employee_compensation_profiles;
create policy employee_compensation_admin_delete_v2 on public.employee_compensation_profiles as permissive for delete to authenticated, anon using ((EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text]))))));
drop policy if exists employee_compensation_admin_insert_v2 on public.employee_compensation_profiles;
create policy employee_compensation_admin_insert_v2 on public.employee_compensation_profiles as permissive for insert to authenticated, anon with check ((EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text]))))));
drop policy if exists employee_compensation_admin_update_v2 on public.employee_compensation_profiles;
create policy employee_compensation_admin_update_v2 on public.employee_compensation_profiles as permissive for update to authenticated, anon using ((EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text])))))) with check ((EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text]))))));
drop policy if exists employee_compensation_read_v2 on public.employee_compensation_profiles;
create policy employee_compensation_read_v2 on public.employee_compensation_profiles as permissive for select to authenticated, anon using (((staff_id = dawaa_current_staff_id_v1()) OR (EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text, 'branches_manager'::text])))))));
drop policy if exists employee_events_insert_v1 on public.employee_events;
create policy employee_events_insert_v1 on public.employee_events as permissive for insert to authenticated, anon with check (((actor_user_id IS NULL) OR (actor_user_id = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text))));
drop policy if exists employee_events_self_read_v1 on public.employee_events;
create policy employee_events_self_read_v1 on public.employee_events as permissive for select to authenticated, anon using (((subject_staff_id = dawaa_current_staff_id_v1()) OR (EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text, 'branches_manager'::text])))))));
drop policy if exists employee_statements_admin_delete_v2 on public.employee_monthly_statements;
create policy employee_statements_admin_delete_v2 on public.employee_monthly_statements as permissive for delete to authenticated, anon using ((EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text]))))));
drop policy if exists employee_statements_admin_insert_v2 on public.employee_monthly_statements;
create policy employee_statements_admin_insert_v2 on public.employee_monthly_statements as permissive for insert to authenticated, anon with check ((EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text]))))));
drop policy if exists employee_statements_admin_update_v2 on public.employee_monthly_statements;
create policy employee_statements_admin_update_v2 on public.employee_monthly_statements as permissive for update to authenticated, anon using ((EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text])))))) with check ((EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text]))))));
drop policy if exists employee_statements_read_v2 on public.employee_monthly_statements;
create policy employee_statements_read_v2 on public.employee_monthly_statements as permissive for select to authenticated, anon using (((staff_id = dawaa_current_staff_id_v1()) OR (EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text, 'branches_manager'::text])))))));
drop policy if exists manager_daily_checklist_self_v1 on public.manager_daily_checklist;
create policy manager_daily_checklist_self_v1 on public.manager_daily_checklist as permissive for all to authenticated, anon using ((((staff_id)::text = dawaa_current_staff_id_v1()) OR (EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text, 'branches_manager'::text]))))))) with check ((((staff_id)::text = dawaa_current_staff_id_v1()) OR (EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text, 'branches_manager'::text])))))));
drop policy if exists manager_weekly_evaluations_admin_delete_v2 on public.manager_weekly_evaluations;
create policy manager_weekly_evaluations_admin_delete_v2 on public.manager_weekly_evaluations as permissive for delete to authenticated, anon using ((EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text, 'branches_manager'::text]))))));
drop policy if exists manager_weekly_evaluations_admin_insert_v2 on public.manager_weekly_evaluations;
create policy manager_weekly_evaluations_admin_insert_v2 on public.manager_weekly_evaluations as permissive for insert to authenticated, anon with check ((EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text, 'branches_manager'::text]))))));
drop policy if exists manager_weekly_evaluations_admin_update_v2 on public.manager_weekly_evaluations;
create policy manager_weekly_evaluations_admin_update_v2 on public.manager_weekly_evaluations as permissive for update to authenticated, anon using ((EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text, 'branches_manager'::text])))))) with check ((EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text, 'branches_manager'::text]))))));
drop policy if exists manager_weekly_evaluations_read_v2 on public.manager_weekly_evaluations;
create policy manager_weekly_evaluations_read_v2 on public.manager_weekly_evaluations as permissive for select to authenticated, anon using ((((subject_staff_id)::text = dawaa_current_staff_id_v1()) OR ((evaluator_staff_id)::text = dawaa_current_staff_id_v1()) OR (EXISTS ( SELECT 1    FROM staff_accounts sa   WHERE (((sa.id)::text = COALESCE(((( SELECT current_setting('request.headers'::text, true) AS current_setting))::jsonb ->> 'x-dawaa-user-id'::text), (( SELECT auth.uid() AS uid))::text)) AND (sa.role = ANY (ARRAY['general_manager'::text, 'executive_manager'::text, 'branches_manager'::text])))))));

-- 3. Client grants removed by 20261017090600.
grant execute on function public.calculate_customer_loyalty_cycle_internal_v1(uuid,date,date,numeric,text,text) to anon, authenticated;
grant execute on function public.submit_customer_loyalty_approval_internal_v1(uuid,date,date,numeric,text,text,text) to anon, authenticated;
grant execute on function public.review_customer_loyalty_approval_internal_v1(uuid,text,text,text) to anon, authenticated;
grant execute on function public.insert_customer_points_ledger_internal_v1(jsonb) to anon, authenticated;
grant execute on function public.upsert_customer_loyalty_setting_internal_v1(jsonb) to anon, authenticated;
grant execute on function public.set_branch_daily_task_status(uuid,text,uuid,text,text,text) to anon, authenticated;
grant execute on function public.save_branch_sales_target_v2(uuid,text,numeric) to anon, authenticated;

-- 4. Primitives introduced by 20261017090000 (nothing references them after step 1).
drop function if exists public.dawaa_bind_actor_v1(uuid);
drop function if exists public.dawaa_bind_actor_v1(text);
drop function if exists public.dawaa_request_context_is_client_v1();

commit;
