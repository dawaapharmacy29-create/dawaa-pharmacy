-- Administrative close of every open customer request registered before 2026-11-21 (owner request 2026-11-21:
-- "اقفل كل الطلبات القديمه و خلينا نشتغل ع الطلبيات الجديده"). The daily customer service sheet starts from the
-- requests registered from today on.
-- Same pattern as 20261030150000_customer_requests_stale_admin_close_v1: they become 'cancelled', never 'closed'
-- (the doctor-points trigger treats 'closed' as fulfilled and would award points); nothing is deleted; the previous
-- status is kept in customer_request_admin_closures so the step can be reversed, and every request gets an event row.

with old_open as (
  select cr.id, cr.status, cr.closed_at
  from public.customer_requests cr
  where cr.status not in ('delivered', 'closed', 'cancelled', 'not_available')
    and cr.created_at < ('2026-11-21'::date::timestamp at time zone 'Africa/Cairo')
)
insert into public.customer_request_admin_closures (request_id, old_status, old_closed_at, rule)
select id, status, closed_at, 'owner_reset_2026_11_21_v1' from old_open
on conflict (request_id) do nothing;

update public.customer_requests cr
   set status = 'cancelled', closed_at = now(), updated_at = now()
  from public.customer_request_admin_closures c
 where c.request_id = cr.id and c.rule = 'owner_reset_2026_11_21_v1'
   and cr.status = c.old_status;

insert into public.customer_request_events (request_id, old_status, new_status, action, notes, created_by_name, created_at)
select c.request_id, c.old_status, 'cancelled', 'إغلاق إداري',
       'اتقفل في تصفير الطلبات القديمة يوم 21/11 بطلب المدير، والشغل بقى على الطلبات الجديدة (يرجع من customer_request_admin_closures)',
       'تنظيف إداري', now()
from public.customer_request_admin_closures c
where c.rule = 'owner_reset_2026_11_21_v1'
  and not exists (select 1 from public.customer_request_events e
                  where e.request_id = c.request_id and e.notes like 'اتقفل في تصفير الطلبات القديمة يوم 21/11%');
