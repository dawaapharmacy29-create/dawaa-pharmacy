begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop table public.customer_service_daily_reviews;
drop function public.touch_customer_service_daily_review();

commit;
