-- Fix Reports Center filters for conversation review exports.
-- The UI filters conversation_sales_reviews by review_date, while the table historically stored created_at/conversation_date.

alter table public.conversation_sales_reviews
  add column if not exists review_date date;

update public.conversation_sales_reviews
set review_date = coalesce(conversation_date::date, created_at::date)
where review_date is null;

create or replace function public.set_conversation_review_report_date()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.review_date := coalesce(
    new.review_date,
    new.conversation_date::date,
    new.created_at::date,
    current_date
  );
  return new;
end;
$$;

drop trigger if exists trg_conversation_review_report_date
  on public.conversation_sales_reviews;

create trigger trg_conversation_review_report_date
before insert or update of conversation_date, created_at, review_date
on public.conversation_sales_reviews
for each row
execute function public.set_conversation_review_report_date();

create index if not exists conversation_sales_reviews_review_date_idx
  on public.conversation_sales_reviews (review_date desc);

create index if not exists conversation_sales_reviews_branch_review_date_idx
  on public.conversation_sales_reviews (branch, review_date desc);
