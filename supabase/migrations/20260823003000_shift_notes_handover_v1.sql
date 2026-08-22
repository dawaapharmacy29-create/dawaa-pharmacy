create or replace function public.handover_open_shift_notes_v1(
  p_user_id text,
  p_user_name text,
  p_note text default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with updated as (
    update public.shift_notes n
       set handed_over = true,
           handed_over_at = now(),
           handed_over_by_id = nullif(btrim(coalesce(p_user_id, '')), ''),
           handed_over_by_name = coalesce(nullif(btrim(coalesce(p_user_name, '')), ''), 'النظام'),
           handover_note = nullif(btrim(coalesce(p_note, '')), ''),
           updated_at = now()
     where n.deleted_at is null
       and coalesce(n.status, '') not in ('completed','cancelled')
     returning n.id
  ), logged as (
    insert into public.shift_note_logs(note_id, action, actor_id, actor_name, details)
    select
      u.id,
      'handover',
      nullif(btrim(coalesce(p_user_id, '')), ''),
      coalesce(nullif(btrim(coalesce(p_user_name, '')), ''), 'النظام'),
      case when nullif(btrim(coalesce(p_note, '')), '') is null
           then 'تم تسليم الملحوظة للشيفت التالي'
           else 'تم تسليم الملحوظة للشيفت التالي: ' || btrim(p_note)
      end
    from updated u
    returning 1
  )
  select count(*) into v_count from logged;

  return v_count;
end;
$$;

grant execute on function public.handover_open_shift_notes_v1(text,text,text) to authenticated;
