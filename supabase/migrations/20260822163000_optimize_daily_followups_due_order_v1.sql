-- Match the operational queue ordering exactly so PostgreSQL can stop at LIMIT
-- instead of reading the whole open set and sorting it in memory.
create index if not exists daily_followups_open_due_order_v3_idx
on public.daily_followups (next_followup_date nulls first, created_at desc)
where coalesce(is_hidden,false)=false
  and completed_at is null
  and cancelled_at is null;

-- Superseded by v3: priority between next_followup_date and created_at prevented
-- the queue ORDER BY from using the index order directly.
drop index if exists public.daily_followups_open_due_v2_idx;
