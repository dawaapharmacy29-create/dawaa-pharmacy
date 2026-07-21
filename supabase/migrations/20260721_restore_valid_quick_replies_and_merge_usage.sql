begin;

create table if not exists public.quick_reply_scripts_restore_backup_20260721 as
select *, now() as backed_up_at
from public.quick_reply_scripts
where false;

insert into public.quick_reply_scripts_restore_backup_20260721
select q.*, now()
from public.quick_reply_scripts q
where not exists (
  select 1 from public.quick_reply_scripts_restore_backup_20260721 b where b.id = q.id
);

with duplicate_usage as (
  select a.id,
         sum(coalesce(i.usage_count, 0))::integer as extra_usage
  from public.quick_reply_scripts a
  join public.quick_reply_scripts i
    on i.active is false
   and not ('duplicate_message_corruption' = any(coalesce(i.tags, array[]::text[])))
   and (
     lower(trim(i.shortcut)) = lower(trim(a.shortcut))
     or trim(i.message_body) = trim(a.message_body)
   )
  where a.active is true
  group by a.id
)
update public.quick_reply_scripts q
set usage_count = coalesce(q.usage_count, 0) + d.extra_usage,
    updated_at = now(),
    tags = array(select distinct x from unnest(coalesce(q.tags, array[]::text[]) || array['usage_merged_from_archive']) x)
from duplicate_usage d
where q.id = d.id;

with candidates as (
  select q.id,
         row_number() over (
           partition by lower(trim(q.shortcut)), trim(q.message_body)
           order by coalesce(q.usage_count, 0) desc, q.created_at asc, q.id
         ) as rn
  from public.quick_reply_scripts q
  where q.active is false
    and not ('duplicate_message_corruption' = any(coalesce(q.tags, array[]::text[])))
    and lower(coalesce(q.title, '')) not like '%اختبار%'
    and length(trim(coalesce(q.message_body, ''))) >= 2
    and not exists (
      select 1
      from public.quick_reply_scripts a
      where a.active is true
        and (
          lower(trim(a.shortcut)) = lower(trim(q.shortcut))
          or trim(a.message_body) = trim(q.message_body)
        )
    )
)
update public.quick_reply_scripts q
set active = true,
    updated_at = now(),
    tags = array(select distinct x from unnest(coalesce(q.tags, array[]::text[]) || array['restored_valid_20260721']) x)
from candidates c
where q.id = c.id and c.rn = 1;

commit;
