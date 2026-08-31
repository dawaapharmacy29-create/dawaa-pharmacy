-- لوحة مقارنة بسيطة بين نور وهاجر وهبة حماده — إجمالي النقاط المعتمدة
-- (من عمليات المشتريات وخدمة العملاء بس) في الدورة الشهرية الحالية.
create or replace function public.get_assistant_operational_leaderboard_v1()
returns table (
  staff_id uuid,
  staff_name text,
  branch text,
  total_points numeric
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception using errcode = '42501', message = 'active staff actor required';
  end if;

  return query
    select s.id, s.name, s.branch, coalesce(sum(et.points), 0) as total_points
    from public.assistant_operational_eligible_staff e
    join public.staff s on s.id = e.staff_id
    left join public.employee_transactions et
      on et.staff_id = s.id
     and et.source = 'assistant_operational_log'
     and et.status = 'active'
     and et.month_cycle = public.dawaa_current_points_cycle_label_v1()
    group by s.id, s.name, s.branch
    order by total_points desc;
end;
$function$;
revoke all on function public.get_assistant_operational_leaderboard_v1() from public, anon, authenticated;
grant execute on function public.get_assistant_operational_leaderboard_v1() to anon, authenticated;

notify pgrst, 'reload schema';
