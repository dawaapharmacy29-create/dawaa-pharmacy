-- Owner decision 2026-11-24 («اعتمد التقييم اللي شغالين عليه للدكاترة»): the doctors' monthly evaluation (Evaluation
-- Lab v7) becomes the incentive payroll pays, once a manager approves it for the cycle.
--
-- 1) evaluation_cycle_approvals_v1 keeps what the lab showed when it was approved: score, tier, branch factor, hours
--    factor, absence cut, the earned incentive, the branch-target bonus, the branch star, the rank, the axes and the
--    recommendations. The payroll statement and its PDF read it back; nothing is recomputed on the server.
-- 2) approve_evaluation_cycle_v1 saves the rows (manage_payroll only; never over a finalized payroll) and refreshes
--    the list incentive of the cycle from the invoice lines.
-- 3) refresh_list_incentive_sales_v1 fills incentive_medicine_sales (empty until now, so the list incentive was 0 for
--    everyone) from get_list_incentive_invoice_lines_v1, eligible lines only, one row per seller and item.
-- 4) get_payroll_incentive_truth_v2: with an approved evaluation the performance incentive is the earned incentive,
--    the target bonus is the evaluation's branch bonus and the branch star is the evaluation's star; the old points
--    incentive and the follow-up / request threshold bonuses are not added on top (they are inside the score).
--    Without an approved evaluation nothing changes.

create table if not exists public.evaluation_cycle_approvals_v1 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  month_cycle text not null check (month_cycle ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  model_version text not null,
  family text not null default 'doctor',
  branch text,
  score numeric,
  tier_label text,
  tier_percent numeric,
  branch_achievement numeric,
  branch_factor numeric,
  hours_factor numeric,
  absence_days integer not null default 0,
  absence_cut numeric not null default 0,
  performance_egp numeric not null default 0,
  bonus_egp numeric not null default 0,
  star_egp numeric not null default 0,
  star jsonb,
  rank_in_branch integer,
  rank_in_branch_of integer,
  rank_overall integer,
  rank_overall_of integer,
  axes jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz not null default now(),
  unique (staff_id, month_cycle)
);
alter table public.evaluation_cycle_approvals_v1 enable row level security;
revoke all on public.evaluation_cycle_approvals_v1 from anon, authenticated;

create or replace function public.refresh_list_incentive_sales_v1(p_month_cycle text)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_start date;
  v_end date;
  v_rows integer := 0;
begin
  if coalesce(trim(p_month_cycle), '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_cycle' using errcode = '22023';
  end if;
  if not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_list_incentive_refresh' using errcode = '42501';
  end if;
  select cycle_start, cycle_end into v_start, v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle || '-25', 'YYYY-MM-DD'));

  -- A finalized payroll keeps the list it was paid on.
  delete from public.incentive_medicine_sales s
  where s.month_cycle = p_month_cycle and s.source_type = 'invoice_lines_v1'
    and not exists (select 1 from public.payroll_finalized_snapshots_v2 f
                    where f.staff_id = s.staff_id and f.month_cycle = p_month_cycle);

  insert into public.incentive_medicine_sales (
    medicine_id, product_name, doctor_id, doctor_name, branch, quantity, incentive_per_unit, incentive_total,
    sale_date, month_cycle, notes, staff_id, source_type, source_ref, created_by_name)
  select m.id, m.product_name, st.id::text, st.name, st.branch,
         round(sum(l.units), 2), max(l.rate), round(sum(l.units * l.rate), 2),
         max(l.sale_date), p_month_cycle, 'من سطور الفواتير — ' || count(*) || ' سطر', st.id,
         'invoice_lines_v1', p_month_cycle, 'تحديث تلقائي من الفواتير'
  from public.get_list_incentive_invoice_lines_v1(v_start, v_end, null) l
  join public.staff st on st.id::text = l.seller_id
  join public.incentive_medicines m on m.id::text = l.medicine_id
  where l.kind = 'list' and l.attribution = 'eligible'
    and not exists (select 1 from public.payroll_finalized_snapshots_v2 f
                    where f.staff_id = st.id and f.month_cycle = p_month_cycle)
  group by m.id, m.product_name, st.id, st.name, st.branch;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

create or replace function public.approve_evaluation_cycle_v1(p_month_cycle text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_saved integer := 0;
  v_skipped_finalized integer := 0;
  v_list integer := 0;
  v_row jsonb;
  v_staff uuid;
begin
  if coalesce(trim(p_month_cycle), '') !~ '^\d{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_evaluation_approval_input' using errcode = '22023';
  end if;
  if not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_evaluation_approval' using errcode = '42501';
  end if;
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  select coalesce(sa.staff_name, sa.name, sa.username) into v_actor_name from public.staff_accounts sa where sa.id = v_actor_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_staff := nullif(v_row->>'staff_id', '')::uuid;
    if v_staff is null or not exists (select 1 from public.staff s where s.id = v_staff) then
      continue;
    end if;
    if exists (select 1 from public.payroll_finalized_snapshots_v2 f where f.staff_id = v_staff and f.month_cycle = p_month_cycle) then
      v_skipped_finalized := v_skipped_finalized + 1;
      continue;
    end if;
    insert into public.evaluation_cycle_approvals_v1 as a (
      staff_id, month_cycle, model_version, family, branch, score, tier_label, tier_percent, branch_achievement,
      branch_factor, hours_factor, absence_days, absence_cut, performance_egp, bonus_egp, star_egp, star,
      rank_in_branch, rank_in_branch_of, rank_overall, rank_overall_of, axes, recommendations, details,
      approved_by, approved_by_name, approved_at)
    values (
      v_staff, p_month_cycle, coalesce(v_row->>'model_version', 'v7'), coalesce(v_row->>'family', 'doctor'),
      v_row->>'branch', nullif(v_row->>'score', '')::numeric, v_row->>'tier_label',
      nullif(v_row->>'tier_percent', '')::numeric, nullif(v_row->>'branch_achievement', '')::numeric,
      nullif(v_row->>'branch_factor', '')::numeric, nullif(v_row->>'hours_factor', '')::numeric,
      coalesce(nullif(v_row->>'absence_days', '')::integer, 0), coalesce(nullif(v_row->>'absence_cut', '')::numeric, 0),
      greatest(0, coalesce(nullif(v_row->>'performance_egp', '')::numeric, 0)),
      greatest(0, coalesce(nullif(v_row->>'bonus_egp', '')::numeric, 0)),
      greatest(0, coalesce(nullif(v_row->>'star_egp', '')::numeric, 0)),
      v_row->'star', nullif(v_row->>'rank_in_branch', '')::integer, nullif(v_row->>'rank_in_branch_of', '')::integer,
      nullif(v_row->>'rank_overall', '')::integer, nullif(v_row->>'rank_overall_of', '')::integer,
      coalesce(v_row->'axes', '[]'::jsonb), coalesce(v_row->'recommendations', '[]'::jsonb),
      coalesce(v_row->'details', '{}'::jsonb), v_actor_id, v_actor_name, now())
    on conflict (staff_id, month_cycle) do update set
      model_version = excluded.model_version, family = excluded.family, branch = excluded.branch, score = excluded.score,
      tier_label = excluded.tier_label, tier_percent = excluded.tier_percent,
      branch_achievement = excluded.branch_achievement, branch_factor = excluded.branch_factor,
      hours_factor = excluded.hours_factor, absence_days = excluded.absence_days, absence_cut = excluded.absence_cut,
      performance_egp = excluded.performance_egp, bonus_egp = excluded.bonus_egp, star_egp = excluded.star_egp,
      star = excluded.star, rank_in_branch = excluded.rank_in_branch, rank_in_branch_of = excluded.rank_in_branch_of,
      rank_overall = excluded.rank_overall, rank_overall_of = excluded.rank_overall_of, axes = excluded.axes,
      recommendations = excluded.recommendations, details = excluded.details,
      approved_by = excluded.approved_by, approved_by_name = excluded.approved_by_name, approved_at = now();
    v_saved := v_saved + 1;
  end loop;

  v_list := public.refresh_list_incentive_sales_v1(p_month_cycle);

  return jsonb_build_object('month_cycle', p_month_cycle, 'saved', v_saved,
    'skipped_finalized', v_skipped_finalized, 'list_rows', v_list, 'approved_by_name', v_actor_name);
end;
$function$;

create or replace function public.list_evaluation_cycle_approvals_v1(p_month_cycle text)
returns setof public.evaluation_cycle_approvals_v1
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
begin
  if not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_evaluation_approvals' using errcode = '42501';
  end if;
  return query select * from public.evaluation_cycle_approvals_v1 a where a.month_cycle = p_month_cycle
    order by a.branch, a.rank_in_branch nulls last;
end;
$function$;

-- The payroll manager, or the employee himself (his own statement).
create or replace function public.get_evaluation_cycle_approval_v1(p_staff_id uuid, p_month_cycle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_row public.evaluation_cycle_approvals_v1%rowtype;
  v_list jsonb;
begin
  if not (public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id)
          or public.dawaa_current_attendance_subject_id() = p_staff_id) then
    raise exception 'not_authorized_for_evaluation_approval' using errcode = '42501';
  end if;
  select * into v_row from public.evaluation_cycle_approvals_v1 a where a.staff_id = p_staff_id and a.month_cycle = p_month_cycle;
  select coalesce(jsonb_agg(jsonb_build_object('product_name', s.product_name, 'quantity', s.quantity,
           'incentive_per_unit', s.incentive_per_unit, 'incentive_total', s.incentive_total) order by s.incentive_total desc), '[]'::jsonb)
    into v_list
  from public.incentive_medicine_sales s where s.staff_id = p_staff_id and s.month_cycle = p_month_cycle;
  return jsonb_build_object('approved', v_row.id is not null, 'approval', case when v_row.id is null then null else to_jsonb(v_row) end,
                            'list_items', v_list);
end;
$function$;

create or replace function public.get_payroll_incentive_truth_v2(p_staff_id uuid, p_month_cycle text)
returns table(staff_id uuid, month_cycle text, profile_configured boolean, performance_source text, points_incentive_egp numeric,
  competition_bonus_egp numeric, manager_evaluation_incentive_egp numeric, performance_incentive_egp numeric,
  target_bonus_egp numeric, followup_threshold_bonus_egp numeric, customer_request_threshold_bonus_egp numeric,
  branch_star_bonus_egp numeric, automated_incentives_total_egp numeric, excluded_manager_evaluation_due_to_points_profile boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_username text;
  v_profile_configured boolean := false;
  v_points_incentive numeric := 0;
  v_competition_bonus numeric := 0;
  v_manager_eval numeric := 0;
  v_target numeric := 0;
  v_followup numeric := 0;
  v_customer_request numeric := 0;
  v_branch_star numeric := 0;
  v_performance numeric := 0;
  v_eval public.evaluation_cycle_approvals_v1%rowtype;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid payroll incentive truth input' using errcode='22023';
  end if;

  select sa.username into v_username
  from public.staff_accounts sa
  where sa.staff_id = p_staff_id::text and coalesce(sa.active,true)=true and coalesce(sa.can_login,true)=true
  order by sa.created_at nulls last
  limit 1;

  if v_username is null or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not authorized to read payroll incentive truth' using errcode='42501';
  end if;

  select * into v_eval from public.evaluation_cycle_approvals_v1 a
  where a.staff_id = p_staff_id and a.month_cycle = p_month_cycle;

  select coalesce(t.profile_configured,false), coalesce(t.points_incentive_egp,0), coalesce(t.competition_bonus_egp,0)
  into v_profile_configured, v_points_incentive, v_competition_bonus
  from public.dawaa_staff_points_truth_v2(p_staff_id,p_month_cycle) t
  limit 1;

  if not v_profile_configured then
    v_points_incentive := 0;
    v_competition_bonus := 0;
  end if;

  select
    coalesce(sum(et.amount) filter(where et.source='manager_evaluation_settlement'),0),
    coalesce(sum(et.amount) filter(where et.source='target_achievement_settlement'),0),
    coalesce(sum(et.amount) filter(where et.source='doctor_followup_threshold_bonus'),0),
    coalesce(sum(et.amount) filter(where et.source='doctor_customer_request_threshold_bonus'),0),
    coalesce(sum(et.amount) filter(where et.source='branch_star_of_month'),0)
  into v_manager_eval,v_target,v_followup,v_customer_request,v_branch_star
  from public.employee_transactions et
  where et.staff_id=p_staff_id and et.month_cycle=p_month_cycle and et.status in ('active','approved')
    and et.source in ('manager_evaluation_settlement','target_achievement_settlement','doctor_followup_threshold_bonus',
                      'doctor_customer_request_threshold_bonus','branch_star_of_month');

  if v_eval.id is not null then
    -- The approved monthly evaluation is the whole performance pay of the cycle (no double count).
    return query select p_staff_id, p_month_cycle, v_profile_configured, 'evaluation_v7'::text,
      0::numeric, 0::numeric, 0::numeric, v_eval.performance_egp, v_eval.bonus_egp, 0::numeric, 0::numeric,
      v_eval.star_egp, v_eval.performance_egp + v_eval.bonus_egp + v_eval.star_egp, false;
    return;
  end if;

  v_performance := case when v_profile_configured then v_points_incentive + v_competition_bonus else v_manager_eval end;

  return query select p_staff_id, p_month_cycle, v_profile_configured,
    case when v_profile_configured then 'points' when v_manager_eval<>0 then 'manager_evaluation' else 'none' end,
    v_points_incentive, v_competition_bonus, v_manager_eval, v_performance, v_target, v_followup, v_customer_request,
    v_branch_star, v_performance + v_target + v_followup + v_customer_request + v_branch_star,
    (v_profile_configured and v_manager_eval<>0);
end;
$function$;

grant execute on function public.refresh_list_incentive_sales_v1(text) to anon, authenticated;
grant execute on function public.approve_evaluation_cycle_v1(text, jsonb) to anon, authenticated;
grant execute on function public.list_evaluation_cycle_approvals_v1(text) to anon, authenticated;
grant execute on function public.get_evaluation_cycle_approval_v1(uuid, text) to anon, authenticated;
