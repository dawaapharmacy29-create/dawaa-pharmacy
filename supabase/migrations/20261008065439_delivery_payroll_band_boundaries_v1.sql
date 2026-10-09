create or replace function public.dawaa_delivery_discipline_band_v1(
  p_attended_days integer,
  p_discipline_minutes integer,
  p_policy_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_policy public.delivery_payroll_policy_versions%rowtype;
  v_date date:=coalesce(p_policy_date,(now() at time zone 'Africa/Cairo')::date);
  v_committed integer;
  v_regular integer;
  v_band text;
  v_band_ar text;
  v_status text;
begin
  if p_attended_days is null or p_attended_days<0 or p_discipline_minutes is null or p_discipline_minutes<0 then
    raise exception 'invalid_delivery_discipline_metrics' using errcode='22023';
  end if;

  select * into v_policy
  from public.delivery_payroll_policy_versions p
  where p.active=true and p.effective_from<=v_date and (p.effective_to is null or p.effective_to>=v_date)
  order by p.effective_from desc,p.created_at desc
  limit 1;
  if not found then return jsonb_build_object('status','policy_not_configured'); end if;

  v_committed:=p_attended_days*v_policy.committed_credit_minutes_per_day;
  v_regular:=p_attended_days*v_policy.regular_credit_minutes_per_day;

  if p_attended_days<v_policy.min_attended_days then
    v_status:='insufficient_attendance_days'; v_band:=null; v_band_ar:='غير مؤهل بعد';
  elsif p_discipline_minutes<=v_committed then
    v_status:='classified'; v_band:='committed'; v_band_ar:='ملتزم';
  elsif p_discipline_minutes<=v_regular then
    v_status:='classified'; v_band:='regular'; v_band_ar:='عادي';
  else
    v_status:='classified'; v_band:='low'; v_band_ar:='منخفض';
  end if;

  return jsonb_build_object(
    'status',v_status,
    'attended_days',p_attended_days,
    'discipline_minutes',p_discipline_minutes,
    'minimum_attended_days',v_policy.min_attended_days,
    'committed_credit_minutes',v_committed,
    'regular_credit_minutes',v_regular,
    'discipline_band',v_band,
    'discipline_band_ar',v_band_ar
  );
end;
$function$;

revoke all on function public.dawaa_delivery_discipline_band_v1(integer,integer,date) from public;
revoke all on function public.dawaa_delivery_discipline_band_v1(integer,integer,date) from anon,authenticated;