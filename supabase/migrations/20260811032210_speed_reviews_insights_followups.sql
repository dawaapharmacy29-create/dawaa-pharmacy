create index if not exists daily_followups_reviews_insights_idx
on public.daily_followups (created_at desc)
where is_hidden = false and is_duplicate = false;
