-- Prevent a stale browser/session from silently overwriting a newer monthly evaluation.
-- The client sends the row updated_at it loaded. Existing rows are locked and compared
-- inside the same save transaction before the canonical upsert continues.

create or replace function public.trg_monthly_evaluation_concurrency_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_expected timestamptz;
begin
  -- The canonical save RPC copies expected_updated_at into metrics_snapshot only as a
  -- transport token. It is removed before persistence by this trigger.
  if tg_op = 'INSERT' then
    new.metrics_snapshot := coalesce(new.metrics_snapshot,'{}'::jsonb) - 'expected_updated_at';
    return new;
  end if;

  begin
    v_expected := nullif(new.metrics_snapshot->>'expected_updated_at','')::timestamptz;
  exception when others then
    raise exception 'monthly_evaluation_invalid_expected_version'
      using errcode='22007';
  end;

  if v_expected is null then
    raise exception 'monthly_evaluation_stale_write_reload_required'
      using errcode='40001',
            detail='Existing monthly evaluations require the version loaded by the editor.';
  end if;

  if old.updated_at is distinct from v_expected then
    raise exception 'monthly_evaluation_stale_write_reload_required'
      using errcode='40001',
            detail='Another session changed this evaluation after it was loaded. Reload before saving.';
  end if;

  new.metrics_snapshot := coalesce(new.metrics_snapshot,'{}'::jsonb) - 'expected_updated_at';
  return new;
end;
$function$;

drop trigger if exists aa_monthly_evaluation_concurrency_v5
  on public.staff_monthly_manager_evaluations;

create trigger aa_monthly_evaluation_concurrency_v5
before insert or update
on public.staff_monthly_manager_evaluations
for each row
execute function public.trg_monthly_evaluation_concurrency_v5();

revoke all on function public.trg_monthly_evaluation_concurrency_v5()
  from public,anon,authenticated;
grant execute on function public.trg_monthly_evaluation_concurrency_v5()
  to service_role;

notify pgrst,'reload schema';
