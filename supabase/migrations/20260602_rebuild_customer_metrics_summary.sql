create or replace function public.dawaa_is_valid_egypt_phone(
  p_phone text,
  p_customer_code text default null
)
returns boolean
language sql
immutable
as $$
  with normalized as (
    select
      lower(trim(coalesce(p_phone, ''))) as raw_phone,
      regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as phone_digits,
      regexp_replace(coalesce(p_customer_code, ''), '\D', '', 'g') as code_digits
  )
  select
    raw_phone <> ''
    and raw_phone not like 'code:%'
    and phone_digits <> ''
    and length(phone_digits) between 10 and 13
    and (code_digits = '' or phone_digits <> code_digits)
  from normalized;
$$;

create or replace function public.dawaa_clean_customer_phone(
  p_phone text,
  p_customer_code text default null
)
returns text
language sql
immutable
as $$
  select case
    when public.dawaa_is_valid_egypt_phone(p_phone, p_customer_code)
      then regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
    else null
  end;
$$;

create or replace function public.dawaa_customer_segment_from_avg_monthly(p_avg_monthly numeric)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_avg_monthly, 0) > 8000 then 'مهم جدًا'
    when coalesce(p_avg_monthly, 0) > 4000 then 'مهم'
    when coalesce(p_avg_monthly, 0) > 1500 then 'متوسط'
    else 'عادي'
  end;
$$;

create or replace function public.dawaa_customer_status_from_dates(
  p_invoices_count integer,
  p_first_purchase date,
  p_last_purchase date
)
returns text
language sql
stable
as $$
  select case
    when coalesce(p_invoices_count, 0) <= 0 or p_last_purchase is null then 'بدون شراء'
    when p_first_purchase >= current_date - interval '30 days' then 'جديد'
    when p_last_purchase >= current_date - interval '45 days' then 'نشط'
    when p_last_purchase >= current_date - interval '90 days' then 'مهدد بالتوقف'
    else 'متوقف'
  end;
$$;

drop function if exists public.rebuild_customer_metrics_summary(date, date);

create or replace function public.rebuild_customer_metrics_summary(
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_relkind text;
  v_rows integer := 0;
  v_started_at timestamptz := clock_timestamp();
begin
  select c.relkind
    into v_relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'customer_metrics_summary';

  if v_relkind is null then
    return jsonb_build_object(
      'status', 'missing',
      'message', 'customer_metrics_summary غير موجود. يلزم إنشاء جدول أو materialized view للملخص.'
    );
  end if;

  if v_relkind = 'm' then
    refresh materialized view public.customer_metrics_summary;
    select count(*) into v_rows from public.customer_metrics_summary;
    return jsonb_build_object(
      'status', 'refreshed_materialized_view',
      'rows', v_rows,
      'note', 'تم تحديث customer_metrics_summary كـ materialized view. إذا بقيت القيم خاطئة يجب إصلاح تعريف الـ view نفسه.',
      'duration_ms', extract(milliseconds from clock_timestamp() - v_started_at)
    );
  end if;

  if v_relkind = 'v' then
    return jsonb_build_object(
      'status', 'normal_view',
      'message', 'customer_metrics_summary عبارة عن view عادي. لا يمكن إعادة بنائه بدالة؛ يجب تعديل تعريف الـ view نفسه.'
    );
  end if;

  if v_relkind not in ('r', 'p') then
    return jsonb_build_object(
      'status', 'unsupported',
      'relkind', v_relkind,
      'message', 'نوع customer_metrics_summary غير مدعوم لإعادة البناء.'
    );
  end if;

  delete from public.customer_metrics_summary;

  insert into public.customer_metrics_summary (
    final_customer_key,
    customer_id,
    customer_code,
    customer_name,
    customer_phone,
    branch,
    invoices_count,
    total_spent,
    avg_invoice,
    first_purchase,
    last_purchase,
    active_months,
    avg_monthly,
    segment_value,
    segment,
    customer_status
  )
  with invoice_base as (
    select
      case
        when nullif(trim(coalesce(si.customer_code, '')), '') is not null then trim(si.customer_code)
        when si.customer_id is not null then si.customer_id::text
        else concat(
          'name:', lower(regexp_replace(trim(coalesce(si.customer_name, 'عميل غير مسجل')), '\s+', ' ', 'g')),
          '|branch:', lower(regexp_replace(trim(coalesce(si.branch, '')), '\s+', ' ', 'g'))
        )
      end as final_customer_key,
      si.customer_id,
      nullif(trim(coalesce(si.customer_code, '')), '') as customer_code,
      nullif(trim(coalesce(si.customer_name, '')), '') as invoice_customer_name,
      public.dawaa_clean_customer_phone(si.customer_phone, si.customer_code) as invoice_customer_phone,
      nullif(trim(coalesce(si.branch, '')), '') as branch,
      si.invoice_number,
      si.invoice_date::date as sale_date,
      coalesce(si.net_amount, si.discounted_amount, si.amount, 0)::numeric as net_value
    from public.sales_invoices si
    where si.invoice_date is not null
      and (
        p_start_date is null
        or si.invoice_date::date >= p_start_date
      )
      and (
        p_end_date is null
        or si.invoice_date::date <= p_end_date
      )
  ),
  invoice_rollup as (
    select
      final_customer_key,
      (array_agg(customer_id order by sale_date desc) filter (where customer_id is not null))[1] as customer_id,
      (array_agg(customer_code order by sale_date desc) filter (where customer_code is not null))[1] as customer_code,
      (array_agg(invoice_customer_name order by sale_date desc) filter (where invoice_customer_name is not null))[1] as invoice_customer_name,
      (array_agg(invoice_customer_phone order by sale_date desc) filter (where invoice_customer_phone is not null))[1] as invoice_customer_phone,
      count(distinct nullif(branch, '')) as branch_count,
      (array_agg(branch order by sale_date desc) filter (where branch is not null))[1] as latest_branch,
      count(distinct concat_ws('|', coalesce(invoice_number::text, ''), coalesce(branch, ''), sale_date::text))::integer as invoices_count,
      sum(net_value)::numeric as total_spent,
      min(sale_date) as first_purchase,
      max(sale_date) as last_purchase,
      greatest(1, count(distinct date_trunc('month', sale_date)))::integer as active_months
    from invoice_base
    group by final_customer_key
  ),
  customer_ranked as (
    select
      c.*,
      row_number() over (
        partition by nullif(trim(coalesce(c.customer_code, '')), '')
        order by coalesce(c.updated_at, now()) desc, c.id desc
      ) as rn
    from public.customers c
    where nullif(trim(coalesce(c.customer_code, '')), '') is not null
  ),
  joined as (
    select
      ir.final_customer_key,
      coalesce(ir.customer_id, c.id) as customer_id,
      coalesce(ir.customer_code, nullif(trim(coalesce(c.customer_code, '')), '')) as customer_code,
      coalesce(nullif(trim(coalesce(c.name, '')), ''), ir.invoice_customer_name, 'عميل غير مسجل') as customer_name,
      coalesce(
        public.dawaa_clean_customer_phone(c.whatsapp_phone, coalesce(ir.customer_code, c.customer_code)),
        public.dawaa_clean_customer_phone(c.phone, coalesce(ir.customer_code, c.customer_code)),
        public.dawaa_clean_customer_phone(c.phone_alt, coalesce(ir.customer_code, c.customer_code)),
        ir.invoice_customer_phone
      ) as customer_phone,
      case
        when ir.branch_count > 1 then 'متعدد الفروع'
        else coalesce(ir.latest_branch, nullif(trim(coalesce(c.branch, '')), ''))
      end as branch,
      ir.invoices_count,
      ir.total_spent,
      (ir.total_spent / nullif(ir.invoices_count, 0))::numeric as avg_invoice,
      ir.first_purchase,
      ir.last_purchase,
      ir.active_months,
      (ir.total_spent / nullif(ir.active_months, 0))::numeric as avg_monthly
    from invoice_rollup ir
    left join customer_ranked c
      on c.rn = 1
     and ir.customer_code is not null
     and c.customer_code = ir.customer_code
  )
  select
    final_customer_key,
    customer_id,
    customer_code,
    customer_name,
    customer_phone,
    branch,
    invoices_count,
    total_spent,
    avg_invoice,
    first_purchase,
    last_purchase,
    active_months,
    avg_monthly,
    avg_monthly as segment_value,
    public.dawaa_customer_segment_from_avg_monthly(avg_monthly) as segment,
    public.dawaa_customer_status_from_dates(invoices_count, first_purchase, last_purchase) as customer_status
  from joined;

  get diagnostics v_rows = row_count;
  perform pg_notify('pgrst', 'reload schema');

  return jsonb_build_object(
    'status', 'rebuilt_table',
    'rows', v_rows,
    'branch_rule', 'متعدد الفروع إذا اشترى العميل من أكثر من فرع، وإلا آخر فرع شراء',
    'phone_rule', 'customers.whatsapp_phone ثم customers.phone ثم customers.phone_alt ثم sales_invoices.customer_phone الصالح فقط؛ code:xxxx مرفوض',
    'duration_ms', extract(milliseconds from clock_timestamp() - v_started_at)
  );
end;
$$;

drop function if exists public.check_customer_metrics_summary_customer(text);

create or replace function public.check_customer_metrics_summary_customer(
  p_customer_code text
)
returns table (
  customer_code text,
  raw_invoices_count integer,
  summary_invoices_count integer,
  raw_total_spent numeric,
  summary_total_spent numeric,
  raw_first_purchase date,
  summary_first_purchase date,
  raw_last_purchase date,
  summary_last_purchase date,
  summary_customer_phone text,
  phone_is_valid boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with raw as (
    select
      nullif(trim(coalesce(customer_code, '')), '') as customer_code,
      count(distinct concat_ws('|', coalesce(invoice_number::text, ''), coalesce(branch, ''), invoice_date::date::text))::integer as raw_invoices_count,
      sum(coalesce(net_amount, discounted_amount, amount, 0))::numeric as raw_total_spent,
      min(invoice_date::date) as raw_first_purchase,
      max(invoice_date::date) as raw_last_purchase
    from public.sales_invoices
    where nullif(trim(coalesce(customer_code, '')), '') = nullif(trim(coalesce(p_customer_code, '')), '')
    group by nullif(trim(coalesce(customer_code, '')), '')
  ),
  summary as (
    select
      customer_code,
      invoices_count as summary_invoices_count,
      total_spent as summary_total_spent,
      first_purchase as summary_first_purchase,
      last_purchase as summary_last_purchase,
      customer_phone as summary_customer_phone
    from public.customer_metrics_summary
    where nullif(trim(coalesce(customer_code, '')), '') = nullif(trim(coalesce(p_customer_code, '')), '')
    order by last_purchase desc nulls last
    limit 1
  )
  select
    raw.customer_code,
    raw.raw_invoices_count,
    coalesce(summary.summary_invoices_count, 0),
    raw.raw_total_spent,
    coalesce(summary.summary_total_spent, 0),
    raw.raw_first_purchase,
    summary.summary_first_purchase,
    raw.raw_last_purchase,
    summary.summary_last_purchase,
    summary.summary_customer_phone,
    public.dawaa_is_valid_egypt_phone(summary.summary_customer_phone, raw.customer_code)
  from raw
  left join summary on summary.customer_code = raw.customer_code;
$$;
