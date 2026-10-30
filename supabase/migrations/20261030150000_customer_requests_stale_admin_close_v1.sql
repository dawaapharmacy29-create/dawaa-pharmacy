-- Administrative close of stale customer requests (owner request 2026-10-30: "نظف الطلبات المفتوحه").
-- Rule: still open (not delivered/closed/cancelled/not_available) and no movement for 30 days — the newest of
-- created_at, the source update and the last action is older than 30 days.
-- They become 'cancelled', never 'closed': the doctor-points trigger treats 'closed' as fulfilled and would
-- award points. Nothing is deleted; the previous status is kept in customer_request_admin_closures so the
-- step can be reversed, and every request gets an event row. The DawaaWael sync is forward-only, so a later
-- 'طلب جديد' from the source does not reopen them; a real delivery from the source is flagged as a conflict.

create table if not exists public.customer_request_admin_closures (
  request_id uuid primary key references public.customer_requests(id),
  old_status text not null,
  old_closed_at timestamptz,
  rule text not null,
  closed_at timestamptz not null default now()
);
alter table public.customer_request_admin_closures enable row level security;
revoke all on public.customer_request_admin_closures from anon, authenticated;

with stale as (
  select cr.id, cr.status, cr.closed_at
  from public.customer_requests cr
  where cr.status not in ('delivered', 'closed', 'cancelled', 'not_available')
    and greatest(cr.created_at, coalesce(cr.source_updated_at, cr.created_at), coalesce(cr.last_action_at, cr.created_at))
        < now() - interval '30 days'
)
insert into public.customer_request_admin_closures (request_id, old_status, old_closed_at, rule)
select id, status, closed_at, 'stale_30_days_v1' from stale
on conflict (request_id) do nothing;

update public.customer_requests cr
   set status = 'cancelled', closed_at = now(), updated_at = now()
  from public.customer_request_admin_closures c
 where c.request_id = cr.id and c.rule = 'stale_30_days_v1'
   and cr.status = c.old_status;

insert into public.customer_request_events (request_id, old_status, new_status, action, notes, created_by_name, created_at)
select c.request_id, c.old_status, 'cancelled', 'إغلاق إداري',
       'طلب مفتوح من غير أي حركة أكتر من 30 يوم — اتقفل في تنظيف الطلبات القديمة (يرجع من customer_request_admin_closures)',
       'تنظيف إداري', now()
from public.customer_request_admin_closures c
where c.rule = 'stale_30_days_v1'
  and not exists (select 1 from public.customer_request_events e
                  where e.request_id = c.request_id and e.action = 'إغلاق إداري');
