begin;

create table if not exists public.customer_followup_audit_log (
  id bigserial primary key,
  followup_id text,
  customer_id text,
  action text not null,
  actor_staff_id text,
  actor_name text,
  branch text,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_followup_audit_log_followup_idx on public.customer_followup_audit_log(followup_id, created_at desc);
create index if not exists customer_followup_audit_log_branch_idx on public.customer_followup_audit_log(branch, created_at desc);
revoke all on public.customer_followup_audit_log from public;
grant select on public.customer_followup_audit_log to anon, authenticated;

create or replace function public.audit_daily_followup_change_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id text;
  v_actor_name text;
  v_action text;
  v_customer_id text;
begin
  if tg_op = 'INSERT' then
    v_actor_id := coalesce(new.updated_by::text, new.created_by::text);
    v_actor_name := coalesce(new.created_by_name, new.responsible_name);
    v_customer_id := new.customer_id::text;
    v_action := 'created';
  else
    v_actor_id := coalesce(new.updated_by::text, new.created_by::text, old.updated_by::text, old.created_by::text);
    v_actor_name := coalesce(new.created_by_name, new.responsible_name, old.created_by_name, old.responsible_name);
    v_customer_id := coalesce(new.customer_id::text, old.customer_id::text);
    if new.completed_at is distinct from old.completed_at and new.completed_at is not null then
      v_action := 'completed';
    elsif new.cancelled_at is distinct from old.cancelled_at and new.cancelled_at is not null then
      v_action := 'cancelled';
    elsif new.archived_at is distinct from old.archived_at and new.archived_at is not null then
      v_action := 'archived';
    elsif new.branch is distinct from old.branch or new.customer_name is distinct from old.customer_name or new.customer_code is distinct from old.customer_code or new.customer_phone is distinct from old.customer_phone then
      v_action := 'customer_data_corrected';
    else
      v_action := 'updated';
    end if;
  end if;

  insert into public.customer_followup_audit_log(followup_id,customer_id,action,actor_staff_id,actor_name,branch,old_values,new_values)
  values(new.id::text,v_customer_id,v_action,v_actor_id,v_actor_name,new.branch,case when tg_op='INSERT' then null else to_jsonb(old)-array['customer_metrics'] end,to_jsonb(new)-array['customer_metrics']);
  return new;
end;
$$;

drop trigger if exists trg_audit_daily_followup_change_v1 on public.daily_followups;
create trigger trg_audit_daily_followup_change_v1 after insert or update on public.daily_followups for each row execute function public.audit_daily_followup_change_v1();

commit;
