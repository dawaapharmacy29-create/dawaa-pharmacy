-- Owner-reviewed exclusions. Keep immutable raw events for investigation;
-- only remove these source/code pairs from Dawaa pharmacy attendance scope.
with excluded(provider,code,source_branch,reason) as (values
  ('zk_shokry_direct_bridge','228','فرع شكري','Owner excluded unknown code 228 on 2026-09-23'),
  ('zk_shokry_direct_bridge','278','فرع شكري','Owner excluded Zakaria employee 278 on 2026-09-23'),
  ('zk_shami_direct_bridge','278','فرع الشامي','Owner excluded Zakaria employee 278 on 2026-09-23')
)
insert into public.biometric_employee_scope
  (provider,biometric_user_id,source_branch,canonical_branch,in_scope,source_note,updated_at)
select e.provider,e.code,e.source_branch,null,false,e.reason,now()
from excluded e
where exists (select 1 from public.biometric_attendance_logs b
  where b.provider=e.provider and b.biometric_user_id=e.code)
on conflict(provider,biometric_user_id) do update
  set canonical_branch=null,in_scope=false,source_note=excluded.source_note,updated_at=now();

-- The review summary must count the same in-scope source/code pairs as the
-- mapping queue. Keep the rest of the reviewed function unchanged.
do $fix$ declare
  v_def text;
  v_old text := $old$  from public.biometric_attendance_logs b
  where b.staff_id is null
    and (b.punch_time at time zone 'Africa/Cairo')::date between p_start and p_end$old$;
  v_new text := $new$  from public.biometric_attendance_logs b
  left join public.biometric_employee_scope sc
    on sc.provider=b.provider and sc.biometric_user_id=b.biometric_user_id
  where b.staff_id is null and coalesce(sc.in_scope,true)=true
    and (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) at time zone 'Africa/Cairo')::date between p_start and p_end$new$;
begin
  select pg_get_functiondef('public.attendance_review_triage_v1(date,date,text)'::regprocedure) into v_def;
  if strpos(v_def,v_old)>0 then v_def:=replace(v_def,v_old,v_new); end if;
  if strpos(v_def,'count(distinct b.biometric_user_id)::int unmapped_codes')>0 then
    v_def:=replace(v_def,'count(distinct b.biometric_user_id)::int unmapped_codes',
      'count(distinct (b.provider,b.biometric_user_id))::int unmapped_codes');
  end if;
  if strpos(v_def,'coalesce(sc.in_scope,true)=true')=0
    or strpos(v_def,'count(distinct (b.provider,b.biometric_user_id))::int unmapped_codes')=0 then
    raise exception 'Unexpected attendance triage definition; no migration applied';
  end if;
  execute v_def;
end $fix$;
