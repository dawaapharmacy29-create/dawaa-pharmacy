-- Keep the canonical/composite indexes and remove only structurally redundant btree indexes.
-- No unique/open-case guard indexes are touched here.

drop index if exists public.idx_daily_followups_followup_datetime;
drop index if exists public.idx_daily_followups_followup_date;
drop index if exists public.daily_followups_responsible_name_idx;
drop index if exists public.idx_daily_followups_branch;
