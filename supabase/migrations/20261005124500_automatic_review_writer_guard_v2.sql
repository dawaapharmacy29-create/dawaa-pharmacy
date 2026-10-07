-- Automatic conversation-review writer guard V2.
-- System-generated review evidence is service-owned. Human managers may annotate the same row only
-- through the manager_review_* fields; they may not rewrite the automatic score/evidence payload.

create or replace function public.dawaa_guard_automatic_conversation_review_writer_v2()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
declare
  v_privileged boolean := current_user in ('postgres','service_role','supabase_admin');
  v_old_system jsonb;
  v_new_system jsonb;
begin
  if v_privileged then
    return new;
  end if;

  if tg_op='INSERT' then
    if lower(trim(coalesce(new.evaluation_kind,'')))='automatic' then
      raise exception 'automatic_conversation_review_is_system_owned'
        using errcode='42501';
    end if;
    return new;
  end if;

  if lower(trim(coalesce(old.evaluation_kind,'')))='automatic'
     or lower(trim(coalesce(new.evaluation_kind,'')))='automatic' then
    -- Human review is an annotation layer, never a rewrite of system evidence.
    v_old_system := to_jsonb(old) - array[
      'manager_review_score',
      'manager_review_notes',
      'manager_reviewed_by',
      'manager_reviewed_at',
      'updated_at'
    ];
    v_new_system := to_jsonb(new) - array[
      'manager_review_score',
      'manager_review_notes',
      'manager_reviewed_by',
      'manager_reviewed_at',
      'updated_at'
    ];

    if v_new_system is distinct from v_old_system then
      raise exception 'automatic_conversation_review_evidence_is_immutable_for_client'
        using errcode='42501';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.dawaa_guard_automatic_conversation_review_writer_v2()
  from public,anon,authenticated;
grant execute on function public.dawaa_guard_automatic_conversation_review_writer_v2()
  to service_role;

drop trigger if exists automatic_conversation_review_writer_guard_v2
  on public.conversation_sales_reviews;
create trigger automatic_conversation_review_writer_guard_v2
before insert or update
on public.conversation_sales_reviews
for each row
execute function public.dawaa_guard_automatic_conversation_review_writer_v2();

comment on function public.dawaa_guard_automatic_conversation_review_writer_v2() is
  'Automatic conversation evidence is system-owned. Client users may only annotate automatic rows through manager_review_* fields.';

notify pgrst,'reload schema';
