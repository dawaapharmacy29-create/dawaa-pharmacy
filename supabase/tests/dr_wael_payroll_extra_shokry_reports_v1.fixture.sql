-- Synthetic isolated fixture; no production connections. The accountant report body is a stand-in with the
-- production guard and the production output keys, so the test checks the wrapping, not the ledger maths.
create role anon;
create role authenticated;
create role service_role;

create table public.staff_accounts(id uuid primary key, name text, role text, branch text, active boolean,
  can_login boolean, staff_id text);
create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable as $$
  select nullif(current_setting('test.actor', true), '')::uuid $$;
create table public.staff(id uuid primary key, name text, branch text, role text, type text, is_active boolean,
  active boolean, join_date date);

create function public.gm_daily_review_actor_v1() returns uuid language plpgsql stable security definer
set search_path to 'public', 'pg_catalog' as $$
declare v_actor uuid := public.dawaa_current_staff_account_id_strict();
begin
  if v_actor is null or not exists (
    select 1 from public.staff_accounts sa
    where sa.id = v_actor and sa.active is true and sa.can_login is true
      and lower(btrim(coalesce(sa.role, ''))) in ('general_manager', 'admin', 'executive_manager')
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return v_actor;
end $$;

create function public.get_accountant_report_v1(p_month text default null) returns jsonb language plpgsql stable
security definer set search_path to 'public', 'pg_catalog' as $$
begin
  perform public.gm_daily_review_actor_v1();
  return jsonb_build_object('synced_at', null, 'last_error', null, 'month', coalesce(p_month, '2026-11'),
    'today', '2026-11-03', 'months', jsonb_build_array('2026-11', '2026-10'),
    'vaults', jsonb_build_array(jsonb_build_object('code', 'other', 'name', 'خزنة باقي الفروع'),
      jsonb_build_object('code', 'shamy', 'name', 'خزنة الشامي'),
      jsonb_build_object('code', 'shokry', 'name', 'خزنة شكري القوتلي')),
    'history', jsonb_build_array(jsonb_build_object('month', '2026-10', 'vault_code', 'shamy'),
      jsonb_build_object('month', '2026-10', 'vault_code', 'shokry'),
      jsonb_build_object('month', '2026-11', 'vault_code', 'shokry')),
    'transactions', jsonb_build_array(jsonb_build_object('id', 't3', 'vault_code', 'shokry'),
      jsonb_build_object('id', 't2', 'vault_code', 'shamy'),
      jsonb_build_object('id', 't1', 'vault_code', 'shokry')));
end $$;
grant execute on function public.get_accountant_report_v1(text) to anon, authenticated;

insert into public.staff_accounts(id, name, role, branch, active, can_login) values
  ('748fad73-5aab-4e61-bfd6-8be299af8aa9', 'د/ معاذ', 'general_manager', 'كل الفروع', true, true),
  ('e1454077-98eb-4f54-8fa8-2e4094991435', 'د وائل', 'executive_manager', 'كل الفروع', true, true),
  ('00000000-0000-4000-8000-000000000003', 'مدير تنفيذي آخر', 'executive_manager', 'كل الفروع', true, true),
  ('00000000-0000-4000-8000-000000000004', 'مدير فرع', 'branch_manager', 'فرع شكري', true, true);

insert into public.staff(id, name, branch, role, is_active, active) values
  ('10000000-0000-4000-8000-000000000001', 'د/ علا', 'كل الفروع', 'مديرة الفروع', true, true),
  ('10000000-0000-4000-8000-000000000002', 'د/ علا (سجل مكرر تم دمجه)', 'المخزن', 'مديرة الفروع', false, false),
  ('10000000-0000-4000-8000-000000000003', 'د وائل', 'كل الفروع', 'مدير المشتريات', true, true),
  ('10000000-0000-4000-8000-000000000004', 'د اميرة ', 'فرع شكري', 'branch_manager', true, true),
  ('10000000-0000-4000-8000-000000000005', 'د/ علياء', 'فرع الشامي', 'مدير فرع', true, true),
  ('10000000-0000-4000-8000-000000000006', 'مساعد', 'فرع شكري', 'assistant', true, true);
