-- Conversation review save hardening v2
-- Goals:
-- 1) future duplicate submissions are blocked with a canonical server fingerprint,
--    including rows where customer_name is NULL;
-- 2) a retry can never mutate the already-recorded points impact for the same review;
-- 3) repeated-error coaching notes are created at most once per review.

alter table public.conversation_sales_reviews
  add column if not exists submission_fingerprint text;

create or replace function public.set_conversation_review_submission_fingerprint_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_staff_key text;
  v_reviewer_key text;
  v_customer_key text;
  v_payload text;
begin
  if new.conversation_date is null then
    new.submission_fingerprint := null;
    return new;
  end if;

  v_staff_key := coalesce(
    new.staff_id::text,
    nullif(lower(trim(coalesce(new.staff_name, ''))), ''),
    '__no_staff__'
  );
  v_reviewer_key := coalesce(
    new.reviewer_id::text,
    nullif(lower(trim(coalesce(new.reviewer_name, ''))), ''),
    '__no_reviewer__'
  );
  v_customer_key := coalesce(
    nullif(trim(coalesce(new.customer_code, '')), ''),
    nullif(trim(coalesce(new.customer_id, '')), ''),
    nullif(lower(trim(coalesce(new.customer_name, ''))), ''),
    '__no_customer__'
  );

  v_payload := concat_ws(
    '|',
    v_staff_key,
    v_reviewer_key,
    to_char(new.conversation_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    v_customer_key
  );

  new.submission_fingerprint := encode(
    digest(convert_to(v_payload, 'UTF8'), 'sha256'),
    'hex'
  );
  return new;
end;
$$;

revoke all on function public.set_conversation_review_submission_fingerprint_v2()
  from public, anon, authenticated;

-- Trigger names are executed alphabetically for the same timing/event in PostgreSQL.
-- Prefix zz_ ensures reviewer/staff binding triggers run first, so the fingerprint
-- is based on the canonical identities actually accepted by RLS.
drop trigger if exists zz_set_conversation_review_submission_fingerprint_v2
  on public.conversation_sales_reviews;
create trigger zz_set_conversation_review_submission_fingerprint_v2
before insert on public.conversation_sales_reviews
for each row execute function public.set_conversation_review_submission_fingerprint_v2();

-- Do not backfill historical rows here: production already contains historical
-- duplicate submissions. The invariant applies prospectively without deleting data.
create unique index if not exists ux_conversation_review_submission_fingerprint_v2
  on public.conversation_sales_reviews(submission_fingerprint)
  where submission_fingerprint is not null;

create or replace function public.protect_conversation_review_points_payload_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if old.source = 'conversation_evaluation'
     and old.source_id is not null
     and new.source = old.source
     and new.source_id = old.source_id then
    -- A review's economic effect is immutable after first creation. Retries may
    -- progress status/approval metadata through the normal workflow, but cannot
    -- silently recalculate the signed points, reason, cycle, staff or evidence.
    new.staff_id := old.staff_id;
    new.employee_id := old.employee_id;
    new.employee_name := old.employee_name;
    new.type := old.type;
    new.title := old.title;
    new.reason := old.reason;
    new.description := old.description;
    new.amount := old.amount;
    new.points := old.points;
    new.points_delta := old.points_delta;
    new.base_points := old.base_points;
    new.final_points := old.final_points;
    new.repeat_count := old.repeat_count;
    new.source := old.source;
    new.source_id := old.source_id;
    new.transaction_date := old.transaction_date;
    new.month_cycle := old.month_cycle;
    new.branch := old.branch;
    new.category := old.category;
    new.metadata := old.metadata;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_conversation_review_points_payload_v1()
  from public, anon, authenticated;

drop trigger if exists protect_conversation_review_points_payload_v1
  on public.employee_transactions;
create trigger protect_conversation_review_points_payload_v1
before update on public.employee_transactions
for each row execute function public.protect_conversation_review_points_payload_v1();

-- A repeated-error coaching note is evidence attached to one review, not a free-form
-- repeatable side effect. Existing data has been checked and contains no duplicates.
create unique index if not exists ux_staff_coaching_review_category_once_v1
  on public.staff_coaching_notes(linked_record_id, category)
  where linked_table = 'conversation_sales_reviews'
    and linked_record_id is not null;
