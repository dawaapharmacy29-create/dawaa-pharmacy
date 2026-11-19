-- Overtime is judged fairly (19/11/2026):
--   * the warehouse staff (هاجر، نور، هبه محمد، محمد عبد الرحمن) punch in الشامي or شكري but work in the warehouse:
--     their overtime is compared only with each other, and the branch staff are no longer compared with them;
--   * the fingerprints page pays the fair part of a stay: waiting for the one after him and the half hour handing
--     over count, the time a colleague of his group was with him does not. decide_overtime_approval_capped_v1
--     approves through decide_overtime_approval_v3 and pays at most that many minutes.

-- 1. Who belongs to the warehouse, wherever they punch.
create table if not exists public.hr_warehouse_staff_v1 (
  staff_id uuid primary key references public.staff(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.hr_warehouse_staff_v1 enable row level security;
revoke all on public.hr_warehouse_staff_v1 from public, anon, authenticated;

insert into public.hr_warehouse_staff_v1(staff_id)
select s.id from public.staff s
where s.id in ('e3640642-5c60-4815-8001-1bb93193668f',  -- هاجر
               'dea91886-1ae8-4766-a166-9952866a5024',  -- هبه محمد
               '74dffff0-ecdb-49b8-8e92-43b1ceca788c',  -- محمد عبد الرحمن
               '82b9c2a1-6139-4b07-9937-ef80a6e926d8')  -- نور
on conflict do nothing;

create or replace function public.hr_is_warehouse_staff_v1(p_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select exists (select 1 from public.hr_warehouse_staff_v1 w where w.staff_id = p_staff_id)
      or exists (select 1 from public.staff s where s.id = p_staff_id
                 and public.hr_branch_key_v3(s.branch) = public.hr_branch_key_v3('المخزن'));
$function$;
revoke all on function public.hr_is_warehouse_staff_v1(uuid) from public, anon;

-- 2. The overtime evidence compares the warehouse with the warehouse.
do $migration$
declare
  v_def text := pg_get_functiondef('public.overtime_decision_evidence_v3(uuid)'::regprocedure);
  v_old_peers text := $old$      and public.hr_branch_key_v3(coalesce(a.branch,s.branch))=public.hr_branch_key_v3(coalesce(v_ot.branch,v_staff.branch))
      and public.hr_staff_role_group_v3(s.role,s.name)=v_role_group$old$;
  v_new_peers text := $new$      and case
        when public.hr_is_warehouse_staff_v1(v_staff.id) then public.hr_is_warehouse_staff_v1(s.id)
        else not public.hr_is_warehouse_staff_v1(s.id)
          and public.hr_branch_key_v3(coalesce(a.branch,s.branch))=public.hr_branch_key_v3(coalesce(v_ot.branch,v_staff.branch))
          and public.hr_staff_role_group_v3(s.role,s.name)=v_role_group
      end$new$;
  v_old_out text := $old$    'role_group',v_role_group,
    'attendance_truth',jsonb_build_object($old$;
  v_new_out text := $new$    'role_group',v_role_group,
    'comparison_group',case when public.hr_is_warehouse_staff_v1(v_staff.id) then 'warehouse' else 'branch' end,
    'warehouse_staff_ids',coalesce((select jsonb_agg(w.staff_id) from public.hr_warehouse_staff_v1 w),'[]'::jsonb)
      || coalesce((select jsonb_agg(s2.id) from public.staff s2
                   where public.hr_branch_key_v3(s2.branch)=public.hr_branch_key_v3('المخزن')
                     and not exists (select 1 from public.hr_warehouse_staff_v1 w2 where w2.staff_id=s2.id)),'[]'::jsonb),
    'attendance_truth',jsonb_build_object($new$;
begin
  if position(v_old_peers in v_def) = 0 or position(v_old_out in v_def) = 0 then
    raise exception 'overtime_decision_evidence_v3 is not the expected version';
  end if;
  execute replace(replace(v_def, v_old_peers, v_new_peers), v_old_out, v_new_out);
end
$migration$;

-- 3. Approve and pay at most the fair minutes.
create or replace function public.decide_overtime_approval_capped_v1(p_id uuid, p_max_minutes integer, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_result jsonb;
  v_row public.staff_overtime_approvals%rowtype;
begin
  if p_max_minutes is null or p_max_minutes <= 20 or p_max_minutes > 24 * 60 then
    raise exception 'invalid_overtime_minutes' using errcode = '22023';
  end if;
  v_result := public.decide_overtime_approval_v3(p_id, 'approved', p_note);
  update public.staff_overtime_approvals o
  set overtime_hours = least(o.overtime_hours, round(p_max_minutes / 60.0, 2)),
      overtime_amount = round(least(o.overtime_hours, round(p_max_minutes / 60.0, 2)) * o.hourly_rate * 1.5, 2),
      updated_at = now()
  where o.id = p_id and o.status = 'approved' and o.overtime_hours > round(p_max_minutes / 60.0, 2)
  returning * into v_row;
  if found then
    v_result := v_result || jsonb_build_object('overtime_hours', v_row.overtime_hours,
      'overtime_amount', v_row.overtime_amount, 'capped_to_minutes', p_max_minutes);
  end if;
  return v_result;
end;
$function$;
revoke all on function public.decide_overtime_approval_capped_v1(uuid, integer, text) from public, anon;
grant execute on function public.decide_overtime_approval_capped_v1(uuid, integer, text) to authenticated;
