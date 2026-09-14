create or replace function public.dawaa_promote_biometric_attendance_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_map record; v_staff public.staff%rowtype; v_account public.staff_accounts%rowtype;
  v_effective timestamptz:=public.dawaa_fingerprint_effective_time_v1(new.provider,new.raw_payload,new.punch_time);
  v_decision jsonb; v_type text; v_duplicate_of uuid;
begin
  if new.staff_id is not null then select * into v_staff from public.staff s where s.id=new.staff_id and coalesce(s.active,false)=true limit 1; end if;
  if v_staff.id is null and nullif(trim(new.biometric_user_id),'') is not null then
    select m.staff_id,m.staff_account_id into v_map from public.biometric_staff_mapping m where m.active=true and m.provider=new.provider and m.biometric_user_id=new.biometric_user_id and (m.device_id=coalesce(new.device_id::text,'*') or m.device_id='*') order by (m.device_id=coalesce(new.device_id::text,'*')) desc,m.updated_at desc limit 1;
    if v_map.staff_id is not null then select * into v_staff from public.staff s where s.id=v_map.staff_id and coalesce(s.active,false)=true limit 1; end if;
    if v_staff.id is null and v_map.staff_account_id is not null then
      select * into v_account from public.staff_accounts a where a.id=v_map.staff_account_id limit 1;
      if trim(coalesce(v_account.staff_id,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then select * into v_staff from public.staff s where s.id=trim(v_account.staff_id)::uuid and coalesce(s.active,false)=true limit 1; end if;
    end if;
  end if;
  if v_staff.id is null then return null; end if;
  update public.biometric_attendance_logs set staff_id=v_staff.id,staff_name_snapshot=coalesce(nullif(staff_name_snapshot,''),v_staff.name),branch=v_staff.branch,punch_time=v_effective where id=new.id;
  v_decision:=public.dawaa_biometric_semantic_decision_v1(v_staff.id,v_effective,new.punch_type,new.id);
  v_type:=nullif(v_decision->>'semantic_type','');
  v_duplicate_of:=nullif(v_decision->>'duplicate_of_log_id','')::uuid;
  insert into public.biometric_semantic_decisions(biometric_log_id,staff_id,raw_type,semantic_type,decision,confidence,reason,schedule_date,scheduled_start_at,scheduled_end_at,duplicate_of_log_id,updated_at)
  values(new.id,v_staff.id,new.punch_type,v_type,coalesce(v_decision->>'decision','review'),nullif(v_decision->>'confidence','')::numeric,v_decision->>'reason',nullif(v_decision->>'schedule_date','')::date,nullif(v_decision->>'scheduled_start_at','')::timestamptz,nullif(v_decision->>'scheduled_end_at','')::timestamptz,v_duplicate_of,now())
  on conflict(biometric_log_id) do update set raw_type=excluded.raw_type,semantic_type=excluded.semantic_type,decision=excluded.decision,confidence=excluded.confidence,reason=excluded.reason,schedule_date=excluded.schedule_date,scheduled_start_at=excluded.scheduled_start_at,scheduled_end_at=excluded.scheduled_end_at,duplicate_of_log_id=excluded.duplicate_of_log_id,updated_at=now();
  if coalesce(v_decision->>'decision','')='accepted' and v_type is not null and v_effective is not null then
    insert into public.staff_attendance_logs(staff_id,staff_name,role,branch_name,attendance_type,recorded_at,shift_date,biometric_verified,biometric_method,device_id,status,biometric_source_log_id)
    values(v_staff.id,v_staff.name,v_staff.role,v_staff.branch,v_type,v_effective,coalesce(nullif(v_decision->>'schedule_date','')::date,(v_effective at time zone 'Africa/Cairo')::date),true,'fingerprint_terminal',new.device_id::text,'accepted',new.id)
    on conflict(biometric_source_log_id) where biometric_source_log_id is not null do nothing;
  end if;
  return null;
end;
$$;

create or replace function public.attendance_daily_intelligence_v1(p_date date default ((now() at time zone 'Africa/Cairo')::date), p_branch text default null)
returns table(staff_id uuid,staff_name text,branch text,raw_punches integer,effective_punches integer,duplicate_confirmations integer,smart_type_corrections integer,first_effective_punch timestamptz,last_effective_punch timestamptz,first_semantic_type text,last_semantic_type text,avg_confidence numeric,min_confidence numeric,needs_review integer,intelligence_status text)
language sql stable security definer set search_path=public,pg_catalog
as $$
with scoped as (
  select b.id,b.staff_id,coalesce(s.name,b.staff_name_snapshot,'غير محدد') staff_name,coalesce(s.branch,b.branch) branch,b.punch_time,b.punch_type,d.semantic_type,d.decision,d.confidence
  from public.biometric_attendance_logs b
  left join public.staff s on s.id=b.staff_id
  left join public.biometric_semantic_decisions d on d.biometric_log_id=b.id
  where b.staff_id is not null
    and b.punch_time >= (p_date::timestamp at time zone 'Africa/Cairo')-interval '4 hours'
    and b.punch_time < (((p_date+1)::timestamp at time zone 'Africa/Cairo')+interval '8 hours')
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(coalesce(s.branch,b.branch,''))=trim(p_branch))
    and public.dawaa_can_read_staff_attendance_log(b.staff_id,coalesce(s.branch,b.branch))
), agg as (
 select staff_id,max(staff_name) staff_name,max(branch) branch,count(*)::int raw_punches,
        count(*) filter(where decision='accepted')::int effective_punches,
        count(*) filter(where decision='duplicate')::int duplicate_confirmations,
        count(*) filter(where decision='accepted' and semantic_type is distinct from punch_type)::int smart_type_corrections,
        min(punch_time) filter(where decision='accepted') first_effective_punch,max(punch_time) filter(where decision='accepted') last_effective_punch,
        round(avg(confidence) filter(where decision='accepted')::numeric,2) avg_confidence,round(min(confidence) filter(where decision='accepted')::numeric,2) min_confidence,
        count(*) filter(where decision='review' or decision is null)::int needs_review
 from scoped group by staff_id
)
select a.staff_id,a.staff_name,a.branch,a.raw_punches,a.effective_punches,a.duplicate_confirmations,a.smart_type_corrections,a.first_effective_punch,a.last_effective_punch,
       (select x.semantic_type from scoped x where x.staff_id=a.staff_id and x.decision='accepted' order by x.punch_time asc,x.id asc limit 1),
       (select x.semantic_type from scoped x where x.staff_id=a.staff_id and x.decision='accepted' order by x.punch_time desc,x.id desc limit 1),
       a.avg_confidence,a.min_confidence,a.needs_review,
       case when a.needs_review>0 then 'needs_review' when a.duplicate_confirmations>0 or a.smart_type_corrections>0 then 'smart_adjusted' else 'clean' end
from agg a order by a.branch,a.staff_name;
$$;

grant execute on function public.attendance_daily_intelligence_v1(date,text) to authenticated,service_role;
notify pgrst,'reload schema';