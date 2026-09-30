-- Integration test for V53 Canonical Review Points Gate.
-- Run against the real schema inside a transaction and roll back all probe changes.

begin;

do $test$
declare
  v_nonofficial_tx uuid;
  v_official_tx uuid;
  v_blocked boolean := false;
  v_original_status text;
begin
  select et.id
    into v_nonofficial_tx
  from public.employee_transactions et
  join public.conversation_sales_reviews r on r.id = et.source_id
  left join public.conversation_sales_reviews_official_v1 o on o.id = r.id
  where o.id is null
    and et.source in (
      'whatsapp_automatic_review',
      'conversation_evaluation',
      'conversation_review',
      'conversation_sales_reviews'
    )
  order by et.updated_at desc nulls last, et.created_at desc
  limit 1;

  if v_nonofficial_tx is null then
    raise exception 'V53_TEST no non-official review transaction fixture exists';
  end if;

  select status into v_original_status
  from public.employee_transactions
  where id = v_nonofficial_tx;

  begin
    update public.employee_transactions
    set status = 'active'
    where id = v_nonofficial_tx;
  exception
    when check_violation then
      if sqlerrm = 'conversation_review_points_require_official_review' then
        v_blocked := true;
      else
        raise;
      end if;
  end;

  if not v_blocked then
    raise exception 'V53_TEST T1 non-official review points activation was not blocked';
  end if;

  select et.id
    into v_official_tx
  from public.employee_transactions et
  join public.conversation_sales_reviews_official_v1 r on r.id = et.source_id
  where et.source in (
      'whatsapp_automatic_review',
      'conversation_evaluation',
      'conversation_review',
      'conversation_sales_reviews'
    )
  order by et.updated_at desc nulls last, et.created_at desc
  limit 1;

  if v_official_tx is null then
    raise exception 'V53_TEST no official review transaction fixture exists';
  end if;

  -- A no-op live-status update on an official review must pass the trigger.
  update public.employee_transactions
  set status = status
  where id = v_official_tx;

  if exists (
    select 1
    from public.employee_transactions et
    join public.conversation_sales_reviews r on r.id = et.source_id
    left join public.conversation_sales_reviews_official_v1 o on o.id = r.id
    where o.id is null
      and et.source in (
        'whatsapp_automatic_review',
        'conversation_evaluation',
        'conversation_review',
        'conversation_sales_reviews'
      )
      and et.status in ('active','approved','pending')
  ) then
    raise exception 'V53_TEST T2 live non-official review points remain';
  end if;

  raise notice 'V53_TEST PASS: historical review points fail closed; official review points remain writable.';
end
$test$;

rollback;
