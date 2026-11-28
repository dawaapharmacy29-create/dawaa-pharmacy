create or replace function public.dawaa_cs_named_report_v1(p_day date, p_branch text)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_key bytea;
begin
  perform public.dawaa_cs_tasks_actor_v1(true);
  if p_branch is null or p_branch not in ('فرع شكري','فرع الشامي')
      or p_day is null or p_day > v_today or p_day < v_today - 90 then
    raise exception 'invalid_report_scope' using errcode = '22023';
  end if;
  select secret into strict v_key from internal.cs_report_key_v1;
  return (
    with tasks as materialized (
      select q.queue_date as day,
        case when q.assigned_staff_id is not null then
          'S-' || substr(encode(extensions.hmac('staff:' || q.assigned_staff_id::text, encode(v_key,'hex'),'sha256'),'hex'),1,16)
        end as staff_code,
        'C-' || substr(encode(extensions.hmac('customer:' || coalesce(q.customer_id::text,
          case when nullif(q.customer_code,'') is not null then q.branch || ':' || q.customer_code end,
          q.id::text), encode(v_key,'hex'),'sha256'),'hex'),1,20) as masked_code,
        case when q.source in ('regular_due','important','lost','yesterday','declining','at_risk',
          'doctor_request','big_invoice','new_customer','uncoded_note') then q.source else 'other' end as task_type,
        nullif(btrim(sa.name), '') as staff_name,
        nullif(btrim(regexp_replace(translate(coalesce(nullif(c.name,''), q.customer_name, ''),
          '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'), '\+?([0-9][[:space:]().-]*){7,}', '', 'g')), '') as customer_name,
        case when q.customer_code ~ '^[0-9]{1,9}$' then q.customer_code end as display_code,
        q.completed_at, q.status, q.reach, c.id as customer_id, q.customer_code,
        case q.source when 'important' then 'مهم' when 'regular_due' then 'مستمر'
          when 'at_risk' then 'معرض يوقف' when 'declining' then 'معرض يوقف'
          when 'new_customer' then 'جديد' end as segment_at_followup,
        case when coalesce(c.customer_segment,c.segment) in ('مهم','مهم جدًا','مهم جدا') then 'مهم'
          when c.retention_status = 'active' then 'مستمر'
          when c.retention_status in ('at_risk','stopped') then 'معرض يوقف'
          when c.retention_status = 'new' then 'جديد' end as current_segment
      from public.customer_service_daily_queue_items q
      left join public.staff_accounts sa on sa.id::text = q.assigned_staff_id
      left join lateral (
        select c.id,c.name,c.customer_segment,c.segment,c.retention_status
        from public.customers c
        where c.id = case when q.customer_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            then q.customer_id::uuid end
          or (nullif(q.customer_id,'') is null and nullif(q.customer_code,'') is not null
              and c.customer_code = q.customer_code and c.branch = q.branch
              and coalesce(c.is_duplicate,false) = false)
        order by c.updated_at desc nulls last, c.id
        limit 1
      ) c on true
      where q.queue_date = p_day and q.branch = p_branch
        and coalesce(q.status,'') not in ('cancelled','canceled')
    ), details as materialized (
      select t.*, coalesce(s.invoices,'[]'::jsonb) as sales, coalesce(s.bought,false) as bought
      from tasks t
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'day', (v.invoice_date at time zone 'Africa/Cairo')::date,
          'branch', v.branch, 'amount', coalesce(v.net_amount,v.total_amount),
          'timing', case when (v.invoice_date at time zone 'Africa/Cairo')::date < p_day then 'قبل'
                         when (v.invoice_date at time zone 'Africa/Cairo')::date > p_day then 'بعد'
                         else 'نفس اليوم' end
        ) order by v.invoice_date) as invoices,
        bool_or((v.invoice_date at time zone 'Africa/Cairo')::date >
          (t.completed_at at time zone 'Africa/Cairo')::date) as bought
        from public.sales_invoices v
        where v.invoice_date >= ((p_day-7)::timestamp at time zone 'Africa/Cairo')
          and v.invoice_date < ((p_day+8)::timestamp at time zone 'Africa/Cairo')
          and (v.customer_id = t.customer_id or
            (v.branch = p_branch and nullif(t.customer_code,'') is not null and v.customer_code = t.customer_code
             and (t.customer_id is null or v.customer_id is null)))
          and v.branch in ('فرع شكري','فرع الشامي')
          and coalesce(v.net_amount,v.total_amount,0) > 0
          and coalesce(v.invoice_type,'') !~ 'مرتجع|ملغ'
          and coalesce(v.save_status,'') !~* 'cancel|void|ملغ'
          and v.customer_code is distinct from '10' and v.customer_code is distinct from '170'
      ) s on true
    )
    select jsonb_build_object(
      'day', p_day, 'branch', p_branch, 'generated_at', now(),
      'team', coalesce((select jsonb_agg(to_jsonb(a) order by a.staff_code) from (
        select staff_code, max(staff_name) as staff_name, count(*) as due,
          count(*) filter (where completed_at is not null or status = 'completed') as completed,
          count(*) filter (where completed_at is null and status is distinct from 'completed' and p_day < v_today) as overdue,
          count(distinct masked_code) filter (where reach = 'answered') as replied
        from tasks group by staff_code
      ) a),'[]'::jsonb),
      'replied', (select count(distinct masked_code) from tasks where reach = 'answered'),
      'followups', coalesce((select jsonb_agg(jsonb_build_object(
        'day', day, 'staff_code', staff_code, 'staff_name', staff_name, 'task_type', task_type,
        'customer_name', customer_name, 'customer_code', display_code,
        'completed_at', completed_at, 'completed', coalesce(completed_at is not null or status = 'completed', false),
        'reply', case reach when 'answered' then 'رد' when 'no_answer' then 'ماردش' end,
        'bought_after', bought, 'segment_at_followup', segment_at_followup,
        'current_segment', current_segment, 'sales', sales
      ) order by staff_code, masked_code) from details),'[]'::jsonb),
      'uploads', jsonb_build_array(
        jsonb_build_object('kind','المبيعات','at',(select max(created_at) from public.sales_invoices
          where branch = p_branch and invoice_date >= (p_day::timestamp at time zone 'Africa/Cairo')
            and invoice_date < ((p_day+1)::timestamp at time zone 'Africa/Cairo'))),
        jsonb_build_object('kind','أصناف المبيعات','at',(select max(created_at) from public.sales_invoice_items_v21
          where branch = p_branch and invoice_date >= (p_day::timestamp at time zone 'Africa/Cairo')
            and invoice_date < ((p_day+1)::timestamp at time zone 'Africa/Cairo'))),
        jsonb_build_object('kind','المشتريات','at',(select max(uploaded_at) from public.purchase_review_uploads
          where branch = p_branch and p_day between first_day and last_day)),
        jsonb_build_object('kind','ملفات نتائج المتابعة','at',(select max(completed_at)
          from public.customer_followup_result_import_batches where branch = p_branch
            and (completed_at at time zone 'Africa/Cairo')::date = p_day))
      )
    )
  );
end;
$$;
revoke all on function public.dawaa_cs_named_report_v1(date,text) from public, anon, authenticated;
grant execute on function public.dawaa_cs_named_report_v1(date,text) to anon, authenticated;
notify pgrst, 'reload schema';
