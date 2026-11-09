-- Who competes on the doctor competition page is decided by the owner, and is wider than
-- who earns the list incentive. get_eligible_doctor_accounts() also gates
-- get_list_incentive_invoice_lines_v1, so it stays untouched: adding these two doctors
-- there would pay them an incentive nobody approved.
create or replace function public.get_competition_doctor_accounts_v1()
returns table(staff_id text, name text, branch text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select e.staff_id, e.name, e.branch
  from public.get_eligible_doctor_accounts() e
  union
  select s.id::text, btrim(s.name), btrim(s.branch)
  from public.staff s
  where s.id::text in (
      'd40cb3d7-9548-46eb-b001-2754ab692e97', -- د هدي (assistant account)
      '8601fb7f-c14c-43b8-b735-8761d8c12ace'  -- د احمد حافظ (inactive since 2026-10-30, keeps their cycle sales)
    )
    and nullif(btrim(s.name), '') is not null
    and nullif(btrim(s.branch), '') is not null;
$$;

revoke all on function public.get_competition_doctor_accounts_v1() from public;
grant execute on function public.get_competition_doctor_accounts_v1() to anon, authenticated, service_role;

-- Only the competition page and its design pack read this list.
create or replace function public.get_eligible_doctor_staff_ids()
returns table(staff_id text)
language sql
stable
set search_path to 'public'
as $$
  select c.staff_id from public.get_competition_doctor_accounts_v1() c;
$$;

-- get_dashboard_doctor_sales_v171 hides assistant and inactive sellers, which is right for
-- the dashboards. The competition adds these two doctors' sales back under their staff name.
create or replace function public.get_competition_doctor_sales_v1(p_start date, p_end date, p_branch text default null)
returns table(doctor_name text, branch text, sales_total numeric, invoices_count bigint, avg_invoice numeric)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  with extra_names as (
    select s.id, btrim(s.name) as staff_name, public.normalize_cs_identity_name(s.name) as norm
    from public.staff s
    where s.id::text in ('d40cb3d7-9548-46eb-b001-2754ab692e97', '8601fb7f-c14c-43b8-b735-8761d8c12ace')
    union
    select s.id, btrim(s.name), public.normalize_cs_identity_name(a.alias_name)
    from public.staff_identity_aliases a
    join public.staff s on s.id = a.staff_id
    where coalesce(a.active, true)
      and s.id::text in ('d40cb3d7-9548-46eb-b001-2754ab692e97', '8601fb7f-c14c-43b8-b735-8761d8c12ace')
  ),
  extra_sales as (
    select
      n.staff_name,
      coalesce(nullif(btrim(si.branch), ''), 'غير محدد') as sale_branch,
      sum(coalesce(nullif(si.net_total, 0), nullif(si.net_amount, 0), nullif(si.discounted_amount, 0), nullif(si.total_amount, 0), nullif(si.amount, 0), 0))::numeric as total,
      count(*)::bigint as invoices
    from public.dawaa_sales_invoices_dashboard_v1 si
    join extra_names n
      on n.norm = public.normalize_cs_identity_name(coalesce(nullif(btrim(si.seller_name), ''), nullif(btrim(si.staff_name), ''), nullif(btrim(si.normalized_seller_name), '')))
    where si.invoice_date >= p_start
      and si.invoice_date < (p_end + 1)::timestamp
      and (p_branch is null or btrim(p_branch) = '' or p_branch in ('الكل', 'كل الفروع') or si.branch = p_branch)
    group by 1, 2
  )
  select d.doctor_name, d.branch, d.sales_total, d.invoices_count, d.avg_invoice
  from public.get_dashboard_doctor_sales_v171(p_start, p_end, p_branch) d
  where public.normalize_cs_identity_name(d.doctor_name) not in (select norm from extra_names)
  union all
  select e.staff_name, e.sale_branch, e.total, e.invoices, (e.total / nullif(e.invoices, 0))::numeric
  from extra_sales e;
$$;

revoke all on function public.get_competition_doctor_sales_v1(date, date, text) from public;
grant execute on function public.get_competition_doctor_sales_v1(date, date, text) to anon, authenticated, service_role;
