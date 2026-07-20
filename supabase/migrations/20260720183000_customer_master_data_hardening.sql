-- Customer master data hardening
-- Mirrors the production-safe objects applied on 2026-07-20.

alter table public.customers
  add column if not exists normalized_phone text,
  add column if not exists normalized_name text,
  add column if not exists display_name text,
  add column if not exists effective_customer_code text,
  add column if not exists effective_branch text,
  add column if not exists customer_identity_key text,
  add column if not exists data_issues text[] not null default '{}',
  add column if not exists data_quality_score integer not null default 0,
  add column if not exists is_contactable boolean not null default false,
  add column if not exists data_quality_checked_at timestamptz;

create or replace function public.dawaa_normalize_egyptian_phone(p_value text)
returns text
language sql immutable parallel safe
set search_path to public
as $$
with x as (select regexp_replace(coalesce(p_value,''),'\D','','g') d)
select nullif(case
  when d like '0020%' then substring(d from 5)
  when d like '20%' then substring(d from 3)
  when length(d)=10 and d like '1%' then '0'||d
  else d end,'') from x
$$;

create or replace function public.dawaa_is_valid_egyptian_mobile(p_value text)
returns boolean
language sql immutable parallel safe
set search_path to public
as $$
select coalesce(public.dawaa_normalize_egyptian_phone(p_value) ~ '^(010|011|012|015)[0-9]{8}$', false)
$$;

create or replace function public.dawaa_clean_customer_display_name(p_value text)
returns text
language sql immutable parallel safe
set search_path to public
as $$
select nullif(trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
  coalesce(p_value,''), '\(\s*[pP]\s*[0-9]+\s*\)', ' ', 'g'),
  '\(\s*[0-9]+\s*%\s*\)', ' ', 'g'),
  '\+{2,}', ' ', 'g'), '\s+', ' ', 'g')), '')
$$;

create or replace function public.dawaa_customer_data_issues(
  p_name text, p_code text, p_phone text, p_branch text,
  p_is_duplicate boolean, p_merged_into uuid
)
returns text[]
language plpgsql immutable
set search_path to public
as $$
declare
  n text := lower(trim(coalesce(p_name,'')));
  p text := public.dawaa_normalize_egyptian_phone(p_phone);
  v text[] := '{}';
begin
  if nullif(trim(coalesce(p_code,'')),'') is null then v:=array_append(v,'missing_customer_code'); end if;
  if n='' then v:=array_append(v,'missing_customer_name'); end if;
  if n in ('عميل الصيدلية','عميل غير مسجل','غير محدد','غير معروف','عميل') or n ~ '^[0-9]+$' then
    v:=array_append(v,'placeholder_customer_name');
  end if;
  if coalesce(p_name,'') ~* '(\(\s*[pP]\s*[0-9]+\s*\)|[0-9]+\s*%|بوينت|تسوية|\+{2,})' then
    v:=array_append(v,'customer_name_contains_operational_data');
  end if;
  if p is null then v:=array_append(v,'missing_phone');
  elsif not public.dawaa_is_valid_egyptian_mobile(p) then v:=array_append(v,'invalid_phone'); end if;
  if nullif(trim(coalesce(p_branch,'')),'') is null or trim(p_branch) in ('غير محدد','متعدد الفروع') then
    v:=array_append(v,'branch_needs_review');
  end if;
  if coalesce(p_is_duplicate,false) or p_merged_into is not null then
    v:=array_append(v,'merged_or_duplicate_customer');
  end if;
  return v;
end
$$;

create or replace function public.dawaa_customers_quality_before_write()
returns trigger
language plpgsql
set search_path to public
as $$
declare n text; p text; k text; b text; v text[];
begin
  n:=coalesce(nullif(trim(new.name),''),nullif(trim(new.customer_name),''));
  p:=coalesce(nullif(trim(new.phone),''),nullif(trim(new.customer_phone),''),nullif(trim(new.mobile),''),nullif(trim(new.whatsapp_phone),''),nullif(trim(new.whatsapp),''));
  k:=coalesce(nullif(trim(new.customer_code),''),nullif(trim(new.code),''));
  b:=coalesce(nullif(trim(new.corrected_branch),''),nullif(trim(new.branch),''),nullif(trim(new.branch_name),''));
  new.normalized_phone:=public.dawaa_normalize_egyptian_phone(p);
  new.normalized_name:=lower(regexp_replace(trim(coalesce(n,'')),'\s+',' ','g'));
  new.display_name:=coalesce(public.dawaa_clean_customer_display_name(n),n,'عميل غير مسجل');
  new.effective_customer_code:=k;
  new.effective_branch:=b;
  new.is_contactable:=public.dawaa_is_valid_egyptian_mobile(new.normalized_phone)
    and not (coalesce(new.customer_status,'') in ('deceased','do_not_contact') or coalesce(new.status,'') in ('deceased','do_not_contact'));
  new.customer_identity_key:='id:'||new.id::text;
  v:=public.dawaa_customer_data_issues(n,k,new.normalized_phone,b,new.is_duplicate,new.merged_into_customer_id);
  new.data_issues:=v;
  new.data_quality_score:=greatest(0,100
    - case when 'missing_customer_code'=any(v) then 25 else 0 end
    - case when 'missing_customer_name'=any(v) or 'placeholder_customer_name'=any(v) then 25 else 0 end
    - case when 'missing_phone'=any(v) or 'invalid_phone'=any(v) then 25 else 0 end
    - case when 'branch_needs_review'=any(v) then 15 else 0 end
    - case when 'customer_name_contains_operational_data'=any(v) then 10 else 0 end);
  new.data_quality_status:=case
    when 'merged_or_duplicate_customer'=any(v) then 'merged'
    when 'missing_customer_code'=any(v) or 'missing_customer_name'=any(v) or 'placeholder_customer_name'=any(v) then 'critical'
    when 'missing_phone'=any(v) or 'invalid_phone'=any(v) or 'branch_needs_review'=any(v) then 'warning'
    else 'complete' end;
  new.data_quality_checked_at:=now();
  return new;
end
$$;

drop trigger if exists trg_dawaa_customers_quality_before_write on public.customers;
create trigger trg_dawaa_customers_quality_before_write
before insert or update of name,customer_name,customer_code,code,phone,customer_phone,mobile,whatsapp_phone,whatsapp,branch,branch_name,corrected_branch,is_duplicate,merged_into_customer_id,customer_status,status
on public.customers for each row execute function public.dawaa_customers_quality_before_write();

create unique index if not exists customers_active_unique_customer_code_uidx
on public.customers ((coalesce(nullif(trim(customer_code),''),nullif(trim(code),''))))
where coalesce(is_duplicate,false)=false
  and merged_into_customer_id is null
  and coalesce(nullif(trim(customer_code),''),nullif(trim(code),'')) is not null;

update public.customers set name=name;

create or replace view public.dawaa_customer_data_health_center_v2 as
select now() checked_at,
 count(*) filter(where coalesce(is_duplicate,false)=false) canonical_customers,
 count(*) filter(where coalesce(is_duplicate,false)=true or merged_into_customer_id is not null) merged_customers,
 count(*) filter(where data_quality_status='complete' and coalesce(is_duplicate,false)=false) complete_customers,
 count(*) filter(where data_quality_status='warning' and coalesce(is_duplicate,false)=false) warning_customers,
 count(*) filter(where data_quality_status='critical' and coalesce(is_duplicate,false)=false) critical_customers,
 count(*) filter(where 'missing_phone'=any(data_issues) and coalesce(is_duplicate,false)=false) missing_phone,
 count(*) filter(where 'invalid_phone'=any(data_issues) and coalesce(is_duplicate,false)=false) invalid_phone,
 count(*) filter(where 'branch_needs_review'=any(data_issues) and coalesce(is_duplicate,false)=false) branch_needs_review,
 count(*) filter(where 'customer_name_contains_operational_data'=any(data_issues) and coalesce(is_duplicate,false)=false) noisy_names,
 (select count(*) from public.customer_data_review_queue where status='pending') pending_reviews,
 (select count(*) from public.sales_invoices where customer_id is null) unlinked_invoices,
 (select count(*) from public.daily_followups where customer_id is null or trim(customer_id)='') unlinked_followups
from public.customers;

create or replace function public.update_customer_master_data_safe(
  p_customer_id uuid,
  p_name text default null,
  p_phone text default null,
  p_branch text default null,
  p_address text default null,
  p_area text default null,
  p_reason text default 'manual_data_review'
)
returns public.customers
language plpgsql security definer
set search_path to public
as $$
declare b jsonb; a public.customers;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select to_jsonb(c) into b from public.customers c where c.id=p_customer_id for update;
  if b is null then raise exception 'customer_not_found'; end if;
  update public.customers set
    name=coalesce(nullif(trim(p_name),''),name),
    customer_name=coalesce(nullif(trim(p_name),''),customer_name),
    phone=coalesce(nullif(trim(p_phone),''),phone),
    customer_phone=coalesce(nullif(trim(p_phone),''),customer_phone),
    mobile=coalesce(nullif(trim(p_phone),''),mobile),
    corrected_branch=coalesce(nullif(trim(p_branch),''),corrected_branch),
    branch_fix_status=case when nullif(trim(p_branch),'') is not null then 'manual_review_approved' else branch_fix_status end,
    address=coalesce(nullif(trim(p_address),''),address),
    area=coalesce(nullif(trim(p_area),''),area),
    updated_at=now()
  where id=p_customer_id returning * into a;
  insert into public.customer_data_change_log(customer_id,customer_code,operation,before_data,after_data,reason,changed_by)
  values(a.id,a.effective_customer_code,'safe_customer_master_update',b,to_jsonb(a),p_reason,auth.uid()::text);
  update public.customer_data_review_queue
  set status='resolved',reviewed_by=auth.uid()::text,reviewed_at=now(),updated_at=now()
  where customer_id=p_customer_id and status='pending' and issue_type<>'duplicate_valid_phone';
  return a;
end
$$;

revoke all on function public.update_customer_master_data_safe(uuid,text,text,text,text,text,text) from public;
grant execute on function public.update_customer_master_data_safe(uuid,text,text,text,text,text,text) to authenticated;
grant select on public.dawaa_customer_data_health_center_v2 to authenticated;
