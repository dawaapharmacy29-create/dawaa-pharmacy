create or replace function public.dawaa_net_attendance_deviation_v1(
  p_late_minutes integer,
  p_extra_minutes integer,
  p_role text,
  p_is_compensated boolean default false
) returns jsonb
language plpgsql
immutable
as $function$
declare
  v_is_delivery boolean := coalesce(p_role, '') ilike '%توصيل%';
  v_late int := greatest(coalesce(p_late_minutes,0), 0);
  v_extra int := greatest(coalesce(p_extra_minutes,0), 0);
  v_deduction int := 0;
  v_overtime int := 0;
begin
  if v_is_delivery then
    if v_late <= 0 then
      v_deduction := 0;
    elsif v_late < 30 then
      v_deduction := case when coalesce(p_is_compensated,false) then 0 else v_late end;
    else
      v_deduction := v_late * 2;
    end if;

    v_overtime := case when v_extra > 20 then v_extra else 0 end;
    return jsonb_build_object('deduction_minutes',v_deduction,'overtime_minutes',v_overtime);
  end if;

  if v_extra >= v_late and v_late > 0 then
    if v_late <= 20 then v_deduction := 0;
    else v_deduction := v_late;
    end if;
  else
    if v_late <= 20 then v_deduction := 0;
    elsif v_late <= 60 then v_deduction := v_late * 2;
    else v_deduction := v_late * 4;
    end if;
  end if;

  v_overtime := case when v_extra > 20 then v_extra else 0 end;
  return jsonb_build_object('deduction_minutes',v_deduction,'overtime_minutes',v_overtime);
end;
$function$;

with current_truth as (
  select distinct on (a.staff_id,a.attendance_date)
    a.staff_id,a.attendance_date,
    greatest(round(greatest(coalesce(extract(epoch from(a.last_out-a.scheduled_end_at))/60.0,0),0))::int,0) as raw_after_shift_minutes
  from public.attendance_daily_summary a
  where a.status='approved'
    and coalesce(a.resolution_version,0)>=2
    and a.last_out is not null
    and a.scheduled_end_at is not null
  order by a.staff_id,a.attendance_date,
    coalesce(a.resolution_version,0) desc,
    a.updated_at desc nulls last,
    a.created_at desc
)
update public.staff_overtime_approvals o
set overtime_hours=round((case when ct.raw_after_shift_minutes>20 then ct.raw_after_shift_minutes else 0 end)/60.0,2),
    overtime_amount=case when o.hourly_rate is not null and o.hourly_rate>0
      then round(((case when ct.raw_after_shift_minutes>20 then ct.raw_after_shift_minutes else 0 end)/60.0)*o.hourly_rate*1.5,2)
      else null end,
    decision_note=concat_ws(' | ',nullif(trim(coalesce(o.decision_note,'')),''),
      'تصحيح تقني 28/09/2026: الأوفر تايم = كامل الوقت بعد نهاية الشيفت؛ مقاصة التأخير لا تخصم من دقائق الأوفر تايم.'),
    updated_at=now()
from current_truth ct
where o.status='pending'
  and o.staff_id=ct.staff_id
  and o.attendance_date=ct.attendance_date
  and ct.raw_after_shift_minutes>20;
