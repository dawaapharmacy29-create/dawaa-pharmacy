-- Doctor sales ⇄ attendance reconciliation v1 (read model; NOT APPLIED until approved).
-- Rollback reference: supabase/sql/ROLLBACK_20261009_doctor_sales_reconciliation_v1.sql
--
-- One source of truth for "which invoices are a doctor's comparable productivity":
--   * dawaa_doctor_attendance_days_v1   — punched attendance days with the branch of the device that took the
--                                          punches (the legacy biometric ingest stamped the employee's home
--                                          branch: 219 punches since 2026-07-26 sit on the wrong branch).
--   * dawaa_doctor_sales_reconciliation_v1 — every attributed invoice with exactly one category, none dropped:
--       attendance_verified : identity is reliable and the invoice sits inside one of the doctor's punched
--                             shifts at the same branch (+-60 min; a night shift owns its tail after midnight;
--                             a date-only import belongs to a punched shift on that date).
--       identity_only       : identity is reliable (staff_id, or a seller name owned by exactly one active
--                             employee) but no punched shift covers it. Counted in total sales, never in
--                             comparable productivity.
--       uncertain           : the seller name is shared by more than one active employee, the
--                             (branch, invoice_number) appears more than once, or the covering shift was punched at
--                             another branch. Shown, never credited to productivity.
--       zero_value          : non-positive amount. Shown, never counted.
--   * get_doctor_sales_reconciliation_v1 — the Doctor Performance Eye read (per cycle: categories, attended days,
--                                          hours, verified sales, and conversion verified at invoice, customer
--                                          and seller level).
--   * get_branch_doctor_performance_window_v1 is re-created on the same two functions, so the Eye and the peer
--     comparison cannot drift apart.
-- Authorization: same actor sales scope as get_staff_performance_sales_bundle_v1. Internal functions are not
-- granted to API roles.

-- 1. Device → branch registry. Seeded from the device_location carried by the vendor payload; confirm before apply.
create table if not exists public.biometric_device_branches (
  external_device_id text primary key,
  branch text not null,
  device_location text,
  source text not null default 'vendor_device_location',
  confirmed_by text,
  created_at timestamptz not null default now()
);
alter table public.biometric_device_branches enable row level security;
revoke all on public.biometric_device_branches from anon, authenticated;
insert into public.biometric_device_branches (external_device_id, branch, device_location) values
  ('101', 'فرع شكري', 'شكرى القواتلى'),
  ('102', 'فرع الشامي', 'الشامى'),
  ('GED7242701315', 'فرع شكري', null),
  ('GED7242701324', 'فرع الشامي', null)
on conflict (external_device_id) do nothing;

-- 2. Attendance days with the branch where the doctor actually punched.
create or replace function public.dawaa_doctor_attendance_days_v1(p_staff_ids uuid[], p_start date, p_end date)
returns table (staff_id uuid, attendance_date date, branch text, stored_branch text, status text, hours numeric,
               win_start timestamptz, win_end timestamptz, shift text)
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select a.staff_id, a.attendance_date,
         coalesce((
           select db.branch
           from public.biometric_attendance_logs l
           join public.biometric_device_branches db on db.external_device_id = coalesce(l.raw_payload ->> 'external_device_id', l.device_id::text)
           where l.staff_id = a.staff_id
             and l.punch_time between coalesce(a.first_in, a.last_out) - interval '1 minute' and coalesce(a.last_out, a.first_in) + interval '1 minute'
           group by db.branch order by count(*) desc, db.branch limit 1
         ), a.branch) branch,
         a.branch stored_branch, a.status,
         case when a.status = 'approved' then a.payroll_eligible_hours when a.status = 'pending_review' then a.candidate_hours end hours,
         coalesce(a.first_in, a.scheduled_start_at) win_start,
         coalesce(a.last_out, a.scheduled_end_at) win_end,
         case
           when coalesce(a.scheduled_start_at, a.first_in) is null then 'unknown'
           when extract(hour from coalesce(a.scheduled_start_at, a.first_in) at time zone 'Africa/Cairo') >= 5
            and extract(hour from coalesce(a.scheduled_start_at, a.first_in) at time zone 'Africa/Cairo') < 13 then 'morning'
           when extract(hour from coalesce(a.scheduled_start_at, a.first_in) at time zone 'Africa/Cairo') >= 13
            and extract(hour from coalesce(a.scheduled_start_at, a.first_in) at time zone 'Africa/Cairo') < 21 then 'evening'
           else 'night'
         end shift
  from public.attendance_daily_summary a
  where a.staff_id = any(p_staff_ids)
    and a.attendance_date >= p_start - 1 and a.attendance_date < p_end
    and (a.first_in is not null or a.last_out is not null)
$function$;

-- 3. Invoice-level reconciliation. One row per (invoice, candidate doctor); nothing is dropped.
create or replace function public.dawaa_doctor_sales_reconciliation_v1(p_staff_ids uuid[], p_branch text, p_start date, p_end date)
returns table (invoice_id text, staff_id uuid, branch text, invoice_number text, invoice_at timestamptz, sale_day date,
               date_only boolean, amount numeric, customer_key text, attribution text, category text, reason text,
               shift_date date, shift text, attendance_status text, attendance_branch text, seller_norm text)
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with active_norms as materialized (
    select s.id staff_id, public.normalize_cs_identity_name(s.name) norm from public.staff s where coalesce(s.active, true)
    union
    select a.staff_id, coalesce(nullif(a.normalized_alias, ''), public.normalize_cs_identity_name(a.alias_name))
    from public.staff_identity_aliases a join public.staff s on s.id = a.staff_id
    where coalesce(a.active, true) and coalesce(s.active, true)
  ),
  target_norms as materialized (
    -- A target doctor's own names are included even if the doctor is inactive.
    select s.id staff_id, public.normalize_cs_identity_name(s.name) norm from public.staff s where s.id = any(p_staff_ids)
    union
    select a.staff_id, coalesce(nullif(a.normalized_alias, ''), public.normalize_cs_identity_name(a.alias_name))
    from public.staff_identity_aliases a where a.staff_id = any(p_staff_ids) and coalesce(a.active, true)
  ),
  norm_owners as materialized (
    select n.norm, count(distinct n.staff_id) owners
    from (select * from active_norms union select * from target_norms) n where n.norm <> '' group by n.norm
  ),
  inv as materialized (
    select si.id::text invoice_id, coalesce(nullif(btrim(si.branch_name), ''), nullif(btrim(si.branch), '')) branch,
           nullif(btrim(si.invoice_number), '') invoice_number, si.invoice_date invoice_at,
           (si.invoice_date at time zone 'Africa/Cairo')::date sale_day,
           -- Imports that carry only a date are stored at 00:00 UTC; their time of day is unknown.
           (si.invoice_date at time zone 'UTC')::time = time '00:00' date_only,
           coalesce(nullif(si.net_total, 0), nullif(si.net_amount, 0), nullif(si.discounted_amount, 0), nullif(si.total_amount, 0), nullif(si.amount, 0), nullif(si.gross_total, 0), nullif(si.gross_amount, 0), 0)::numeric amount,
           coalesce(nullif(btrim(si.customer_id::text), ''), nullif(btrim(si.customer_code), ''), nullif(btrim(si.customer_phone), '')) customer_key,
           nullif(btrim(si.staff_id), '') staff_text,
           case when coalesce(btrim(si.staff_id), '') = '' then public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name), ''), nullif(btrim(si.seller_name), ''), nullif(btrim(si.staff_name), ''))) end norm
    from public.sales_invoices si
    where si.invoice_date >= (p_start::timestamp at time zone 'Africa/Cairo')
      and si.invoice_date < (p_end::timestamp at time zone 'Africa/Cairo')
      and (p_branch is null or coalesce(nullif(btrim(si.branch_name), ''), nullif(btrim(si.branch), '')) = p_branch)
  ),
  attributed as materialized (
    select i.*, t.staff_id, 'direct'::text attribution
    from inv i join (select unnest(p_staff_ids) staff_id) t on i.staff_text = t.staff_id::text
    union all
    select i.*, tn.staff_id, case when o.owners = 1 then 'unique_name' else 'ambiguous_name' end
    from inv i join target_norms tn on i.staff_text is null and tn.norm = i.norm and i.norm <> ''
    join norm_owners o on o.norm = i.norm
  ),
  days as materialized (
    select * from public.dawaa_doctor_attendance_days_v1(p_staff_ids, p_start, p_end)
  ),
  placed as (
    select a.*, p.attendance_date shift_date, p.shift, p.status attendance_status, p.branch attendance_branch,
           (select count(*) from public.sales_invoices x
             where x.invoice_number = a.invoice_number
               and coalesce(nullif(btrim(x.branch_name), ''), nullif(btrim(x.branch), '')) = a.branch) number_rows
    from attributed a
    left join lateral (
      select d.attendance_date, d.shift, d.status, d.branch
      from days d
      where d.staff_id = a.staff_id and d.attendance_date in (a.sale_day, a.sale_day - 1)
        and ((a.invoice_at >= d.win_start - interval '60 minutes'
              and a.invoice_at < coalesce(d.win_end, d.win_start + interval '14 hours') + interval '60 minutes')
             or (a.date_only and d.attendance_date = a.sale_day))
      order by (d.branch = a.branch) desc, (a.date_only and d.attendance_date = a.sale_day) desc,
               abs(extract(epoch from (a.invoice_at - d.win_start)))
      limit 1
    ) p on true
  )
  select p.invoice_id, p.staff_id, p.branch, p.invoice_number, p.invoice_at, p.sale_day, p.date_only, p.amount, p.customer_key,
         p.attribution,
         case when p.amount <= 0 then 'zero_value'
              when p.attribution = 'ambiguous_name' or p.number_rows > 1 then 'uncertain'
              when p.shift_date is not null and p.attendance_branch is distinct from p.branch then 'uncertain'
              when p.shift_date is not null then 'attendance_verified'
              else 'identity_only' end category,
         case when p.amount <= 0 then 'non_positive_amount'
              when p.attribution = 'ambiguous_name' then 'seller_name_shared'
              when p.number_rows > 1 then 'duplicate_invoice_number'
              when p.shift_date is not null and p.attendance_branch is distinct from p.branch then 'attendance_other_branch'
              when p.shift_date is not null then 'inside_punched_shift'
              else 'no_punched_shift' end reason,
         case when p.attendance_branch = p.branch then p.shift_date end shift_date,
         case when p.attendance_branch = p.branch then p.shift end shift,
         p.attendance_status, p.attendance_branch, p.norm
  from placed p
$function$;

revoke all on function public.dawaa_doctor_attendance_days_v1(uuid[], date, date) from public, anon, authenticated;
revoke all on function public.dawaa_doctor_sales_reconciliation_v1(uuid[], text, date, date) from public, anon, authenticated;

-- 4. Doctor Performance Eye read: per cycle, everything the Eye needs to keep total sales and comparable
--    productivity apart, and to verify conversion at invoice, customer and seller level.
create or replace function public.get_doctor_sales_reconciliation_v1(p_staff_id uuid, p_window_start date, p_window_end date)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_result jsonb;
begin
  if p_staff_id is null or p_window_start is null or p_window_end is null
     or p_window_end <= p_window_start or p_window_end - p_window_start > 190 then
    raise exception 'invalid_reconciliation_window' using errcode = '22023';
  end if;
  perform public.dawaa_assert_staff_sales_scope_v1(p_staff_id);

  with cycles as (
    select gs::date s, (gs + interval '1 month')::date e
    from generate_series(p_window_start::timestamp, (p_window_end - interval '1 month')::timestamp, interval '1 month') gs
  ),
  rec as materialized (
    select * from public.dawaa_doctor_sales_reconciliation_v1(array[p_staff_id], null, p_window_start, p_window_end)
  ),
  days as materialized (
    select * from public.dawaa_doctor_attendance_days_v1(array[p_staff_id], p_window_start, p_window_end)
    where attendance_date >= p_window_start
  ),
  day_sales as (
    select r.shift_date, sum(r.amount) sales, count(*) invoices
    from rec r where r.category = 'attendance_verified' group by r.shift_date
  ),
  reviews as materialized (
    select r.id, btrim(r.invoice_number) num, r.branch, r.customer_code, r.customer_phone, r.customer_id::text cid,
           r.converted_to_sale, coalesce(r.conversation_date, r.created_at) at_ts,
           (coalesce(r.conversation_date, r.created_at) at time zone 'Africa/Cairo')::date d
    from public.conversation_sales_reviews_canonical_v2 r
    where (r.doctor_id::text = p_staff_id::text or r.staff_id::text = p_staff_id::text)
      and coalesce(r.conversation_date, r.created_at) >= (p_window_start::timestamp at time zone 'Africa/Cairo')
      and coalesce(r.conversation_date, r.created_at) < (p_window_end::timestamp at time zone 'Africa/Cairo')
  ),
  review_check as (
    select rv.*,
      (select count(*) from public.sales_invoices si
        where si.invoice_number = rv.num and coalesce(nullif(btrim(si.branch_name), ''), nullif(btrim(si.branch), '')) = rv.branch) rows_in_branch,
      (select count(*) from reviews o where o.num = rv.num and o.branch = rv.branch and o.converted_to_sale and o.id <> rv.id) reused,
      (select jsonb_build_object(
          'same_customer', coalesce(nullif(btrim(si.customer_code), ''), '#') = coalesce(nullif(btrim(rv.customer_code), ''), '§')
                           or (si.customer_id is not null and si.customer_id::text = rv.cid)
                           or (length(regexp_replace(coalesce(rv.customer_phone, ''), '\D', '', 'g')) >= 10
                               and right(regexp_replace(coalesce(si.customer_phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(coalesce(rv.customer_phone, ''), '\D', '', 'g'), 10)),
          'sold_by_doctor', exists (select 1 from rec x where x.invoice_id = si.id::text and x.attribution <> 'ambiguous_name'),
          'within_48h', abs(extract(epoch from (si.invoice_date - rv.at_ts))) <= 48 * 3600,
          'positive', coalesce(nullif(si.net_total, 0), nullif(si.net_amount, 0), nullif(si.amount, 0), 0) > 0)
        from public.sales_invoices si
        where si.invoice_number = rv.num and coalesce(nullif(btrim(si.branch_name), ''), nullif(btrim(si.branch), '')) = rv.branch
        limit 1) inv
    from reviews rv
  ),
  review_class as (
    select rc.d,
      case when rc.converted_to_sale is false then 'no_sale'
           when rc.converted_to_sale is null then 'unknown'
           when rc.num is null or rc.num = '' then 'claimed_without_invoice'
           when rc.rows_in_branch = 0 then 'invoice_missing'
           when rc.rows_in_branch > 1 or rc.reused > 0 then 'invoice_ambiguous_or_reused'
           when not coalesce((rc.inv ->> 'positive')::boolean, false) or not coalesce((rc.inv ->> 'within_48h')::boolean, false) then 'invoice_out_of_window'
           when not coalesce((rc.inv ->> 'same_customer')::boolean, false) then 'other_customer'
           when not coalesce((rc.inv ->> 'sold_by_doctor')::boolean, false) then 'sold_by_other_staff'
           else 'verified' end cls
    from review_check rc
  )
  select jsonb_build_object(
    'staffId', p_staff_id,
    'windowStart', p_window_start, 'windowEnd', p_window_end,
    'cycles', (select coalesce(jsonb_agg(jsonb_build_object(
        'start', c.s, 'endExclusive', c.e,
        'categories', (select coalesce(jsonb_object_agg(x.category, jsonb_build_object('invoices', x.n, 'sales', x.sales)), '{}'::jsonb)
                       from (select r.category, count(*) n, coalesce(sum(r.amount), 0) sales from rec r
                             where r.sale_day >= c.s and r.sale_day < c.e group by r.category) x),
        'reasons', (select coalesce(jsonb_object_agg(x.reason, x.n), '{}'::jsonb)
                    from (select r.reason, count(*) n from rec r where r.sale_day >= c.s and r.sale_day < c.e group by r.reason) x),
        'attendance', (select jsonb_build_object(
            'presentDays', count(*),
            'settledDays', count(*) filter (where d.status = 'approved'),
            'pendingDays', count(*) filter (where d.status <> 'approved'),
            -- Per-hour reads only approved days whose hours are known; their sales and hours form one pair.
            'approvedHours', coalesce(sum(d.hours) filter (where d.status = 'approved' and coalesce(d.hours, 0) > 0), 0),
            'approvedDaysWithHours', count(*) filter (where d.status = 'approved' and coalesce(d.hours, 0) > 0),
            'pendingHours', coalesce(sum(d.hours) filter (where d.status <> 'approved'), 0),
            'daysWithoutHours', count(*) filter (where coalesce(d.hours, 0) = 0),
            'otherBranchDays', count(*) filter (where d.branch is distinct from d.stored_branch),
            'lastDay', max(d.attendance_date))
          from days d where d.attendance_date >= c.s and d.attendance_date < c.e),
        'productivity', (select jsonb_build_object(
            'verifiedSales', coalesce(sum(ds.sales), 0),
            'verifiedInvoices', coalesce(sum(ds.invoices), 0),
            'verifiedSalesSettledDays', coalesce(sum(ds.sales) filter (where d.status = 'approved' and coalesce(d.hours, 0) > 0), 0),
            'daysWithVerifiedSales', count(ds.shift_date))
          from days d left join day_sales ds on ds.shift_date = d.attendance_date
          where d.attendance_date >= c.s and d.attendance_date < c.e),
        'conversion', (select coalesce(jsonb_object_agg(x.cls, x.n), '{}'::jsonb)
                       from (select rc.cls, count(*) n from review_class rc where rc.d >= c.s and rc.d < c.e group by rc.cls) x)
      ) order by c.s), '[]'::jsonb) from cycles c)
  ) into v_result;
  return v_result;
end
$function$;

revoke all on function public.get_doctor_sales_reconciliation_v1(uuid, date, date) from public;
grant execute on function public.get_doctor_sales_reconciliation_v1(uuid, date, date) to anon, authenticated, service_role;

-- 5. Peer comparison on the same reconciliation (supersedes the body from 20261008090000; same signature,
--    payload shape and authorization). Invoices are attributed and placed exactly as the Eye sees them; a
--    shift punched at another branch belongs to that branch.
create or replace function public.get_branch_doctor_performance_window_v1(p_branch text, p_window_start date, p_window_end date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_scope text;
  v_result jsonb;
  v_attendance jsonb := '[]'::jsonb;
  v_doctor_ids uuid[];
  v_doc uuid;
  v_cycle record;
  v_detail jsonb;
begin
  if p_branch is null or btrim(p_branch) = '' or p_window_start is null or p_window_end is null
     or p_window_end <= p_window_start or p_window_end - p_window_start > 190 then
    raise exception 'invalid_performance_window' using errcode = '22023';
  end if;
  v_scope := public.dawaa_current_sales_invoice_scope_v1(array['view_dashboard','view_sales','view_all_invoices','view_quarterly_incentives','view_points']);
  if v_scope = 'NONE' then
    raise exception 'staff_sales_scope_denied' using errcode = '42501';
  end if;
  if v_scope <> 'ALL' and v_scope <> p_branch then
    raise exception 'staff_sales_branch_scope_denied' using errcode = '42501';
  end if;

  select coalesce(array_agg(s.id), '{}') into v_doctor_ids
  from public.staff s
  where public.dawaa_monthly_evaluation_canonical_role_v5(s.role) = 'doctor'
    and (
      (coalesce(s.active, true) and s.branch = p_branch)
      or exists (
        select 1 from public.attendance_daily_summary a
        where a.staff_id = s.id and a.branch = p_branch
          and a.attendance_date >= p_window_start and a.attendance_date < p_window_end
      )
    );

  -- Canonical attendance counts per doctor and cycle; a failed read stays unavailable, never zero.
  foreach v_doc in array v_doctor_ids loop
    for v_cycle in
      select gs::date s, (gs + interval '1 month')::date e
      from generate_series(p_window_start::timestamp, (p_window_end - interval '1 month')::timestamp, interval '1 month') gs
    loop
      begin
        v_detail := public.get_staff_attendance_detail_v2(v_doc, v_cycle.s, v_cycle.e - 1) -> 'summary';
        v_attendance := v_attendance || jsonb_build_array(jsonb_build_object(
          'staffId', v_doc, 'cycleStart', v_cycle.s, 'available', true,
          'workedDays', (v_detail ->> 'actual_worked_days')::int,
          'lateDays', (v_detail ->> 'late_days')::int,
          'workedHours', (v_detail ->> 'total_worked_hours')::numeric,
          'pendingReviewDays', (v_detail ->> 'pending_review_days')::int,
          'cycleOpen', (v_detail ->> 'cycle_open')::boolean));
      exception when others then
        v_attendance := v_attendance || jsonb_build_array(jsonb_build_object(
          'staffId', v_doc, 'cycleStart', v_cycle.s, 'available', false, 'error', sqlerrm));
      end;
    end loop;
  end loop;

  with doctors as (
    select s.id staff_id, s.name, coalesce(s.active, true) active, s.branch home_branch
    from public.staff s where s.id = any(v_doctor_ids)
  ),
  cycles as (
    select gs::date s, (gs + interval '1 month')::date e
    from generate_series(p_window_start::timestamp, (p_window_end - interval '1 month')::timestamp, interval '1 month') gs
  ),
  -- Attribution, device-branch attendance and shift placement come from the shared reconciliation, the same
  -- source the Doctor Performance Eye reads; this function only aggregates it for the branch.
  rec as materialized (
    select * from public.dawaa_doctor_sales_reconciliation_v1(v_doctor_ids, p_branch, p_window_start, p_window_end)
  ),
  placed as materialized (
    select r.invoice_id id, r.staff_id, r.sale_day d, r.amount, r.customer_key,
           case when r.attribution = 'direct' then 'direct' else 'alias' end via,
           case when r.category = 'attendance_verified' then r.shift_date end shift_date,
           case when r.category = 'attendance_verified' then r.shift end shift
    from rec r where r.attribution <> 'ambiguous_name'
  ),
  ambiguous_inv as (
    select r.staff_id, r.sale_day d, r.amount from rec r where r.attribution = 'ambiguous_name'
  ),
  att as materialized (
    select d.staff_id, d.attendance_date, d.status, a.resolution_status, d.hours, d.win_start, d.win_end, d.shift
    from public.dawaa_doctor_attendance_days_v1(v_doctor_ids, p_window_start, p_window_end) d
    join public.attendance_daily_summary a on a.staff_id = d.staff_id and a.attendance_date = d.attendance_date
    where d.branch = p_branch and d.attendance_date >= p_window_start
  ),
  productive_days as (
    select * from att where hours > 0 and win_start is not null and win_end is not null and win_end > win_start
  ),
  sales_agg as (
    select t.staff_id, c.s cycle_start, sum(t.amount) sales, count(*) invoices,
           count(distinct t.customer_key) filter (where t.customer_key is not null) customers,
           count(*) filter (where t.via = 'direct') direct_invoices, count(*) filter (where t.via = 'alias') alias_invoices,
           count(*) filter (where t.shift is null) unmatched_invoices, coalesce(sum(t.amount) filter (where t.shift is null), 0) unmatched_sales
    from placed t join cycles c on t.d >= c.s and t.d < c.e
    group by t.staff_id, c.s
  ),
  ambiguous_agg as (
    select a.staff_id, c.s cycle_start, count(*) invoices
    from ambiguous_inv a join cycles c on a.d >= c.s and a.d < c.e group by a.staff_id, c.s
  ),
  shift_hours as (
    select p.staff_id, c.s cycle_start, p.shift, round(sum(p.hours)::numeric, 2) hours, count(*) days,
           count(*) filter (where p.status = 'pending_review') pending_days,
           count(*) filter (where p.status = 'approved' and p.resolution_status in ('late', 'very_late')) late_days
    from productive_days p join cycles c on p.attendance_date >= c.s and p.attendance_date < c.e
    group by p.staff_id, c.s, p.shift
  ),
  shift_sales as (
    -- Only shifts whose hours are known: sales of a day without hours would be divided by other days' hours.
    select m.staff_id, c.s cycle_start, m.shift, sum(m.amount) sales, count(*) invoices
    from placed m
    join productive_days p on p.staff_id = m.staff_id and p.attendance_date = m.shift_date
    join cycles c on m.shift_date >= c.s and m.shift_date < c.e
    where m.shift is not null
    group by m.staff_id, c.s, m.shift
  ),
  shift_json as (
    select h.staff_id, h.cycle_start, jsonb_object_agg(h.shift, jsonb_build_object(
             'hours', h.hours, 'days', h.days, 'pendingDays', h.pending_days, 'lateDays', h.late_days,
             'sales', coalesce(ss.sales, 0), 'invoices', coalesce(ss.invoices, 0))) shifts
    from shift_hours h left join shift_sales ss on ss.staff_id = h.staff_id and ss.cycle_start = h.cycle_start and ss.shift = h.shift
    group by h.staff_id, h.cycle_start
  ),
  doctor_cycle as (
    select d.staff_id, c.s cycle_start,
      jsonb_build_object('salesAll', coalesce(sa.sales, 0), 'invoicesAll', coalesce(sa.invoices, 0), 'customers', coalesce(sa.customers, 0),
                         'directInvoices', coalesce(sa.direct_invoices, 0), 'aliasInvoices', coalesce(sa.alias_invoices, 0)) sales,
      coalesce(aa.invoices, 0) ambiguous_invoices,
      jsonb_build_object('invoices', coalesce(sa.unmatched_invoices, 0), 'sales', coalesce(sa.unmatched_sales, 0)) unmatched,
      coalesce(sj.shifts, '{}'::jsonb) shifts
    from doctors d cross join cycles c
    left join sales_agg sa on sa.staff_id = d.staff_id and sa.cycle_start = c.s
    left join ambiguous_agg aa on aa.staff_id = d.staff_id and aa.cycle_start = c.s
    left join shift_json sj on sj.staff_id = d.staff_id and sj.cycle_start = c.s
  ),
  branch_agg as (
    select c.s,
           (select count(*) from public.sales_invoices si
             where coalesce(nullif(btrim(si.branch_name), ''), nullif(btrim(si.branch), '')) = p_branch
               and si.invoice_date >= (c.s::timestamp at time zone 'Africa/Cairo') and si.invoice_date < (c.e::timestamp at time zone 'Africa/Cairo')) invoices,
           (select count(*) from placed t where t.d >= c.s and t.d < c.e) doctor_invoices,
           (select count(distinct a.invoice_id) from rec a where a.attribution = 'ambiguous_name' and a.sale_day >= c.s and a.sale_day < c.e) ambiguous_invoices
    from cycles c
  )
  select jsonb_build_object(
    'branch', p_branch,
    'windowStart', p_window_start, 'windowEnd', p_window_end,
    'dataAsOf', (select (max(si.invoice_date) at time zone 'Africa/Cairo')::date from public.sales_invoices si
                 where coalesce(nullif(btrim(si.branch_name), ''), nullif(btrim(si.branch), '')) = p_branch),
    'cycles', (select coalesce(jsonb_agg(jsonb_build_object('start', c.s, 'endExclusive', c.e) order by c.s), '[]'::jsonb) from cycles c),
    'ambiguousNames', (select coalesce(jsonb_agg(distinct a.seller_norm), '[]'::jsonb) from rec a where a.attribution = 'ambiguous_name'),
    'branchCycles', (select coalesce(jsonb_agg(jsonb_build_object('start', c.s, 'invoices', coalesce(b.invoices, 0),
        'doctorInvoices', coalesce(b.doctor_invoices, 0), 'ambiguousInvoices', coalesce(b.ambiguous_invoices, 0)) order by c.s), '[]'::jsonb)
      from cycles c left join branch_agg b on b.s = c.s),
    'doctors', (select coalesce(jsonb_agg(jsonb_build_object(
        'staffId', d.staff_id, 'name', d.name, 'active', d.active, 'homeBranch', d.home_branch,
        'cycles', (select coalesce(jsonb_agg(jsonb_build_object(
            'start', dc.cycle_start, 'sales', dc.sales, 'ambiguousInvoices', dc.ambiguous_invoices,
            'unmatched', dc.unmatched, 'shifts', dc.shifts,
            'attendance', (select x from jsonb_array_elements(v_attendance) x
                           where x ->> 'staffId' = d.staff_id::text and (x ->> 'cycleStart')::date = dc.cycle_start limit 1)
          ) order by dc.cycle_start), '[]'::jsonb) from doctor_cycle dc where dc.staff_id = d.staff_id)
      ) order by d.name), '[]'::jsonb) from doctors d)
  ) into v_result;

  return v_result;
end
$function$;

revoke all on function public.get_branch_doctor_performance_window_v1(text, date, date) from public;
grant execute on function public.get_branch_doctor_performance_window_v1(text, date, date) to anon, authenticated, service_role;
