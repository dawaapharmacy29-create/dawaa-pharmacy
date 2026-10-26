-- READ-ONLY catalog capture used to build the isolated identity-hardening rehearsal clone.
-- Returns DDL text only (tables: columns + PK, no rows; functions: pg_get_functiondef + ACL; policies; table grants).
-- Run it with a read-only session. Its output contains Production function definitions, so store the result
-- OUTSIDE the repository (it is an input to build_clone.cjs, never a committed artifact).
with recursive fns as (select p.oid, p.proname, p.prosrc from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'),
hdr as (select oid, proname, 0 d from fns where prosrc like '%x-dawaa-user-id%'
        union select f.oid, f.proname, h.d+1 from hdr h join fns f on f.prosrc ~ ('\m'||h.proname||'\M') and f.oid<>h.oid where h.d<6),
tgt0 as (
 select oid from hdr
 union select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and 'p_actor_id' = any(p.proargnames)
 union select oid from fns where proname in ('dawaa_session_account_id_v1','dawaa_current_staff_account_id_strict','dawaa_current_actor_can',
   'dawaa_actor_is_top_management_v1','employee_operating_actor_id','employee_operating_actor_role','employee_operating_actor_branch',
   'dawaa_current_actor_staff_id_v1','get_user_permissions','dawaa_jsonb_has_true_any','dawaa_current_followup_actor_v2',
   'dawaa_request_staff_identifier','dawaa_request_staff_id','dawaa_notification_inbox_visible_v3','user_has_permission',
   'dawaa_customer_request_branch_key','normalize_customer_followup_branch','monthly_eval_actor',
   'get_customer_points_daily20_core','get_customer_service_at_risk_daily_core','get_customer_service_daily_queue_completion_core',
   'get_customer_service_daily_vip7_core','get_customer_service_plus500_core',
   -- policy helpers and payload-actor internals added in later capture passes
   'is_app_admin','dawaa_can_read_customer_service_branch_v1','dawaa_current_customer_write_scope_v4','dawaa_current_customer_read_scope_v4',
   'dawaa_customer_service_branch_scope_v1','dawaa_can_manage_incentives','dawaa_can_write_employee_transaction',
   'dawaa_employee_transaction_read_scope_v1','dawaa_can_manage_staff','dawaa_can_branch_inspection','dawaa_current_customer_core_scope_v2',
   'dawaa_can_manage_staff_accounts_strict','dawaa_can_view_staff_accounts_strict','dawaa_can_read_staff_checklist_v1',
   'dawaa_current_staff_subject_uuid_v1','dawaa_can_manage_permissions','insert_customer_points_ledger_internal_v1',
   'upsert_customer_loyalty_setting_internal_v1','insert_customer_welcome_message_log','insert_customer_points_ledger',
   'upsert_customer_loyalty_setting','dawaa_current_points_actor_v1','dawaa_can_access_customer_points_branch_v1',
   'dawaa_can_import_products_catalog','dawaa_team_alpha_track_for_date_v1')),
tgt as (select t.oid from tgt0 t
 union select f.oid from tgt0 t join fns tf on tf.oid=t.oid join fns f on f.oid<>t.oid and tf.prosrc ~ ('\m'||f.proname||'\M') and length(f.prosrc) < 3000 where f.proname not like 'import_%'),
ptables as (select unnest(array['cleaning_daily_ratings','deduction_rules','employee_compensation_profiles','employee_events','employee_monthly_statements',
  'manager_daily_checklist','manager_weekly_evaluations','notification_action_events','notification_sla_events','notifications','reward_rules','staff',
  'tasks','warehouse_shortage_dispatch_items','warehouse_shortage_dispatches','staff_accounts','staff_login_sessions','user_profiles',
  'branch_sales_targets','staff_daily_checklist_assignments']) t),
tbls as (select c.oid, c.relname, c.relrowsecurity from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') and (
   c.relname in (select t from ptables) or exists (select 1 from tgt join pg_proc p on p.oid=tgt.oid where p.prosrc ~ ('\m'||c.relname||'\M')))),
cols as (select c.oid, string_agg(quote_ident(a.attname)||' '||format_type(a.atttypid,a.atttypmod)||
   case when ad.adbin is not null and pg_get_expr(ad.adbin,ad.adrelid) !~* 'nextval' then ' default '||pg_get_expr(ad.adbin,ad.adrelid) else '' end, ', ' order by a.attnum) coldefs
 from tbls c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef ad on ad.adrelid=c.oid and ad.adnum=a.attnum group by c.oid),
pks as (select i.indrelid oid, ', primary key ('||string_agg(quote_ident(a2.attname), ',' order by k.ord)||')' pk from pg_index i
  cross join lateral unnest(i.indkey) with ordinality k(attnum,ord) join pg_attribute a2 on a2.attrelid=i.indrelid and a2.attnum=k.attnum
  where i.indisprimary and i.indrelid in (select oid from tbls) group by i.indrelid),
tdl as (select 'a_table' kind, c.relname nm, 'create table public.'||quote_ident(c.relname)||' ('||cols.coldefs||coalesce(pks.pk,'')||');'||
  case when c.relrowsecurity then E'\nalter table public.'||quote_ident(c.relname)||' enable row level security;' else '' end ddl
  from tbls c join cols on cols.oid=c.oid left join pks on pks.oid=c.oid),
tgr as (select 'b_grant' kind, c.relname nm, string_agg(format('grant %s on public.%I to %I;', g.privilege_type, c.relname, g.grantee), E'\n' order by g.grantee, g.privilege_type) ddl
  from tbls c join information_schema.role_table_grants g on g.table_schema='public' and g.table_name=c.relname and g.grantee in ('anon','authenticated','service_role') group by c.relname),
pol as (select 'c_policy' kind, c.relname||'.'||po.polname nm,
  format('create policy %I on public.%I as %s for %s to %s%s%s;', po.polname, c.relname, case when po.polpermissive then 'permissive' else 'restrictive' end,
   case po.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,
   coalesce(nullif(array_to_string(array(select quote_ident(rolname) from pg_roles where oid=any(po.polroles)),', '),''),'public'),
   case when po.polqual is not null then ' using ('||pg_get_expr(po.polqual,po.polrelid)||')' else '' end,
   case when po.polwithcheck is not null then ' with check ('||pg_get_expr(po.polwithcheck,po.polrelid)||')' else '' end) ddl
  from tbls c join pg_policy po on po.polrelid=c.oid),
fdl as (select 'd_function' kind, p.oid::regprocedure::text nm, pg_get_functiondef(p.oid)||E';\n'||
  'revoke all on function '||p.oid::regprocedure::text||' from public, anon, authenticated;'||
  case when has_function_privilege('anon',p.oid,'EXECUTE') then E'\ngrant execute on function '||p.oid::regprocedure::text||' to anon;' else '' end||
  case when has_function_privilege('authenticated',p.oid,'EXECUTE') then E'\ngrant execute on function '||p.oid::regprocedure::text||' to authenticated;' else '' end||
  E'\ngrant execute on function '||p.oid::regprocedure::text||' to service_role;'||E'\n-- md5(prosrc)='||md5(p.prosrc) ddl
  from (select distinct oid from tgt) t join pg_proc p on p.oid=t.oid)
select kind, nm, ddl from (select * from tdl union all select * from tgr union all select * from pol union all select * from fdl) x order by kind, nm;
