-- Branch doctor performance window (read-only) for the Doctor Performance Eye.
-- Rollback: drop function public.get_branch_doctor_performance_window_v1(text, date, date); (new read-only function, no data changes).
--
-- One bounded, branch-scoped aggregate that lets the Eye compare a doctor fairly with branch peers and
-- with the branch's own historical shift productivity, without shipping invoice rows to the browser.
--
-- Rules (see docs/EMPLOYEE_DOMAIN_ARCHITECTURE.md):
-- * Authorization: same actor sales scope as get_staff_performance_sales_bundle_v1 (ALL, or this branch only).
-- * Branch comes from the transaction (invoice / attendance branch), never from the employee home branch.
-- * Attribution: canonical staff_id first; a name/alias match only when that normalized name belongs to
--   exactly one active employee. Names shared by more than one active employee are returned as
--   ambiguous and never attributed (no invoice is credited to a doctor without reliable attribution).
-- * Attendance counts (worked days, late days, worked hours) come from the canonical
--   get_staff_attendance_detail_v2 projection; per-day rows of attendance_daily_summary are only used to
--   place each matched invoice inside the doctor's own attendance window and classify its shift.
-- * Shift class comes from the scheduled start (fallback: first check-in), local Cairo hour:
--   [05,13) morning, [13,21) evening, otherwise night. An invoice belongs to the attendance window that
--   contains it (+-60 minutes), so night shifts crossing midnight stay one shift on the shift's own date.
-- * Missing data stays missing (null / available=false), never zero.
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
  doctor_norms as materialized (
    select d.staff_id, public.normalize_cs_identity_name(d.name) norm from doctors d
    union
    select a.staff_id, coalesce(nullif(a.normalized_alias, ''), public.normalize_cs_identity_name(a.alias_name))
    from public.staff_identity_aliases a join doctors d on d.staff_id = a.staff_id
    where coalesce(a.active, true)
  ),
  active_norms as materialized (
    select s.id staff_id, public.normalize_cs_identity_name(s.name) norm from public.staff s where coalesce(s.active, true)
    union
    select a.staff_id, coalesce(nullif(a.normalized_alias, ''), public.normalize_cs_identity_name(a.alias_name))
    from public.staff_identity_aliases a join public.staff s on s.id = a.staff_id
    where coalesce(a.active, true) and coalesce(s.active, true)
  ),
  norm_counts as (
    select dn.norm, (array_agg(distinct dn.staff_id))[1] staff_id, count(distinct dn.staff_id) owners
    from doctor_norms dn where dn.norm <> '' group by dn.norm
  ),
  norm_owner as materialized (
    -- A norm is attributable only when every employee carrying it (doctor or not) is the same doctor.
    select o.norm, o.staff_id,
           o.owners = 1 and not exists (select 1 from active_norms an where an.norm = o.norm and an.staff_id <> o.staff_id) attributable
    from norm_counts o
  ),
  ambiguous_norms as materialized (
    select dn.norm, dn.staff_id from doctor_norms dn join norm_owner o on o.norm = dn.norm and not o.attributable
  ),
  inv as materialized (
    select si.id, si.invoice_date ts,
           (si.invoice_date at time zone 'Africa/Cairo')::date d,
           coalesce(nullif(btrim(si.customer_id::text), ''), nullif(btrim(si.customer_code), ''), nullif(btrim(si.customer_phone), '')) customer_key,
           coalesce(nullif(si.net_total, 0), nullif(si.net_amount, 0), nullif(si.discounted_amount, 0), nullif(si.total_amount, 0), nullif(si.amount, 0), nullif(si.gross_total, 0), nullif(si.gross_amount, 0), 0)::numeric amount,
           -- Imports that carry only a date are stored at 00:00 UTC; their time of day is unknown.
           (si.invoice_date at time zone 'UTC')::time = time '00:00' date_only,
           nullif(btrim(si.staff_id), '') staff_text,
           case when coalesce(btrim(si.staff_id), '') = '' then public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name), ''), nullif(btrim(si.seller_name), ''), nullif(btrim(si.staff_name), ''))) end norm
    from public.sales_invoices si
    where coalesce(nullif(btrim(si.branch_name), ''), nullif(btrim(si.branch), '')) = p_branch
      and si.invoice_date >= (p_window_start::timestamp at time zone 'Africa/Cairo')
      and si.invoice_date < (p_window_end::timestamp at time zone 'Africa/Cairo')
  ),
  attributed as materialized (
    select i.*, d.staff_id, 'direct'::text via from inv i join doctors d on i.staff_text = d.staff_id::text
    union all
    select i.*, o.staff_id, 'alias'::text from inv i join norm_owner o on i.staff_text is null and o.norm = i.norm and o.attributable
  ),
  ambiguous_inv as (
    select a.staff_id, i.d, i.amount from inv i join ambiguous_norms a on i.staff_text is null and a.norm = i.norm
  ),
  att as materialized (
    select a.staff_id, a.attendance_date, a.status, a.resolution_status,
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
    from public.attendance_daily_summary a join doctors d on d.staff_id = a.staff_id
    where a.branch = p_branch and a.attendance_date >= p_window_start and a.attendance_date < p_window_end
  ),
  productive_days as (
    select * from att where hours > 0 and win_start is not null and win_end is not null and win_end > win_start
  ),
  placed as materialized (
    -- Each attributed invoice is placed in the doctor's own attendance window that contains it (+-60 min).
    -- Candidate shift dates are the invoice day and the previous day, so night shifts crossing midnight
    -- stay one shift on the shift's own date. A date-only invoice (no time of day) belongs to the doctor's
    -- attendance on that same date. Invoices outside every window keep shift = null (unmatched).
    select distinct on (t.id) t.id, t.staff_id, t.d, t.amount, t.customer_key, t.via, p.attendance_date shift_date, p.shift
    from attributed t
    left join productive_days p
      on p.staff_id = t.staff_id and p.attendance_date in (t.d, t.d - 1)
     and ((t.ts >= p.win_start - interval '60 minutes' and t.ts < p.win_end + interval '60 minutes')
          or (t.date_only and p.attendance_date = t.d))
    order by t.id, (p.attendance_date is null), (p.attendance_date is distinct from t.d and t.date_only), abs(extract(epoch from (t.ts - p.win_start)))
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
    select m.staff_id, c.s cycle_start, m.shift, sum(m.amount) sales, count(*) invoices
    from placed m join cycles c on m.shift_date >= c.s and m.shift_date < c.e
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
  ambiguous_name_set as (select distinct norm from ambiguous_norms),
  branch_agg as (
    -- Per-cycle counts are aggregated separately so no large set is joined to another large set.
    select c.s,
           (select count(*) from inv i where i.d >= c.s and i.d < c.e) invoices,
           (select count(*) from placed t where t.d >= c.s and t.d < c.e) doctor_invoices,
           (select count(*) from inv i join ambiguous_name_set an on an.norm = i.norm where i.staff_text is null and i.d >= c.s and i.d < c.e) ambiguous_invoices
    from cycles c
  )
  select jsonb_build_object(
    'branch', p_branch,
    'windowStart', p_window_start, 'windowEnd', p_window_end,
    'dataAsOf', (select (max(si.invoice_date) at time zone 'Africa/Cairo')::date from public.sales_invoices si
                 where coalesce(nullif(btrim(si.branch_name), ''), nullif(btrim(si.branch), '')) = p_branch),
    'cycles', (select coalesce(jsonb_agg(jsonb_build_object('start', c.s, 'endExclusive', c.e) order by c.s), '[]'::jsonb) from cycles c),
    'ambiguousNames', (select coalesce(jsonb_agg(distinct a.norm), '[]'::jsonb) from ambiguous_norms a),
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
