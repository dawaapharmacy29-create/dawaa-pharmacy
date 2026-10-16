-- decide_overtime_approval_v3 changed after review (no internal authorization): the grant must be refused.
create or replace function public.decide_overtime_approval_v3(p_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $function$
begin
  update public.staff_overtime_approvals set status = p_decision where id = p_id;
  return jsonb_build_object('success', true);
end;
$function$;
