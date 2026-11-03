-- «بصمات د وائل»: (1) the salaries tab also lists named managers who sit outside the three attendance
-- branches (د/ علا and د وائل are «كل الفروع»); their staff rows, accounts and permissions stay as they are.
-- (2) «تقارير شكري»: the consolidated accountant report limited to خزنة شكري القوتلي, for the page viewers.
-- Dr. Wael sees only that branch: the full report now refuses his account. Read-only for the data.

-- (1) Extra payroll staff -------------------------------------------------------------------------------
create table if not exists public.dr_wael_payroll_extra_staff_v1(
  staff_id uuid primary key references public.staff(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table public.dr_wael_payroll_extra_staff_v1 enable row level security;
revoke all on table public.dr_wael_payroll_extra_staff_v1 from public, anon, authenticated;

-- Seeded by name so the list follows the live staff rows; د/ علا and د وائل exist once each among active staff.
insert into public.dr_wael_payroll_extra_staff_v1(staff_id, note)
select s.id, 'إظهار المرتب في بصمات د وائل'
from public.staff s
where s.is_active is true and btrim(s.name) in ('د/ علا', 'د وائل', 'د اميرة', 'د/ علياء')
on conflict (staff_id) do nothing;

create or replace function public.get_dr_wael_payroll_extra_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.dr_wael_fingerprints_actor_v1();
  return coalesce((
    select jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.name, 'branch', s.branch, 'role', s.role,
      'active', coalesce(s.is_active, false)) order by s.name)
    from public.dr_wael_payroll_extra_staff_v1 x
    join public.staff s on s.id = x.staff_id
    where s.is_active is true
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.get_dr_wael_payroll_extra_v1() from public;
grant execute on function public.get_dr_wael_payroll_extra_v1() to anon, authenticated;

-- (2) Shokry-only accountant report -----------------------------------------------------------------------
-- Accounts that may read the accountant book of one vault only.
create table if not exists public.accountant_report_vault_only_v1(
  staff_account_id uuid primary key,
  vault_code text not null,
  label text,
  created_at timestamptz not null default now()
);
alter table public.accountant_report_vault_only_v1 enable row level security;
revoke all on table public.accountant_report_vault_only_v1 from public, anon, authenticated;
insert into public.accountant_report_vault_only_v1(staff_account_id, vault_code, label)
values ('e1454077-98eb-4f54-8fa8-2e4094991435', 'shokry', 'د وائل — فرع شكري بس')
on conflict (staff_account_id) do nothing;

-- The existing report body becomes internal (it keeps its own top-management guard) and the public name
-- refuses vault-limited accounts before handing over to it.
do $$
begin
  if to_regprocedure('public.accountant_report_full_v1(text)') is null then
    alter function public.get_accountant_report_v1(text) rename to accountant_report_full_v1;
  end if;
end $$;
revoke all on function public.accountant_report_full_v1(text) from public, anon, authenticated;

create or replace function public.get_accountant_report_v1(p_month text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if exists (select 1 from public.accountant_report_vault_only_v1 o
             where o.staff_account_id = public.dawaa_current_staff_account_id_strict()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return public.accountant_report_full_v1(p_month);
end;
$function$;
revoke all on function public.get_accountant_report_v1(text) from public;
grant execute on function public.get_accountant_report_v1(text) to anon, authenticated;

create or replace function public.get_dr_wael_shokry_report_v1(p_month text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_vault constant text := 'shokry';
  v_report jsonb;
begin
  perform public.dr_wael_fingerprints_actor_v1();
  v_report := public.accountant_report_full_v1(p_month);
  return v_report || jsonb_build_object(
    'vaults', coalesce((select jsonb_agg(v order by n) from jsonb_array_elements(v_report->'vaults') with ordinality x(v, n)
                        where v->>'code' = v_vault), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(h order by n) from jsonb_array_elements(v_report->'history') with ordinality x(h, n)
                         where h->>'vault_code' = v_vault), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(t order by n) from jsonb_array_elements(v_report->'transactions') with ordinality x(t, n)
                              where t->>'vault_code' = v_vault), '[]'::jsonb));
end;
$function$;
revoke all on function public.get_dr_wael_shokry_report_v1(text) from public;
grant execute on function public.get_dr_wael_shokry_report_v1(text) to anon, authenticated;
