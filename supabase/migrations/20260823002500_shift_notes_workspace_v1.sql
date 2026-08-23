create or replace function public.get_shift_notes_workspace_v1(
  p_filter text default 'today',
  p_dimension text default 'all',
  p_search text default null,
  p_user_name text default null,
  p_offset integer default 0,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with params as (
  select
    coalesce(nullif(btrim(p_filter), ''), 'today') as filter_key,
    coalesce(nullif(btrim(p_dimension), ''), 'all') as dimension_key,
    lower(nullif(btrim(p_search), '')) as search_key,
    nullif(btrim(p_user_name), '') as user_name,
    greatest(coalesce(p_offset, 0), 0) as row_offset,
    least(greatest(coalesce(p_limit, 100), 1), 200) as row_limit
), active as (
  select n.*
  from public.shift_notes n
  where n.deleted_at is null
), filtered as (
  select n.*
  from active n
  cross join params p
  where
    (
      p.filter_key = 'all'
      or (p.filter_key = 'mine' and p.user_name is not null and (n.assigned_to_name = p.user_name or n.author_name = p.user_name))
      or (p.filter_key = 'today' and n.due_at::date = current_date)
      or (p.filter_key = 'tomorrow' and n.due_at::date = current_date + 1)
      or (p.filter_key = 'overdue' and n.due_at < now() and coalesce(n.status, '') not in ('completed','cancelled'))
      or (p.filter_key = 'urgent' and coalesce(n.priority, '') in ('urgent','critical'))
      or (p_filter = 'recurring' and coalesce(n.is_recurring, false))
      or (p.filter_key = 'assigned_pending' and n.status = 'assigned_pending')
      or (p.filter_key = 'completed_today' and n.status = 'completed' and coalesce(n.closed_at, n.completed_at)::date = current_date)
      or (p.filter_key = 'archive' and coalesce(n.status, '') in ('completed','cancelled'))
      or (p.filter_key = 'postponed' and n.postponed_until is not null and coalesce(n.status, '') not in ('completed','cancelled'))
      or n.status = p.filter_key
    )
    and (
      p.dimension_key = 'all'
      or n.branch = p.dimension_key
      or n.note_type = p.dimension_key
      or n.assigned_to_name = p.dimension_key
    )
    and (
      p.search_key is null
      or lower(concat_ws(' ', n.title, n.details, n.customer_name, n.customer_phone, n.customer_code, n.invoice_no, n.branch, n.assigned_to_name, n.note_type, n.action_required)) like '%' || p.search_key || '%'
    )
), numbered as (
  select f.*, row_number() over (order by f.due_at asc nulls last, f.created_at desc) as rn
  from filtered f
), page_rows as (
  select to_jsonb(n) - 'rn' as row_data
  from numbered n
  cross join params p
  where n.rn > p.row_offset and n.rn <= p.row_offset + p.row_limit
  order by n.rn
), summary as (
  select jsonb_build_object(
    'total', count(*),
    'today', count(*) filter (where due_at::date = current_date),
    'overdue', count(*) filter (where due_at < now() and coalesce(status, '') not in ('completed','cancelled')),
    'urgent', count(*) filter (where coalesce(priority, '') in ('urgent','critical')),
    'pending', count(*) filter (where status = 'assigned_pending'),
    'recurring', count(*) filter (where coalesce(is_recurring, false) and due_at::date = current_date),
    'completed', count(*) filter (where status = 'completed' and coalesce(closed_at, completed_at)::date = current_date),
    'postponed', count(*) filter (where postponed_until is not null and coalesce(status, '') not in ('completed','cancelled')),
    'in_progress', count(*) filter (where status = 'in_progress')
  ) as value
  from active
), deleted as (
  select coalesce(jsonb_agg(to_jsonb(d) order by d.deleted_at desc), '[]'::jsonb) as value
  from (
    select * from public.shift_notes where deleted_at is not null order by deleted_at desc limit 30
  ) d
)
select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(row_data) from page_rows), '[]'::jsonb),
  'total', (select count(*) from filtered),
  'summary', (select value from summary),
  'deleted_rows', (select value from deleted),
  'page_size', (select row_limit from params),
  'offset', (select row_offset from params)
);
$$;

grant execute on function public.get_shift_notes_workspace_v1(text,text,text,text,integer,integer) to authenticated;
