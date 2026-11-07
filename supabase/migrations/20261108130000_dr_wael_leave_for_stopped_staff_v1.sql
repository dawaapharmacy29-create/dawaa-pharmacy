-- A «موقوف» employee can be put on leave from بصمات د وائل (طلب المالك 2026-11-07: ا عبد الحميد إجازة مرضي، ود اسلام فاروق
-- إجازة لحين ما يرجع). Their status stays «موقوف»: going back to work is the separate lifecycle decision.
do $migration$
declare
  v_def text := pg_get_functiondef('public.dr_wael_set_leave_v1(uuid, text, date, date, text)'::regprocedure);
  v_old text := 's.id = p_staff_id and s.is_active is true';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'dr_wael_set_leave_v1 changed';
  end if;
  execute replace(v_def, v_old, $new$s.id = p_staff_id and (s.is_active is true or btrim(coalesce(s.status, '')) = 'موقوف')$new$);
end;
$migration$;
