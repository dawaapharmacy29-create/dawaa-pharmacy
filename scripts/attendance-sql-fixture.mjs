// Synthetic schema/providers. Identity, schedule, builder, materializer, lifecycle and approval
// function bodies are read from committed migrations, not reimplemented test algorithms.
import { readFileSync } from 'node:fs';
export const readMigration = name => readFileSync('supabase/migrations/'+name,'utf8');
export function functionSql(file,name) {
 const source=readMigration(file);const re=new RegExp('create(?: or replace)? function public\\.'+name+'\\(', 'i');
 const match=re.exec(source);if(!match)throw Error('Function not found '+name);
 const text=source.slice(match.index);const tag=/\bas\s+(\$[a-z_0-9]*\$)/i.exec(text);
 if(!tag)throw Error('No SQL delimiter '+name);const start=tag.index+tag[0].length;
 return text.slice(0,text.indexOf(tag[1],start)+tag[1].length)+';';
}
function tableSql(file,name){const source=readMigration(file);const start=source.indexOf('create table if not exists public.'+name+' (');if(start<0)throw Error(name);return source.slice(start,source.indexOf('\n);',start)+3);}
export const staff='11111111-1111-4111-8111-111111111111';
export const otherStaff='22222222-2222-4222-8222-222222222222';
export const manager='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const employee='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const outsider='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const token='local-manager-session-'.padEnd(64,'m');
export const employeeToken='local-employee-session-'.padEnd(64,'e');
export const outsiderToken='local-outsider-session-'.padEnd(64,'o');
export async function setupAttendanceFixture(pool){
 await pool.query(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema extensions;create extension pgcrypto with schema extensions;
 create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
 create table staff(id uuid primary key,name text,role text,branch text,active boolean default true,flexible boolean default false);
 create table staff_accounts(id uuid primary key,staff_id text,username text,name text,staff_name text,role text,branch text,
 active boolean default true,is_active boolean default true,can_login boolean default true,status text default 'active',
 auth_user_id uuid,permissions jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
 create table user_profiles(auth_user_id uuid,staff_account_id uuid,role text,active boolean,permissions jsonb);
 create table staff_login_sessions(id uuid primary key default gen_random_uuid(),staff_account_id uuid references staff_accounts,
 token_hash text unique,expires_at timestamptz,revoked_at timestamptz);
 create table shift_schedules(id uuid primary key default gen_random_uuid(),staff_id uuid references staff,staff_name text,employee_name text,
 role text,branch text,day_name text,shift_start text,shift_end text,start_time time,end_time time,hours numeric,is_off boolean,
 is_day_off boolean,is_different boolean,has_custom_time boolean,shift_date date,date date,status text,source text,notes text,
 effective_from date,effective_to date,created_at timestamptz default now(),updated_at timestamptz default now());
 create table attendance_daily_summary(id uuid primary key default gen_random_uuid(),staff_id uuid references staff,attendance_date date,
 branch text,first_in timestamptz,last_out timestamptz,total_hours numeric,late_minutes integer,early_leave_minutes integer,
 missing_punch boolean,status text,source text,schedule_id uuid,scheduled_start_at timestamptz,scheduled_end_at timestamptz,
 candidate_hours numeric,payroll_eligible_hours numeric,resolution_status text,resolution_version int,resolution_snapshot jsonb,
 approved_at timestamptz,approved_by text,approved_by_name text,approval_note text,resolution_origin text,
 review_required boolean default true,resolved_at timestamptz,time_off_request_id uuid,policy_version text,sync_complete_through timestamptz,
 updated_at timestamptz default now());
 create unique index attendance_daily_staff_day on attendance_daily_summary(staff_id,attendance_date) where staff_id is not null and attendance_date is not null;
 create index attendance_daily_date on attendance_daily_summary(attendance_date);
 create table staff_attendance_logs(id uuid primary key default gen_random_uuid(),staff_id uuid references staff,staff_name text,
 role text,branch_name text,attendance_type text,recorded_at timestamptz,shift_date date,biometric_verified boolean,
 biometric_method text,biometric_source_log_id uuid,status text,rejection_reason text,created_by uuid);
 create table biometric_semantic_decisions(biometric_log_id uuid,decision text);
 create table employee_transactions(id uuid primary key default gen_random_uuid(),staff_id uuid,employee_name text,branch text,type text,
 title text,reason text,description text,amount numeric,points numeric,points_delta numeric,source text,source_id uuid,
 transaction_date date,month_cycle text,status text,employee_visible boolean,created_by text,approved_by text,approved_at timestamptz,category text,metadata jsonb);
 create table attendance_manual_actions_audit(id uuid primary key default gen_random_uuid(),action_type text,staff_id uuid,target_id uuid,
 old_value jsonb,new_value jsonb,reason text,actor_account_id uuid,actor_name text,actor_role text);
 create table fixture_sync_watermarks(branch text primary key,complete_through timestamptz);
 create function attendance_branch_sync_complete_through_v1(text) returns timestamptz language sql stable as $$select complete_through from fixture_sync_watermarks where branch=$1$$;
 create function get_user_permissions(uuid) returns jsonb language sql stable security definer as $$select permissions from staff_accounts where id=$1$$;
 create function dawaa_actor_is_top_management_v1() returns boolean language sql stable security definer as $$select coalesce(employee_operating_actor_role() in ('general_manager','executive_manager','branches_manager'),false)$$;
 ` .replace(/create function dawaa_actor_is_top_management_v1[\s\S]*$/,''));
 const functions=[
 ['20261008120000_verified_staff_session_identity_v1.sql','dawaa_session_account_id_v1'],
 ['20261008120000_verified_staff_session_identity_v1.sql','dawaa_request_staff_identifier'],
 ['20261016090000_staff_actor_session_identity_once_per_call_v1.sql','dawaa_current_staff_account_id_strict'],
 ['20261013195000_restore_verified_staff_session_identity_for_reviews_v3.sql','employee_operating_actor_id'],
 ['20260826170000_points_actor_context_prerequisite_v1.sql','employee_operating_actor_role'],
 ['20260826170000_points_actor_context_prerequisite_v1.sql','employee_operating_actor_branch'],
 ['20260823184000_harden_db_authorization_permission_truth_v1.sql','dawaa_jsonb_has_true_any'],
 ['20260823184500_canonicalize_current_staff_account_resolution_v1.sql','dawaa_current_actor_can'],
 ['20260823231500_harden_staff_coaching_notes_rls_v1.sql','dawaa_current_staff_subject_uuid_v1'],
 ];
 for(const [file,name]of functions)await pool.query(functionSql(file,name));
 await pool.query(`create function dawaa_actor_is_top_management_v1() returns boolean language sql stable security definer as $$select coalesce(employee_operating_actor_role() in ('general_manager','executive_manager','branches_manager'),false)$$;
 create function dawaa_can_read_staff_attendance_log(uuid,text) returns boolean language sql stable security definer as $$
 select dawaa_current_staff_account_id_strict() is not null and (dawaa_actor_is_top_management_v1() or employee_operating_actor_branch()=$2 or dawaa_current_staff_subject_uuid_v1()=$1)$$;
 create function dawaa_staff_flexible_attendance_v1(uuid) returns boolean language sql stable as $$select flexible from staff where id=$1$$;
 create function dawaa_build_attendance_day_resolution_v3(uuid,date) returns jsonb language sql stable as $$select '{}'::jsonb$$;`);
 const foundation='20260906162000_canonical_timeoff_attendance_foundation_v1.sql';
 for(const name of ['staff_time_off_requests','staff_time_off_audit','staff_leave_ledger','attendance_policy_versions'])await pool.query(tableSql(foundation,name));
 for(const name of ['attendance_resolution_audit','attendance_impact_ledger'])await pool.query(tableSql('20260906171000_attendance_resolution_v2_schema.sql',name));
 await pool.query(tableSql('20260924171000_missing_punch_allowance_and_manual_repair_v1.sql','attendance_missing_punch_incidents'));
 const more=[
 ['20260826141000_points_architecture_v3_cleaning_daily_ratings.sql','dawaa_points_cycle_label_for_date_v3'],
 ['20260830203000_points_cycle_consistency_cron_writers_v1.sql','dawaa_points_cycle_start_for_label_v1'],
 ['20260830203000_points_cycle_consistency_cron_writers_v1.sql','dawaa_points_cycle_end_for_label_v1'],
 [foundation,'get_attendance_policy_v1'],
 ...['dawaa_time_off_scope_all_v1','dawaa_time_off_can_access_staff_v1','dawaa_time_off_can_decide_staff_v1','create_staff_time_off_request_v1','get_permission_policy_status_v2','get_annual_leave_balance_v1'].map(n=>['20260906163000_time_off_branch_scope_and_leave_balance_hardening_v1.sql',n]),
 ['20260906164000_time_off_permission_cycle_guard_v2.sql','decide_staff_time_off_request_v1'],
 ...['time_off_request_preflight_v3','decide_staff_time_off_request_v3'].map(n=>['20260924044500_time_off_policy_v3_preflight.sql',n]),
 ...['attendance_schedule_for_date_v1','dawaa_build_attendance_day_resolution_v2'].map(n=>['20260923124000_attendance_shift_date_override_priority.sql',n]),
 ...['dawaa_attendance_engine_route_v1','dawaa_build_attendance_day_resolution_current_v1'].map(n=>['20261009083500_attendance_canonical_architecture_v1.sql',n]),
 ...['dawaa_sync_attendance_impact_for_resolution_v2','dawaa_materialize_attendance_day_internal_v2'].map(n=>['20260906171400_attendance_resolution_v2_materialization.sql',n]),
 ['20260824004500_harden_payroll_permission_contract_v1.sql','dawaa_can_manage_payroll_staff_v1'],
 ['20260924140000_accountless_staff_attendance_approval_v1.sql','approve_attendance_day_resolution_v2'],
 ['20260924180500_missing_punch_financial_and_cycle_guard_v2.sql','resolve_missing_punch_incident_v1'],
 ['20261009104500_attendance_review_triage_contract_v1.sql','dawaa_attendance_review_triage_v1'],
 ];
 for(const [file,name]of more)await pool.query(functionSql(file,name));
 await pool.query(readMigration('20261025120000_attendance_dated_shift_decision_v1.sql'));
 await pool.query(readMigration('20261025140000_attendance_inline_command_security.sql'));
 await pool.query(`alter table attendance_daily_summary enable row level security;alter table staff_attendance_logs enable row level security;
 alter table staff_time_off_requests enable row level security;alter table staff_time_off_audit enable row level security;
 revoke all on all tables in schema public from anon,authenticated;
 grant usage on schema public to anon,authenticated,service_role;
 insert into staff(id,name,role,branch) values($1,'موظف محلي','pharmacist','فرع الشامي'),($2,'موظف آخر','pharmacist','فرع شكري');`,[staff,otherStaff]);
 await pool.query(`insert into staff_accounts(id,staff_id,username,name,role,branch,permissions) values
 ($1,null,'local_manager','مدير محلي','branch_manager','فرع الشامي','{"manage_time_off":true,"approve_leave_request":true,"manage_payroll":true}'),
 ($2,$4,'local_employee','موظف محلي','doctor','فرع الشامي','{}'),
 ($3,null,'local_other_manager','مدير فرع آخر','branch_manager','فرع شكري','{"manage_time_off":true,"manage_payroll":true}')`,[manager,employee,outsider,staff]);
 for(const [id,t]of [[manager,token],[employee,employeeToken],[outsider,outsiderToken]])await pool.query("insert into staff_login_sessions(staff_account_id,token_hash,expires_at) values($1,encode(extensions.digest($2,'sha256'),'hex'),now()+interval '12 hours')",[id,t]);
 await pool.query(`insert into attendance_policy_versions(policy_code,effective_from,late_grace_minutes,very_late_minutes,permission_limit_per_cycle,permission_max_minutes,weekly_off_allowance,authorized_absence_uncompensated_days,unauthorized_absence_days) values('fixture_policy','2026-01-01',15,30,20,120,4,2,4);
 insert into fixture_sync_watermarks values('فرع الشامي','2026-11-01'),('فرع شكري','2026-11-01');`);
}
export async function seedDay(pool,date,{target=staff,early=true,missing=false}={}){
 await pool.query(`insert into shift_schedules(staff_id,branch,day_name,shift_start,shift_end,start_time,end_time,effective_from,shift_date,date)
 values($1,'فرع الشامي',null,'09:00','17:00','09:00','17:00','2026-01-01',$2,$2)`,[target,date]);
 // Use a single dated fixture schedule so production precedence code is exercised.
 await pool.query(`insert into attendance_daily_summary(staff_id,attendance_date,status,candidate_hours,resolution_version,resolution_status,branch)
 values($1,$2,'pending_review',12,2,$3,'فرع الشامي')`,[target,date,missing?'missing_checkout':'early_leave_review']);
 await pool.query(`insert into staff_attendance_logs(staff_id,attendance_type,recorded_at,status)
 values($1,'check_in',($2::date+time '09:00') at time zone 'Africa/Cairo','accepted')`,[target,date]);
 if(!missing)await pool.query(`insert into staff_attendance_logs(staff_id,attendance_type,recorded_at,status)
 values($1,'check_out',($2::date+$3::time) at time zone 'Africa/Cairo','accepted')`,[target,date,early?'15:00':'17:00']);
}
export async function command(client,action,date,payload,{session=token,role='service_role',target=staff}={}){
 await client.query('begin');
 try{await client.query('set local role '+role);await client.query("select set_config('request.headers',$1,true)",[JSON.stringify({'x-dawaa-session-token':session})]);
 const r=await client.query('select attendance_inline_command_v1($1,$2,$3,$4) result',[action,target,date,payload]);await client.query('commit');return r.rows[0].result;
 }catch(e){await client.query('rollback');throw e;}
}
