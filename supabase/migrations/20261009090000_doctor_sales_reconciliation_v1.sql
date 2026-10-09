-- Doctor sales ⇄ attendance reconciliation v1 (read model; NOT APPLIED until approved).
-- Rollback reference: supabase/sql/ROLLBACK_20261009_doctor_sales_reconciliation_v1.sql
-- Design and evidence: docs/DOCTOR_SALES_RECONCILIATION.md
--
-- Writes no existing data: it creates one registry table (device → branch), read-only functions, and re-creates
-- get_branch_doctor_performance_window_v1 on the same core. sales_invoices, biometric_attendance_logs,
-- attendance_daily_summary and conversation reviews are only read.
--
-- Rules
-- * Identity: staff_id, else a seller name owned by exactly one active employee; a shared name is "uncertain".
-- * Attendance branch is proven only by the punching device (biometric_device_branches). The stored branch of
--   the legacy ingest is the employee's home branch and is never used as proof. Unknown devices prove nothing.
-- * A timed invoice belongs to the branch of the doctor's latest proven punch at or before it inside the shift
--   (+-60 min), so a doctor who moves branch mid-shift is followed punch by punch.
-- * A date-only import (00:00 UTC, no time of day) is verified only at day level: every punched shift touching
--   that date is proven at the invoice branch. It gets a shift class only when exactly one punched shift
--   touches that date; otherwise the peer comparison drops that day's hours and sales together.
-- * Categories: attendance_verified (time or day evidence), identity_only, uncertain, zero_value. Nothing is
--   dropped; only attendance_verified feeds comparable productivity.
-- * Authorization: the caller's sales scope; a branch-scoped caller only ever reads that branch's invoices,
--   attendance and reviews. Conversion needs view_reviews. Internal functions are not exposed to API roles.

-- 1. Device → branch registry: only devices whose branch is proven (see docs). Device 105 «بسيسه» and events
--    without a device id are deliberately absent.
create table if not exists public.biometric_device_branches (
  external_device_id text primary key,
  branch text not null,
  evidence text not null,
  confirmed_by text,
  created_at timestamptz not null default now()
);
alter table public.biometric_device_branches enable row level security;
revoke all on public.biometric_device_branches from public, anon, authenticated;
insert into public.biometric_device_branches (external_device_id, branch, evidence) values
  ('GED7242701324', 'فرع الشامي', 'sent only by zk_shami_direct_bridge (allowed_branches = فرع الشامي); payload branch فرع الشامي; 79/79 same-shift sales at فرع الشامي'),
  ('GED7242701315', 'فرع شكري', 'sent only by zk_shokry_direct_bridge (allowed_branches = فرع شكري); payload branch فرع شكري; 44/45 same-shift sales at فرع شكري'),
  ('102', 'فرع الشامي', 'vendor device_location «الشامى»; 62/62 same-shift sales at فرع الشامي'),
  ('101', 'فرع شكري', 'vendor device_location «شكرى القواتلى»; 46/52 same-shift sales at فرع شكري')
on conflict (external_device_id) do nothing;

-- 2. Attendance days. branch is set only when every proven punch of the shift is at one branch.
create or replace function public.dawaa_doctor_attendance_days_v1(p_staff_ids uuid[], p_start date, p_end date)
returns table (staff_id uuid, attendance_date date, branch text, branch_source text, stored_branch text, status text,
               hours numeric, win_start timestamptz, win_end timestamptz, shift text)
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with days as (
    select a.* from public.attendance_daily_summary a
    where a.staff_id = any(p_staff_ids)
      and a.attendance_date >= p_start - 1 and a.attendance_date < p_end
      and (a.first_in is not null or a.last_out is not null)
  ),
  proof as (
    select d.id, count(distinct db.branch) branches, min(db.branch) branch
    from days d
    join public.biometric_attendance_logs l
      on l.staff_id = d.staff_id
     and l.punch_time between coalesce(d.first_in, d.last_out) - interval '1 minute' and coalesce(d.last_out, d.first_in) + interval '1 minute'
    join public.biometric_device_branches db on db.external_device_id = coalesce(l.raw_payload ->> 'external_device_id', l.device_id::text)
    group by d.id
  )
  select d.staff_id, d.attendance_date,
         case when p.branches = 1 then p.branch end,
         case when p.branches = 1 then 'device' when p.branches > 1 then 'mixed' else 'unproven' end,
         d.branch, d.status,
         case when d.status = 'approved' then d.payroll_eligible_hours when d.status = 'pending_review' then d.candidate_hours end,
         coalesce(d.first_in, d.scheduled_start_at), coalesce(d.last_out, d.scheduled_end_at),
         case
           when coalesce(d.scheduled_start_at, d.first_in) is null then 'unknown'
           when extract(hour from coalesce(d.scheduled_start_at, d.first_in) at time zone 'Africa/Cairo') >= 5
            and extract(hour from coalesce(d.scheduled_start_at, d.first_in) at time zone 'Africa/Cairo') < 13 then 'morning'
           when extract(hour from coalesce(d.scheduled_start_at, d.first_in) at time zone 'Africa/Cairo') >= 13
            and extract(hour from coalesce(d.scheduled_start_at, d.first_in) at time zone 'Africa/Cairo') < 21 then 'evening'
           else 'night'
         end
  from days d left join proof p on p.id = d.id
$function$;

-- 3. Invoice-level reconciliation. One row per (invoice, candidate doctor); nothing is dropped.
create or replace function public.dawaa_doctor_sales_reconciliation_v1(p_staff_ids uuid[], p_branch text, p_start date, p_end date)
returns table (invoice_id text, staff_id uuid, branch text, invoice_number text, invoice_at timestamptz, sale_day date,
               date_only boolean, amount numeric, customer_key text, attribution text, category text, reason text,
               evidence text, shift_date date, shift text, attendance_status text, attendance_branch text, seller_norm text)
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
  punches as materialized (
    select l.staff_id, l.punch_time, db.branch
    from public.biometric_attendance_logs l
    join public.biometric_device_branches db on db.external_device_id = coalesce(l.raw_payload ->> 'external_device_id', l.device_id::text)
    where l.staff_id = any(p_staff_ids)
      and l.punch_time >= ((p_start - 2)::timestamp at time zone 'Africa/Cairo')
      and l.punch_time < ((p_end + 2)::timestamp at time zone 'Africa/Cairo')
  ),
  timed as (
    -- Shift that contains the invoice, then the branch of the doctor's latest proven punch before it
    -- (or the first one after it when the invoice is inside the opening tolerance).
    select a.invoice_id, a.staff_id, s.attendance_date shift_date, s.shift, s.status,
           coalesce(
             (select p.branch from punches p where p.staff_id = a.staff_id and p.punch_time <= a.invoice_at
                and p.punch_time >= s.win_start - interval '60 minutes' order by p.punch_time desc limit 1),
             (select p.branch from punches p where p.staff_id = a.staff_id and p.punch_time > a.invoice_at
                and p.punch_time <= coalesce(s.win_end, s.win_start + interval '14 hours') + interval '60 minutes' order by p.punch_time limit 1)
           ) punch_branch
    from attributed a
    join lateral (
      select d.* from days d
      where d.staff_id = a.staff_id and d.attendance_date in (a.sale_day, a.sale_day - 1)
        and a.invoice_at >= d.win_start - interval '60 minutes'
        and a.invoice_at < coalesce(d.win_end, d.win_start + interval '14 hours') + interval '60 minutes'
      order by abs(extract(epoch from (a.invoice_at - d.win_start))) limit 1
    ) s on true
    where not a.date_only
  ),
  dated as (
    -- Day-level evidence for a date-only import: every punched shift touching that calendar day.
    select a.invoice_id, a.staff_id,
           count(*) shifts,
           count(*) filter (where d.branch_source = 'device' and d.branch = a.branch) proven_same,
           count(*) filter (where d.branch_source = 'device' and d.branch <> a.branch) proven_other,
           max(d.attendance_date) filter (where d.attendance_date = a.sale_day) same_day,
           max(d.attendance_date) shift_date, max(d.status) status,
           -- A date-only sale belongs to a shift class only when exactly one punched shift touches its day.
           case when count(*) = 1 then max(d.shift) end shift
    from attributed a
    join days d on d.staff_id = a.staff_id and d.attendance_date in (a.sale_day, a.sale_day - 1)
     and d.win_start < ((a.sale_day + 1)::timestamp at time zone 'Africa/Cairo')
     and coalesce(d.win_end, d.win_start + interval '14 hours') > (a.sale_day::timestamp at time zone 'Africa/Cairo')
    where a.date_only
    group by a.invoice_id, a.staff_id
  ),
  placed as (
    select a.*, t.shift_date t_day, t.shift t_shift, t.status t_status, t.punch_branch,
           dd.shifts d_shifts, dd.proven_same, dd.proven_other, coalesce(dd.same_day, dd.shift_date) d_day, dd.status d_status, dd.shift d_shift,
           (select count(*) from public.sales_invoices x
             where x.invoice_number = a.invoice_number
               and coalesce(nullif(btrim(x.branch_name), ''), nullif(btrim(x.branch), '')) = a.branch) number_rows
    from attributed a
    left join timed t on t.invoice_id = a.invoice_id and t.staff_id = a.staff_id
    left join dated dd on dd.invoice_id = a.invoice_id and dd.staff_id = a.staff_id
  ),
  judged as (
    select p.*,
      case
        when p.amount <= 0 then 'non_positive_amount'
        when p.attribution = 'ambiguous_name' then 'seller_name_shared'
        when p.number_rows > 1 then 'duplicate_invoice_number'
        when not p.date_only and p.t_day is null then 'no_punched_shift'
        when not p.date_only and p.punch_branch is null then 'attendance_branch_unproven'
        when not p.date_only and p.punch_branch <> p.branch then 'attendance_other_branch'
        when not p.date_only then 'inside_punched_shift'
        when p.d_shifts is null then 'date_only_no_shift'
        when p.proven_other > 0 then 'attendance_other_branch'
        when p.proven_same < p.d_shifts then 'attendance_branch_unproven'
        else 'date_only_day_evidence'
      end reason
    from placed p
  )
  select j.invoice_id, j.staff_id, j.branch, j.invoice_number, j.invoice_at, j.sale_day, j.date_only, j.amount, j.customer_key,
         j.attribution,
         case when j.reason = 'non_positive_amount' then 'zero_value'
              when j.reason in ('inside_punched_shift', 'date_only_day_evidence') then 'attendance_verified'
              when j.reason in ('no_punched_shift', 'date_only_no_shift') then 'identity_only'
              else 'uncertain' end,
         j.reason,
         case when j.reason = 'inside_punched_shift' then 'time' when j.reason = 'date_only_day_evidence' then 'day' end,
         case when j.reason = 'inside_punched_shift' then j.t_day when j.reason = 'date_only_day_evidence' then j.d_day end,
         case when j.reason = 'inside_punched_shift' then j.t_shift when j.reason = 'date_only_day_evidence' then j.d_shift end,
         case when j.date_only then j.d_status else j.t_status end,
         case when j.date_only then null else j.punch_branch end,
         j.norm
  from judged j
$function$;

revoke all on function public.dawaa_doctor_attendance_days_v1(uuid[], date, date) from public, anon, authenticated;
revoke all on function public.dawaa_doctor_sales_reconciliation_v1(uuid[], text, date, date) from public, anon, authenticated;

-- 4. Doctor Performance Eye read.
create or replace function public.get_doctor_sales_reconciliation_v1(p_staff_id uuid, p_window_start date, p_window_end date)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_scope text;
  v_branch text;
  v_reviews boolean;
  v_result jsonb;
begin
  if p_staff_id is null or p_window_start is null or p_window_end is null
     or p_window_end <= p_window_start or p_window_end - p_window_start > 190 then
    raise exception 'invalid_reconciliation_window' using errcode = '22023';
  end if;
  perform public.dawaa_assert_staff_sales_scope_v1(p_staff_id);
  -- A branch-scoped caller reads only its own branch, even for a doctor who also worked elsewhere.
  v_scope := public.dawaa_current_sales_invoice_scope_v1(array['view_dashboard','view_sales','view_all_invoices','view_quarterly_incentives','view_points']);
  v_branch := case when v_scope = 'ALL' then null else v_scope end;
  v_reviews := public.dawaa_current_actor_can(array['view_reviews']);

  with cycles as (
    select gs::date s, (gs + interval '1 month')::date e
    from generate_series(p_window_start::timestamp, (p_window_end - interval '1 month')::timestamp, interval '1 month') gs
  ),
  rec as materialized (
    select * from public.dawaa_doctor_sales_reconciliation_v1(array[p_staff_id], v_branch, p_window_start, p_window_end)
  ),
  days as materialized (
    select * from public.dawaa_doctor_attendance_days_v1(array[p_staff_id], p_window_start, p_window_end) d
    where d.attendance_date >= p_window_start
      -- A branch-scoped caller sees only days proven at its branch.
      and (v_branch is null or d.branch = v_branch)
  ),
  day_sales as (
    select r.shift_date, sum(r.amount) sales, count(*) invoices
    from rec r where r.category = 'attendance_verified' group by r.shift_date
  ),
  reviews as materialized (
    select r.id, btrim(r.invoice_number) num, r.branch, r.customer_code, r.customer_phone, r.customer_id::text cid,
           -- Conversion clock starts at the customer's first message (fallback: conversation date).
           r.converted_to_sale, coalesce(r.first_customer_message_at, r.conversation_date, r.created_at) at_ts,
           (coalesce(r.conversation_date, r.created_at) at time zone 'Africa/Cairo')::date d
    from public.conversation_sales_reviews_canonical_v2 r
    where v_reviews
      and (r.doctor_id::text = p_staff_id::text or r.staff_id::text = p_staff_id::text)
      and (v_branch is null or r.branch = v_branch)
      and coalesce(r.conversation_date, r.created_at) >= (p_window_start::timestamp at time zone 'Africa/Cairo')
      and coalesce(r.conversation_date, r.created_at) < (p_window_end::timestamp at time zone 'Africa/Cairo')
  ),
  candidates as (
    -- Invoices carrying the cited number for the same customer, from the first message to 48h after it.
    -- Customer + time disambiguate numbers that repeat across branches; the review's branch label is not trusted.
    select rv.id review_id, si.id::text invoice_id, coalesce(nullif(btrim(si.branch_name), ''), nullif(btrim(si.branch), '')) branch,
           exists (select 1 from rec x where x.invoice_id = si.id::text and x.attribution <> 'ambiguous_name') sold_by_doctor
    from reviews rv
    join public.sales_invoices si on si.invoice_number = rv.num
    where rv.converted_to_sale and rv.num is not null and rv.num <> ''
      and (v_branch is null or coalesce(nullif(btrim(si.branch_name), ''), nullif(btrim(si.branch), '')) = v_branch)
      -- An invoice before the customer's first message is an earlier purchase, not a conversion (evidence in docs).
      and si.invoice_date >= rv.at_ts and si.invoice_date <= rv.at_ts + interval '48 hours'
      and coalesce(nullif(si.net_total, 0), nullif(si.net_amount, 0), nullif(si.amount, 0), 0) > 0
      and (coalesce(nullif(btrim(si.customer_code), ''), '#') = coalesce(nullif(btrim(rv.customer_code), ''), '§')
           or (si.customer_id is not null and si.customer_id::text = rv.cid)
           or (length(regexp_replace(coalesce(rv.customer_phone, ''), '\D', '', 'g')) >= 10
               and right(regexp_replace(coalesce(si.customer_phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(coalesce(rv.customer_phone, ''), '\D', '', 'g'), 10)))
  ),
  review_class as (
    select rv.d,
      case when rv.converted_to_sale is false then 'no_sale'
           when rv.converted_to_sale is null then 'unknown'
           when rv.num is null or rv.num = '' then 'claimed_without_invoice'
           when (select count(*) from candidates c where c.review_id = rv.id) = 0 then
             -- Existence is checked only inside the caller's readable branch: no hint about other branches.
             case when not exists (select 1 from public.sales_invoices si where si.invoice_number = rv.num
                                     and (v_branch is null or coalesce(nullif(btrim(si.branch_name), ''), nullif(btrim(si.branch), '')) = v_branch)) then 'invoice_missing'
                  else 'invoice_not_matching_customer_or_time' end
           when (select count(*) from candidates c where c.review_id = rv.id) > 1 then 'invoice_ambiguous'
           -- The same invoice proven for another review of the same customer: neither review owns it.
           when exists (select 1 from candidates c join candidates o on o.invoice_id = c.invoice_id and o.review_id <> c.review_id where c.review_id = rv.id) then 'invoice_reused'
           when (select bool_and(c.sold_by_doctor) from candidates c where c.review_id = rv.id) then 'verified'
           else 'served_other_seller' end cls
    from reviews rv
  )
  select jsonb_build_object(
    'staffId', p_staff_id,
    'windowStart', p_window_start, 'windowEnd', p_window_end,
    'scopeBranch', v_branch,
    'reviewsVisible', v_reviews,
    'cycles', (select coalesce(jsonb_agg(jsonb_build_object(
        'start', c.s, 'endExclusive', c.e,
        'categories', (select coalesce(jsonb_object_agg(x.category, jsonb_build_object('invoices', x.n, 'sales', x.sales)), '{}'::jsonb)
                       from (select r.category, count(*) n, coalesce(sum(r.amount), 0) sales from rec r
                             where r.sale_day >= c.s and r.sale_day < c.e group by r.category) x),
        'reasons', (select coalesce(jsonb_object_agg(x.reason, x.n), '{}'::jsonb)
                    from (select r.reason, count(*) n from rec r where r.sale_day >= c.s and r.sale_day < c.e group by r.reason) x),
        'attendance', (select jsonb_build_object(
            'presentDays', count(*),
            -- Productivity denominators use only days whose branch is proven (device or per-punch mixed): sales of an
            -- unproven day can never be verified, so its days and hours must not dilute the rate either.
            'provenDays', count(*) filter (where d.branch_source <> 'unproven'),
            'settledDays', count(*) filter (where d.status = 'approved'),
            'pendingDays', count(*) filter (where d.status <> 'approved'),
            'approvedHours', coalesce(sum(d.hours) filter (where d.status = 'approved' and coalesce(d.hours, 0) > 0 and d.branch_source <> 'unproven'), 0),
            'approvedDaysWithHours', count(*) filter (where d.status = 'approved' and coalesce(d.hours, 0) > 0 and d.branch_source <> 'unproven'),
            'pendingHours', coalesce(sum(d.hours) filter (where d.status <> 'approved'), 0),
            'daysWithoutHours', count(*) filter (where coalesce(d.hours, 0) = 0),
            'unprovenBranchDays', count(*) filter (where d.branch_source <> 'device'),
            'otherBranchDays', count(*) filter (where d.branch is not null and d.branch <> d.stored_branch),
            'lastDay', max(d.attendance_date))
          from days d where d.attendance_date >= c.s and d.attendance_date < c.e),
        'productivity', (select jsonb_build_object(
            'verifiedSales', coalesce(sum(ds.sales), 0),
            'verifiedInvoices', coalesce(sum(ds.invoices), 0),
            'verifiedSalesSettledDays', coalesce(sum(ds.sales) filter (where d.status = 'approved' and coalesce(d.hours, 0) > 0 and d.branch_source <> 'unproven'), 0),
            'daysWithVerifiedSales', count(ds.shift_date))
          from days d left join day_sales ds on ds.shift_date = d.attendance_date
          where d.attendance_date >= c.s and d.attendance_date < c.e),
        'conversion', case when v_reviews then (select coalesce(jsonb_object_agg(x.cls, x.n), '{}'::jsonb)
                       from (select rc.cls, count(*) n from review_class rc where rc.d >= c.s and rc.d < c.e group by rc.cls) x) end
      ) order by c.s), '[]'::jsonb) from cycles c)
  ) into v_result;
  return v_result;
end
$function$;

revoke all on function public.get_doctor_sales_reconciliation_v1(uuid, date, date) from public;
grant execute on function public.get_doctor_sales_reconciliation_v1(uuid, date, date) to anon, authenticated, service_role;

-- 5. Peer comparison on the same reconciliation (self-contained: the never-applied 20261008090000 is retired; same signature,
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
    -- Only shifts proven at this branch by the punching device count toward its hours.
    where d.branch_source = 'device' and d.branch = p_branch and d.attendance_date >= p_window_start
  ),
  unplaced_days as (
    -- Days holding a verified sale with no shift class (a date-only import on a day touched by two shifts):
    -- their hours and sales leave the per-shift ratio together, so numerator and denominator always match.
    select distinct staff_id, shift_date from placed where shift_date is not null and shift is null
  ),
  productive_days as (
    select a.* from att a
    where a.hours > 0 and a.win_start is not null and a.win_end is not null and a.win_end > a.win_start
      and not exists (select 1 from unplaced_days u where u.staff_id = a.staff_id and u.shift_date = a.attendance_date)
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
