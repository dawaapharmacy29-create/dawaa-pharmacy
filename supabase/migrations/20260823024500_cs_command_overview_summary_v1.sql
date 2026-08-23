create or replace function public.get_cs_command_overview_v1(p_branch text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with scoped as (
  select
    coalesce(nullif(btrim(contact_status),''), nullif(btrim(followup_status),''), nullif(btrim(response_status),''), nullif(btrim(status),''), nullif(btrim(followup_result),''), '') as state,
    next_followup_date,
    needs_manager,
    btrim(coalesce(customer_code,'')) as customer_code,
    regexp_replace(regexp_replace(coalesce(customer_phone, phone, ''), '\D', '', 'g'), '^20(?=1[0-9]{9}$)', '') as phone_digits
  from public.daily_followups
  where is_hidden = false
    and completed_at is null
    and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل','all') or branch=p_branch)
)
select jsonb_build_object(
  'open', count(*) filter (where state='' or state = any(array['pending','معلق','مؤجل','لم يرد','في انتظار الرد','تم إرسال رسالة','waiting_reply','message_sent','no_answer'])),
  'waiting', count(*) filter (where state = any(array['في انتظار الرد','تم إرسال رسالة','waiting_reply','message_sent'])),
  'no_answer', count(*) filter (where state = any(array['لم يرد','no_answer'])),
  'overdue', count(*) filter (where next_followup_date is not null and next_followup_date::date < current_date),
  'manager_needed', count(*) filter (where needs_manager is true),
  'bad_data', count(*) filter (where customer_code='' or phone_digits !~ '^01[0125][0-9]{8}$')
)
from scoped;
$$;

revoke all on function public.get_cs_command_overview_v1(text) from public;
grant execute on function public.get_cs_command_overview_v1(text) to authenticated;
