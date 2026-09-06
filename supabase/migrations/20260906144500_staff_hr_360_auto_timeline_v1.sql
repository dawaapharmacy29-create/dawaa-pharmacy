-- HR 360 automatic timeline capture v1
-- Never depend on a manager remembering to add promotion / transfer / responsibility events manually.

create or replace function public.capture_staff_hr_timeline_change_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_actor text;
  v_actor_name text;
  v_type text;
  v_title text;
  v_old jsonb;
  v_new jsonb;
  v_payload jsonb;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  begin v_actor:=public.dawaa_current_staff_account_id_strict(); exception when others then v_actor:=null; end;
  if v_actor is not null then select name into v_actor_name from public.staff_accounts where id::text=v_actor limit 1; end if;

  if old.role is distinct from new.role then
    v_type:='promotion';
    v_title:='تغيير الدور / ترقية';
    v_old:=jsonb_build_object('role',old.role);
    v_new:=jsonb_build_object('role',new.role);
    v_payload:=jsonb_build_object('staff_id',new.id,'type',v_type,'old',v_old,'new',v_new,'actor',v_actor,'at',now());
    insert into public.staff_employment_events_v1(staff_id,event_type,effective_date,title,description,old_value,new_value,source,source_id,created_by,created_by_name,evidence_hash)
    values(new.id,v_type,current_date,v_title,concat('من ',coalesce(old.role,'غير محدد'),' إلى ',coalesce(new.role,'غير محدد')),v_old,v_new,'staff_update',new.id::text,v_actor,v_actor_name,public.hr360_hash_payload_v1(v_payload));
  end if;

  if old.branch is distinct from new.branch then
    v_type:='branch_transfer'; v_title:='نقل فرع';
    v_old:=jsonb_build_object('branch',old.branch); v_new:=jsonb_build_object('branch',new.branch);
    v_payload:=jsonb_build_object('staff_id',new.id,'type',v_type,'old',v_old,'new',v_new,'actor',v_actor,'at',now());
    insert into public.staff_employment_events_v1(staff_id,event_type,effective_date,title,description,old_value,new_value,source,source_id,created_by,created_by_name,evidence_hash)
    values(new.id,v_type,current_date,v_title,concat('من ',coalesce(old.branch,'غير محدد'),' إلى ',coalesce(new.branch,'غير محدد')),v_old,v_new,'staff_update',new.id::text,v_actor,v_actor_name,public.hr360_hash_payload_v1(v_payload));
  end if;

  if old.shift is distinct from new.shift or old.shift_start is distinct from new.shift_start or old.shift_end is distinct from new.shift_end then
    v_type:='responsibility_change'; v_title:='تغيير الشيفت / المسؤولية التشغيلية';
    v_old:=jsonb_build_object('shift',old.shift,'shift_start',old.shift_start,'shift_end',old.shift_end);
    v_new:=jsonb_build_object('shift',new.shift,'shift_start',new.shift_start,'shift_end',new.shift_end);
    v_payload:=jsonb_build_object('staff_id',new.id,'type',v_type,'old',v_old,'new',v_new,'actor',v_actor,'at',now());
    insert into public.staff_employment_events_v1(staff_id,event_type,effective_date,title,description,old_value,new_value,source,source_id,created_by,created_by_name,evidence_hash)
    values(new.id,v_type,current_date,v_title,null,v_old,v_new,'staff_update',new.id::text,v_actor,v_actor_name,public.hr360_hash_payload_v1(v_payload));
  end if;

  if old.status is distinct from new.status or old.is_active is distinct from new.is_active or old.active is distinct from new.active then
    v_type:='status_change'; v_title:='تغيير الحالة الوظيفية';
    v_old:=jsonb_build_object('status',old.status,'is_active',old.is_active,'active',old.active);
    v_new:=jsonb_build_object('status',new.status,'is_active',new.is_active,'active',new.active);
    v_payload:=jsonb_build_object('staff_id',new.id,'type',v_type,'old',v_old,'new',v_new,'actor',v_actor,'at',now());
    insert into public.staff_employment_events_v1(staff_id,event_type,effective_date,title,description,old_value,new_value,source,source_id,created_by,created_by_name,evidence_hash)
    values(new.id,v_type,current_date,v_title,null,v_old,v_new,'staff_update',new.id::text,v_actor,v_actor_name,public.hr360_hash_payload_v1(v_payload));
  end if;

  if old.join_date is distinct from new.join_date and new.join_date is not null then
    v_type:='contract_update'; v_title:='تصحيح / تحديث تاريخ التعيين';
    v_old:=jsonb_build_object('join_date',old.join_date); v_new:=jsonb_build_object('join_date',new.join_date);
    v_payload:=jsonb_build_object('staff_id',new.id,'type',v_type,'old',v_old,'new',v_new,'actor',v_actor,'at',now());
    insert into public.staff_employment_events_v1(staff_id,event_type,effective_date,title,description,old_value,new_value,source,source_id,created_by,created_by_name,evidence_hash)
    values(new.id,v_type,new.join_date,v_title,null,v_old,v_new,'staff_update',new.id::text,v_actor,v_actor_name,public.hr360_hash_payload_v1(v_payload));
  end if;

  return new;
end $$;

revoke all on function public.capture_staff_hr_timeline_change_v1() from public,anon,authenticated;
drop trigger if exists capture_staff_hr_timeline_change_v1 on public.staff;
create trigger capture_staff_hr_timeline_change_v1
after update on public.staff
for each row execute function public.capture_staff_hr_timeline_change_v1();

-- Baseline the current compensation only. This is intentionally NOT presented as historical truth
-- before the activation date; future changes are captured automatically by the payroll trigger.
insert into public.staff_compensation_history_v1(
  staff_id,staff_username,effective_from,base_salary,hourly_rate,target_bonus_amount,quarterly_bonus_amount,
  reason,source,source_id,created_by,created_by_name,evidence_hash
)
select s.id,p.staff_username,current_date,coalesce(p.base_salary,0),coalesce(p.hourly_rate,0),
       coalesce(p.target_bonus_amount,0),coalesce(p.quarterly_bonus_amount,0),
       'خط أساس الراتب عند تفعيل HR 360°','hr360_baseline',p.id,null,'النظام',
       public.hr360_hash_payload_v1(jsonb_build_object('staff_id',s.id,'source_id',p.id,'effective_from',current_date,'base_salary',coalesce(p.base_salary,0),'hourly_rate',coalesce(p.hourly_rate,0),'target_bonus_amount',coalesce(p.target_bonus_amount,0),'quarterly_bonus_amount',coalesce(p.quarterly_bonus_amount,0),'source','hr360_baseline'))
from public.staff_payroll_profiles_v13 p
join lateral (
  select st.* from public.staff st
  where lower(trim(coalesce(st.username,'')))=lower(trim(coalesce(p.staff_username,'')))
     or lower(trim(st.name))=lower(trim(coalesce(p.staff_name,'')))
  order by case when lower(trim(coalesce(st.username,'')))=lower(trim(coalesce(p.staff_username,''))) then 0 else 1 end
  limit 1
) s on true
where not exists (
  select 1 from public.staff_compensation_history_v1 h
  where h.staff_id=s.id and h.source_id=p.id
);