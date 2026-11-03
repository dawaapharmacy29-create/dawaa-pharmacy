do $$
declare
  v_gm constant text := '748fad73-5aab-4e61-bfd6-8be299af8aa9';
  v_wael constant text := 'e1454077-98eb-4f54-8fa8-2e4094991435';
  v_exec constant text := '00000000-0000-4000-8000-000000000003';
  v_branch constant text := '00000000-0000-4000-8000-000000000004';
  v_out jsonb;
  function_name text;
begin
  -- Extra payroll staff: the four managers by live name; the merged duplicate and other staff stay out.
  perform set_config('test.actor', v_wael, true);
  v_out := public.get_dr_wael_payroll_extra_v1();
  if jsonb_array_length(v_out) <> 4
     or exists (select 1 from jsonb_array_elements(v_out) e where e->>'name' like '%مكرر%' or e->>'name' = 'مساعد') then
    raise exception 'payroll_extra_wrong: %', v_out;
  end if;
  -- Their staff rows are untouched.
  if (select branch from public.staff where id = '10000000-0000-4000-8000-000000000001') <> 'كل الفروع' then
    raise exception 'staff_row_changed';
  end if;

  -- Only the page viewers read the extra list and the Shokry report.
  foreach function_name in array array[v_exec, v_branch, ''] loop
    perform set_config('test.actor', function_name, true);
    begin
      perform public.get_dr_wael_payroll_extra_v1();
      raise exception 'payroll_extra_open_to: %', function_name;
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.get_dr_wael_shokry_report_v1(null);
      raise exception 'shokry_report_open_to: %', function_name;
    exception when insufficient_privilege then null;
    end;
  end loop;

  -- The Shokry report keeps only خزنة شكري, in the original order.
  perform set_config('test.actor', v_wael, true);
  v_out := public.get_dr_wael_shokry_report_v1('2026-10');
  if jsonb_array_length(v_out->'vaults') <> 1 or v_out->'vaults'->0->>'code' <> 'shokry'
     or jsonb_array_length(v_out->'history') <> 2
     or exists (select 1 from jsonb_array_elements(v_out->'history') h where h->>'vault_code' <> 'shokry')
     or v_out->'transactions' <> '[{"id":"t3","vault_code":"shokry"},{"id":"t1","vault_code":"shokry"}]'::jsonb
     or v_out->>'month' <> '2026-10' then
    raise exception 'shokry_report_wrong: %', v_out;
  end if;

  -- Dr. Wael no longer reads the full report; the general manager and other top management still do.
  begin
    perform public.get_accountant_report_v1(null);
    raise exception 'full_report_open_to_wael';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.actor', v_gm, true);
  if jsonb_array_length(public.get_accountant_report_v1(null)->'vaults') <> 3
     or jsonb_array_length(public.get_dr_wael_shokry_report_v1(null)->'vaults') <> 1 then
    raise exception 'gm_reports_wrong';
  end if;
  perform set_config('test.actor', v_exec, true);
  if jsonb_array_length(public.get_accountant_report_v1(null)->'vaults') <> 3 then
    raise exception 'exec_full_report_wrong';
  end if;
  perform set_config('test.actor', v_branch, true);
  begin
    perform public.get_accountant_report_v1(null);
    raise exception 'full_report_open_to_branch_manager';
  exception when insufficient_privilege then null;
  end;

  -- Browser roles reach the guarded entry points only.
  foreach function_name in array array['public.get_dr_wael_payroll_extra_v1()',
    'public.get_dr_wael_shokry_report_v1(text)', 'public.get_accountant_report_v1(text)'] loop
    if not has_function_privilege('anon', function_name, 'execute') then
      raise exception 'rpc_not_granted: %', function_name;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.accountant_report_full_v1(text)', 'execute')
     or has_function_privilege('authenticated', 'public.accountant_report_full_v1(text)', 'execute') then
    raise exception 'full_report_body_exposed';
  end if;
  if has_table_privilege('anon', 'public.dr_wael_payroll_extra_staff_v1', 'select')
     or has_table_privilege('authenticated', 'public.accountant_report_vault_only_v1', 'select') then
    raise exception 'tables_exposed';
  end if;
end $$;
