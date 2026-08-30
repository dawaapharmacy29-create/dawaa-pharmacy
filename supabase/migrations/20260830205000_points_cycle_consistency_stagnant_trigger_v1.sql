-- Keep stagnant-dispense point writes on the pharmacy 26→25 cycle.
create or replace function public.settle_stagnant_dispense_doctor_points()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_doctor record;
  v_points numeric;
  v_month_cycle text;
  v_event_date date;
begin
  if new.doctor_id is null or coalesce(new.quantity,0)<=0 then return new; end if;
  if exists(select 1 from public.employee_transactions where source='stagnant_medicine_dispense' and source_id=new.id) then return new; end if;
  select id,name,branch into v_doctor from public.staff where id=new.doctor_id and coalesce(active,true);
  if not found then return new; end if;
  v_points:=3*new.quantity;
  v_event_date:=coalesce(new.dispensed_at::date,new.created_at::date,(now() at time zone 'Africa/Cairo')::date);
  v_month_cycle:=public.dawaa_points_cycle_label_for_date_v3(v_event_date);
  insert into public.employee_transactions(staff_id,employee_id,employee_name,type,title,reason,amount,points,points_delta,source,source_id,transaction_date,created_at,description,month_cycle,branch,status,category,employee_visible,created_by)
  values(v_doctor.id,v_doctor.id,v_doctor.name,'reward','بيع صنف راكد','بيع صنف راكد',0,v_points,v_points,'stagnant_medicine_dispense',new.id,coalesce(new.dispensed_at::date,new.created_at::date,current_date),now(),'بيع '||new.quantity||' علبة راكدة: '||coalesce(new.product_name,'صنف')||' (نقاط منفصلة عن الحافز المالي)',v_month_cycle,coalesce(new.branch_name,v_doctor.branch),'active','رواكد',true,'system_automation');
  return new;
end;
$function$;
