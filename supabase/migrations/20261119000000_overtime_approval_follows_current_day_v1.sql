-- An overtime request whose day was edited after it was recorded could never be approved again:
-- decide_overtime_approval_v3 refused it (overtime_source_resolution_changed / _drifted) while the page asked to refresh,
-- which changed nothing. 39 of the 116 requests of the 2026-11 cycle were stuck on it.
-- The approval already recalculates the hours and the amount from the day as it is now, and re-links the request to it,
-- so the request simply follows the current day: both refusals go, every other check stays.

do $migration$
declare
  v_def text := pg_get_functiondef('public.decide_overtime_approval_v3(uuid,text,text)'::regprocedure);
  v_new text;
begin
  v_new := replace(v_def,
$old$    if v_ot.source_resolution_id is not null
       and v_ot.source_resolution_id<>v_resolution.id then
      raise exception 'overtime_source_resolution_changed' using errcode='55000';
    end if;
$old$, '');
  v_new := replace(v_new,
$old$    if v_ot.source_resolution_fingerprint is not null
       and v_ot.source_resolution_fingerprint<>v_fingerprint then
      raise exception 'overtime_source_resolution_drifted' using errcode='55000';
    end if;
$old$, '');
  if v_new = v_def or v_new like '%overtime_source_resolution_changed%' or v_new like '%overtime_source_resolution_drifted%' then
    raise exception 'decide_overtime_approval_v3 is not the expected version';
  end if;
  execute v_new;
end
$migration$;
