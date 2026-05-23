-- Backup Moaz before deleting legacy point tables
-- Run this manually in Supabase SQL editor only after reviewing the table list.
-- This script backs up old tables into schema backup_moaz, then includes commented delete commands.

begin;

create schema if not exists backup_moaz;

-- Back up legacy tables if they exist.
do $$
begin
  if to_regclass('public.point_records') is not null then
    execute 'create table if not exists backup_moaz.point_records_backup as table public.point_records';
  end if;

  if to_regclass('public.points_log') is not null then
    execute 'create table if not exists backup_moaz.points_log_backup as table public.points_log';
  end if;

  if to_regclass('public.points_transactions') is not null then
    execute 'create table if not exists backup_moaz.points_transactions_backup as table public.points_transactions';
  end if;
end $$;

-- Verify backup row counts before deleting anything.
create temp table if not exists backup_moaz_row_counts (
  table_name text,
  row_count bigint
) on commit drop;

truncate backup_moaz_row_counts;

do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('public.point_records', 'public.point_records'),
      ('backup_moaz.point_records_backup', 'backup_moaz.point_records_backup'),
      ('public.points_log', 'public.points_log'),
      ('backup_moaz.points_log_backup', 'backup_moaz.points_log_backup'),
      ('public.points_transactions', 'public.points_transactions'),
      ('backup_moaz.points_transactions_backup', 'backup_moaz.points_transactions_backup')
    ) as t(label, relation_name)
  loop
    if to_regclass(item.relation_name) is not null then
      execute format('insert into backup_moaz_row_counts select %L, count(*) from %s', item.label, item.relation_name);
    else
      insert into backup_moaz_row_counts values (item.label, null);
    end if;
  end loop;
end $$;

select * from backup_moaz_row_counts order by table_name;

commit;

-- Delete phase is intentionally commented.
-- Run only after the backup row counts match and the app is deployed successfully.
--
-- drop table if exists public.point_records cascade;
-- drop table if exists public.points_log cascade;
-- drop table if exists public.points_transactions cascade;
