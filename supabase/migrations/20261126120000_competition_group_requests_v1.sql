-- مسابقة الدكاترة: طلبات العملاء من جروب الواتساب (واللي بتتسجل من صفحة خدمة العملاء) بتتحسب للدكتور في نقط
-- «طلبات العملاء» زي التقييم الشهري بالظبط (قرار صاحب الصيدلية 2026-11-15): الطلب اللي في الجروب ومتسجل في
-- التطبيق لنفس العميل في نفس اليوم بيتحسب مرة واحدة، والملغي مابيتحسبش.

-- العميل بتاع الطلب: الكود، أو الموبايل (آخر ١٠ أرقام). فاضي لو مفيش ولا ده ولا ده.
create or replace function public.dawaa_request_customer_key_v1(p_code text, p_phone text)
returns text language sql immutable
set search_path = public, pg_catalog
as $$
  select case
    when c <> '' and c !~ '^0*$' then case when length(c) >= 10 then 'p:' || right(c, 10) else 'c:' || c end
    when length(p) >= 8 then 'p:' || right(p, 10)
    else '' end
  from (select regexp_replace(translate(coalesce(p_code, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g') as c,
               regexp_replace(translate(coalesce(p_phone, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g') as p) x;
$$;
grant execute on function public.dawaa_request_customer_key_v1(text, text) to anon, authenticated;

do $do$
declare
  v_def text := pg_get_functiondef('public.get_doctor_competition_scorecard_facts_v1'::regproc);
  v_from int := strpos(v_def, '  -- Customer requests, credited to the doctor who recorded them.');
  v_to int := strpos(v_def, '  where q.staff_id is not null;');
begin
  if v_from = 0 or v_to = 0 or v_to < v_from then
    raise exception 'scorecard_requests_block_not_found';
  end if;
  execute substr(v_def, 1, v_from - 1) || $blk$  -- Customer requests, credited to the doctor who recorded them: the app's requests plus the WhatsApp
  -- group requests (and those typed in the customer service page) that are not already in the app for
  -- the same customer on the same day (owner decision 2026-11-15, same rule as the monthly evaluation).
  with app as (
    select coalesce(nullif(r.source_recorded_staff_id::text, ''), nullif(r.created_by::text, '')) as staff_id,
           btrim(r.branch) as branch,
           r.status in ('delivered', 'available') as done,
           (r.created_at at time zone 'Africa/Cairo')::date as day,
           public.dawaa_request_customer_key_v1(r.customer_code, r.customer_phone) as ckey
    from public.customer_requests r
    where r.created_at >= (p_start::timestamp at time zone 'Africa/Cairo')
      and r.created_at < ((p_end + 1)::timestamp at time zone 'Africa/Cairo')
      and coalesce(r.status, '') <> 'cancelled'
  ), grp as (
    select k.*, row_number() over (partition by k.day, k.ckey order by k.sent_at, k.fingerprint) as rn
    from (
      select g.staff_id::text as staff_id, btrim(g.branch) as branch,
             coalesce(g.status, '') in ('available', 'notified', 'delivered') as done,
             g.request_day as day, g.sent_at, g.fingerprint,
             public.dawaa_request_customer_key_v1(g.customer_code, g.customer_phone) as ckey
      from public.customer_request_group_log_v1 g
      where g.request_day between p_start and p_end
        and coalesce(g.status, '') <> 'cancelled'
    ) k
    where k.ckey <> ''
  ), credited as (
    select a.staff_id, a.branch, a.done from app a
    union all
    select g.staff_id, g.branch, g.done from grp g
    where g.rn = 1 and not exists (select 1 from app a where a.day = g.day and a.ckey = g.ckey)
  )
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', q.staff_id, 'branch', q.branch, 'requests', q.requests,
           'fulfilled', q.fulfilled)), '[]'::jsonb)
    into v_requests
  from (
    select c.staff_id, c.branch, count(*)::int as requests, count(*) filter (where c.done)::int as fulfilled
    from credited c
    group by 1, 2
  ) q
  where q.staff_id is not null;
$blk$ || substr(v_def, v_to + length('  where q.staff_id is not null;') + 1);
end
$do$;
