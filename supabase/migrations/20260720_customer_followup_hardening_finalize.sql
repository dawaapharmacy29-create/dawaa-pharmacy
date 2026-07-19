begin;

create schema if not exists internal_audit;
revoke all on schema internal_audit from public, anon, authenticated;

create table if not exists internal_audit.daily_followups_before_hardening_20260720 as
select * from public.daily_followups;
revoke all on table internal_audit.daily_followups_before_hardening_20260720 from public, anon, authenticated;

alter table public.daily_followups
  add column if not exists canonical_followup_id text,
  add column if not exists data_quality_status text,
  add column if not exists data_issues text[] default '{}'::text[];

alter table public.daily_followups disable trigger user;

update public.daily_followups
set followup_result = coalesce(nullif(trim(followup_result), ''), nullif(trim(contact_result), ''), 'مكتملة - تحتاج مراجعة النتيجة'),
    contact_result = coalesce(nullif(trim(contact_result), ''), nullif(trim(followup_result), ''), 'مكتملة - تحتاج مراجعة النتيجة'),
    followup_summary = case
      when length(trim(coalesce(followup_summary, evaluation_summary, followup_notes, notes, ''))) >= 10
        then coalesce(nullif(trim(followup_summary), ''), nullif(trim(evaluation_summary), ''), nullif(trim(followup_notes), ''), nullif(trim(notes), ''))
      else 'متابعة مكتملة قديمة وتحتاج مراجعة تفاصيل النتيجة'
    end,
    evaluation_summary = case
      when length(trim(coalesce(evaluation_summary, followup_summary, followup_notes, notes, ''))) >= 10
        then coalesce(nullif(trim(evaluation_summary), ''), nullif(trim(followup_summary), ''), nullif(trim(followup_notes), ''), nullif(trim(notes), ''))
      else 'متابعة مكتملة قديمة وتحتاج مراجعة تفاصيل النتيجة'
    end,
    data_issues = array_append(coalesce(data_issues, '{}'::text[]), 'المتابعة القديمة كانت مكتملة بدون نتيجة رسمية'),
    data_quality_status = 'warning',
    updated_at = now()
where (
    completed_at is not null
    or lower(coalesce(status,'')) in ('completed','closed','تم')
    or lower(coalesce(followup_status,'')) in ('completed','تم','تم التواصل')
  )
  and coalesce(nullif(trim(followup_result),''), nullif(trim(contact_result),'')) is null;

update public.daily_followups
set canonical_followup_id = coalesce(duplicate_of, id),
    data_issues = array_remove(array_remove(array_remove(coalesce(data_issues, '{}'::text[]), 'رقم الهاتف غير صالح أو مفقود'), 'الفرع يحتاج مراجعة'), 'مقدم الطلب غير محدد'),
    updated_at = coalesce(updated_at, now());

update public.daily_followups
set data_issues = coalesce(data_issues, '{}'::text[])
  || case when public.normalize_followup_phone(coalesce(customer_phone, phone, '')) !~ '^01[0125][0-9]{8}$' then array['رقم الهاتف غير صالح أو مفقود']::text[] else '{}'::text[] end
  || case when branch is null or trim(branch) = '' or branch in ('غير محدد','متعدد الفروع') then array['الفرع يحتاج مراجعة']::text[] else '{}'::text[] end
  || case when nullif(trim(coalesce(created_by_name, requested_by, assigned_doctor, '')), '') is null then array['مقدم الطلب غير محدد']::text[] else '{}'::text[] end,
    data_quality_status = case
      when public.normalize_followup_phone(coalesce(customer_phone, phone, '')) !~ '^01[0125][0-9]{8}$' then 'critical'
      when branch is null or trim(branch) = '' or branch in ('غير محدد','متعدد الفروع')
        or nullif(trim(coalesce(created_by_name, requested_by, assigned_doctor, '')), '') is null
        or cardinality(coalesce(data_issues, '{}'::text[])) > 0 then 'warning'
      else 'complete'
    end,
    updated_at = now();

alter table public.daily_followups enable trigger user;

create unique index if not exists daily_followups_one_visible_open_case_uidx
on public.daily_followups(identity_key, coalesce(nullif(trim(branch),''),'غير محدد'))
where identity_key is not null
  and coalesce(is_hidden,false)=false
  and coalesce(is_duplicate,false)=false
  and duplicate_of is null
  and completed_at is null
  and cancelled_at is null
  and archived_at is null
  and lower(coalesce(status,'')) not in ('completed','cancelled','archived','closed','merged_duplicate','تم','ملغي')
  and lower(coalesce(followup_status,'')) not in ('completed','تم','تم التواصل','تم الشراء بعد المتابعة','ملغي');

create or replace function public.create_or_link_customer_followup(p_payload jsonb)
returns public.daily_followups
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.daily_followups;
begin
  insert into public.daily_followups
  select * from jsonb_populate_record(null::public.daily_followups, p_payload)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.create_or_link_customer_followup(jsonb) from public;
grant execute on function public.create_or_link_customer_followup(jsonb) to authenticated;

commit;
