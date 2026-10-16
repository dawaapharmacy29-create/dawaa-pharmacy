-- Guard refusal case for 20261016120000: Production's function changed after review. The migration must refuse.
create or replace function public.get_cleaning_daily_rating_cards_v2(p_rating_date date default null, p_branch text default null)
returns table(staff_id uuid, staff_name text, staff_role text, branch text, rating_date date, required_items integer, submitted_items integer, reviewed_items integer, approved_items integer, rejected_items integer, pending_items integer, max_stars integer, rating_ready boolean, rating_id uuid, stars integer, score_pct numeric, points_delta numeric, manager_note text, rated_by_name text, updated_at timestamp with time zone)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$ select null::uuid, 'changed_after_review'::text, null, null, null::date, 0, 0, 0, 0, 0, 0, 0, false, null::uuid, null::integer, null::numeric, null::numeric, null, null, null::timestamptz where false $function$;
