-- Customer request points: eligibility the recording doctor controls (owner decision 2026-10-29).
--
-- Before: a request needed customer_id AND customer_code AND product_code. Synced requests never
-- carry product_code, so no request was ever credited.
-- After (registration and achievement):
--   * a known customer: customer_code OR a customer phone (digits);
--   * medicine_name (product_code is filled later during execution, never required);
--   * not cancelled, not a sync conflict, not marked duplicate in the notes;
--   * not a repeat of the same customer + medicine registered in the previous 7 days.
-- Who is credited, tiers, policy points and the event/transaction ledger are unchanged.
--
-- backfill_customer_request_points_v1 settles requests from the previous cycle onward only
-- (created_at >= 2026-09-26 Cairo); it is idempotent per (request, event, policy version) and is
-- run separately after approval, never by this migration.
-- Verified by scripts/verification/test-customer-request-points-eligibility-native.mjs.
--
-- Rollback: restore the previous settle_customer_request_doctor_points body; drop the backfill function.

begin;

create or replace function public.customer_request_customer_key_v1(p_request customer_requests)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  -- A real customer code (not a placeholder of zeros/dashes) or a phone of at least 8 digits.
  select coalesce(
    case when trim(coalesce(p_request.customer_code, '')) !~ '^[0\s.\-]*$' then trim(p_request.customer_code) end,
    case when length(regexp_replace(coalesce(p_request.customer_phone, ''), '[^0-9]', '', 'g')) >= 8
      then regexp_replace(p_request.customer_phone, '[^0-9]', '', 'g') end
  )
$function$;

create or replace function public.settle_customer_request_doctor_points(p_request_id uuid, p_event_key text, p_event_at timestamp with time zone default now())
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_request public.customer_requests%rowtype; v_staff_id uuid; v_staff record; v_tier_key text; v_policy record; v_points numeric(8,2); v_event_id uuid; v_txn_id uuid; v_cycle text; v_title text; v_reason text; v_customer_key text;
begin
 if p_event_key not in ('request_registered','request_achieved') then raise exception 'invalid customer request incentive event: %',p_event_key; end if;
 select * into v_request from public.customer_requests where id=p_request_id; if not found then return null; end if;
 v_customer_key := public.customer_request_customer_key_v1(v_request);
 if v_customer_key is null
    or nullif(trim(coalesce(v_request.medicine_name,'')),'') is null
    or lower(coalesce(v_request.status,'')) = 'cancelled'
    or coalesce(v_request.sync_conflict,false)
    or coalesce(v_request.doctor_notes,'') ~* '(مكرر|بالخطأ|duplicate)'
    or coalesce(v_request.source_notes,'') ~* '(مكرر|بالخطأ|duplicate)' then return null; end if;
 -- A repeat of the same customer and medicine within 7 days is one request.
 if exists (
   select 1 from public.customer_requests p
   where p.id <> v_request.id
     and p.created_at < v_request.created_at
     and p.created_at > v_request.created_at - interval '7 days'
     and lower(coalesce(p.status,'')) <> 'cancelled'
     and public.customer_request_customer_key_v1(p) = v_customer_key
     and lower(trim(p.medicine_name)) = lower(trim(v_request.medicine_name))
 ) then return null; end if;
 v_staff_id:=public.resolve_customer_request_registrar_staff_id(v_request); if v_staff_id is null then return null; end if;
 select s.id,s.name,s.branch into v_staff from public.staff s where s.id=v_staff_id; if not found then return null; end if;
 select sit.tier_key into v_tier_key from public.staff_incentive_tiers sit where sit.staff_id=v_staff_id and sit.tier_key in ('senior_doctor','mid_doctor','assistant') order by sit.updated_at desc nulls last,sit.created_at desc nulls last limit 1; if v_tier_key is null then return null; end if;
 select * into v_policy from public.customer_request_incentive_policy p where p.active=true and p.tier_key=v_tier_key and p.effective_from<=p_event_at order by p.effective_from desc,p.policy_version desc limit 1; if not found then return null; end if;
 select e.id into v_event_id from public.customer_request_incentive_events e where e.request_id=p_request_id and e.event_key=p_event_key and e.policy_version=v_policy.policy_version limit 1; if v_event_id is not null then return v_event_id; end if;
 v_points:=case when p_event_key='request_registered' then v_policy.registration_points else v_policy.achievement_points end; if v_points is null or v_points<=0 then return null; end if;
 insert into public.customer_request_incentive_events(request_id,event_key,staff_id,tier_key,points,policy_version,event_at,metadata) values(p_request_id,p_event_key,v_staff_id,v_tier_key,v_points,v_policy.policy_version,p_event_at,jsonb_build_object('customer_code',v_request.customer_code,'customer_key',v_customer_key,'product_code',v_request.product_code,'medicine_name',v_request.medicine_name,'branch',v_request.branch,'policy_version',v_policy.policy_version,'attribution_locked_at_settlement',true,'eligibility_version','v2')) on conflict (request_id,event_key,policy_version) do nothing returning id into v_event_id;
 if v_event_id is null then select e.id into v_event_id from public.customer_request_incentive_events e where e.request_id=p_request_id and e.event_key=p_event_key and e.policy_version=v_policy.policy_version limit 1; return v_event_id; end if;
 v_cycle:=public.customer_request_cycle_label(p_event_at); v_title:=case when p_event_key='request_registered' then 'تسجيل طلب عميل' else 'تحقيق طلب عميل' end; v_reason:=v_title||' — '||coalesce(v_request.medicine_name,'صنف')||' — '||v_points||' نقطة';
 insert into public.employee_transactions(staff_id,employee_id,employee_name,type,title,reason,amount,points,points_delta,source,source_id,transaction_date,created_at,description,month_cycle,branch,status,category,employee_visible,created_by,metadata) values(v_staff_id,v_staff_id,v_staff.name,'reward',v_title,v_reason,0,v_points,v_points,'customer_request_incentive',v_event_id,(p_event_at at time zone 'Africa/Cairo')::date,p_event_at,v_reason,v_cycle,coalesce(v_request.branch,v_staff.branch),'approved','customer_requests',true,'system_automation',jsonb_build_object('request_id',p_request_id,'event_key',p_event_key,'tier_key',v_tier_key,'policy_version',v_policy.policy_version,'customer_code',v_request.customer_code,'customer_key',v_customer_key,'product_code',v_request.product_code,'medicine_name',v_request.medicine_name,'eligibility_version','v2')) returning id into v_txn_id;
 update public.customer_request_incentive_events set employee_transaction_id=v_txn_id where id=v_event_id; return v_event_id;
end $function$;

-- Backfill for the previous and current cycles only; run separately after approval.
create or replace function public.backfill_customer_request_points_v1(p_from timestamptz default '2026-09-25 21:00:00+00')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request record;
  v_registered integer := 0;
  v_achieved integer := 0;
begin
  if p_from < '2026-09-25 21:00:00+00'::timestamptz then
    raise exception 'backfill is limited to the previous and current cycles (from 2026-09-26 Cairo)';
  end if;
  for v_request in
    select id, status, requested_at, created_at, closed_at, updated_at
    from public.customer_requests
    where created_at >= p_from
    order by created_at, id
  loop
    if public.settle_customer_request_doctor_points(v_request.id, 'request_registered', coalesce(v_request.requested_at, v_request.created_at)) is not null then
      v_registered := v_registered + 1;
    end if;
    if lower(coalesce(v_request.status, '')) in ('available','arrived','customer_contacted','delivered','closed') then
      if public.settle_customer_request_doctor_points(v_request.id, 'request_achieved', coalesce(v_request.closed_at, v_request.updated_at, v_request.created_at)) is not null then
        v_achieved := v_achieved + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('from', p_from, 'registered_events', v_registered, 'achieved_events', v_achieved);
end;
$function$;

revoke all on function public.backfill_customer_request_points_v1(timestamptz) from public, anon, authenticated;

commit;
