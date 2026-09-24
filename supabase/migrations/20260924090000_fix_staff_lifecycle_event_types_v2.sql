-- The employment-event writer accepts status_change; the lifecycle projection
-- previously sent unsupported lifecycle_* values and rolled back approvals.
do $fix$ declare
  v_def text;
begin
  select pg_get_functiondef('public.hr_apply_due_staff_lifecycle_v2(uuid)'::regprocedure)
    into v_def;
  if v_def is null then raise exception 'Lifecycle function missing'; end if;
  if strpos(v_def,'''lifecycle_active''') > 0
     and strpos(v_def,'''lifecycle_leaving''') > 0
     and strpos(v_def,'''lifecycle_archived''') > 0 then
    v_def := replace(v_def,'''lifecycle_active''','''status_change''');
    v_def := replace(v_def,'''lifecycle_leaving''','''status_change''');
    v_def := replace(v_def,'''lifecycle_archived''','''status_change''');
    execute v_def;
  elsif strpos(v_def,'''lifecycle_active''') > 0
     or strpos(v_def,'''lifecycle_leaving''') > 0
     or strpos(v_def,'''lifecycle_archived''') > 0 then
    raise exception 'Unexpected partially migrated lifecycle function';
  end if;
end $fix$;
