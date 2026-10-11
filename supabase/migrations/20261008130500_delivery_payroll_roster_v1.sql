create or replace function public.dawaa_delivery_payroll_roster_v1(p_month_cycle text)
returns table(
  staff_id uuid,
  staff_name text,
  branch text,
  tenure_band_ar text,
  attended_days integer,
  pending_review_days integer,
  late_minutes integer,
  early_leave_minutes integer,
  discipline_minutes integer,
  committed_credit_minutes integer,
  regular_credit_minutes integer,
  discipline_band_ar text,
  display_name text,
  hourly_rate numeric,
  order_rate numeric,
  trip_rate numeric,
  monthly_incentive_cap numeric,
  quarterly_incentive_cap numeric,
  provisional boolean,
  finalizable boolean,
  classification_status text
)
language sql
stable security definer
set search_path to 'public','pg_catalog'
as $$
  with eligible_staff as (
    select s.id,s.name,s.branch
    from public.staff s
    left join lateral (
      select o.payroll_eligible
      from public.delivery_payroll_staff_overrides o
      where o.staff_id=s.id
        and o.effective_from<=to_date(p_month_cycle||'-25','YYYY-MM-DD')
        and (o.effective_to is null or o.effective_to>=((to_date(p_month_cycle||'-25','YYYY-MM-DD')-interval '1 month')::date+1))
      order by o.effective_from desc,o.created_at desc
      limit 1
    ) ov on true
    where coalesce(s.active,true)=true and coalesce(s.is_active,true)=true
      and coalesce(
        ov.payroll_eligible,
        lower(trim(coalesce(s.role,''))) in ('delivery','توصيل','مندوب','مندوب توصيل')
        or lower(trim(coalesce(s.type,''))) in ('delivery','توصيل')
      )=true
  ), classified as (
    select es.*,public.dawaa_delivery_payroll_classification_v1(es.id,p_month_cycle) c
    from eligible_staff es
  )
  select
    c.id,c.name,c.branch,
    c.c->'classification'->>'tenure_band_ar',
    coalesce((c.c->'attendance'->>'attended_days')::integer,0),
    coalesce((c.c->'attendance'->>'pending_review_days')::integer,0),
    coalesce((c.c->'discipline'->>'late_minutes')::integer,0),
    coalesce((c.c->'discipline'->>'early_leave_minutes')::integer,0),
    coalesce((c.c->'discipline'->>'classification_minutes')::integer,0),
    coalesce((c.c->'discipline'->>'committed_credit_minutes')::integer,0),
    coalesce((c.c->'discipline'->>'regular_credit_minutes')::integer,0),
    c.c->'classification'->>'discipline_band_ar',
    c.c->'classification'->>'display_name',
    nullif(c.c->'rates'->>'hourly_rate','')::numeric,
    nullif(c.c->'rates'->>'order_rate','')::numeric,
    nullif(c.c->'rates'->>'trip_rate','')::numeric,
    nullif(c.c->'rates'->>'monthly_incentive_cap','')::numeric,
    nullif(c.c->'rates'->>'quarterly_incentive_cap','')::numeric,
    coalesce((c.c->>'provisional')::boolean,true),
    coalesce((c.c->>'finalizable')::boolean,false),
    c.c->'classification'->>'status'
  from classified c
  order by c.branch,c.name;
$$;

revoke execute on function public.dawaa_delivery_payroll_roster_v1(text) from public,anon,authenticated;
grant execute on function public.dawaa_delivery_payroll_roster_v1(text) to service_role;
