# Rollback — 20261027200000_close_unauthenticated_table_writes_v1

The migration only **adds restrictive policies**, one helper function and an execute grant, and **drops three
`attendance_manual_requests` write policies**. It rewrites no rows. Rolling back restores the previous
(permissive) behaviour exactly; it never touches data.

## Signals that need action after applying

| Symptom | Likely table | First response |
|---|---|---|
| A page shows "new row violates row-level security policy" on save | the table named in the error | Partial rollback for that table only (below) |
| Branch manager cannot edit an incentive item | `incentive_medicines` (all-branch rows) | Expected; grant `manage_incentive_medicines` to that account, or partial rollback |
| Punch rejected with a device message | not this migration (device guard unchanged) | Check `staff_attendance_devices` row for the employee |
| Invoice import fails on customer totals | `customer_analysis` | Confirm the importer has `import_sales_invoices`; else partial rollback |

## Partial rollback (one table)

```sql
begin;
drop policy if exists <table>_insert_write_scope_v1 on public.<table>;
drop policy if exists <table>_update_write_scope_v1 on public.<table>;
drop policy if exists <table>_delete_write_scope_v1 on public.<table>;
commit;
```

## Full rollback

```sql
begin;
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and policyname like '%\_write\_scope\_v1'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Previous attendance_manual_requests client write policies.
create policy attendance_manual_requests_app_insert on public.attendance_manual_requests
  for insert to public with check (true);
create policy manual_requests_insert_authenticated on public.attendance_manual_requests
  for insert to public with check (true);
create policy attendance_manual_requests_app_update on public.attendance_manual_requests
  for update to public using (true) with check (true);

drop function if exists public.dawaa_current_operational_write_scope_v1(text[], text[], text[]);
revoke execute on function public.dawaa_customer_request_branch_key(text) from anon, authenticated;
commit;
```

The full rollback reopens the security hole; use it only to restore operations while a scoped fix is prepared.
Verify afterwards: `select count(*) from pg_policies where policyname like '%\_write\_scope\_v1'` returns 0.

The UI change in `src/pages/IncentiveMedicines.tsx` only hides edit buttons for branch roles on all-branch
items; reverting the PR restores the previous buttons. It is harmless to leave in place after a database rollback.
