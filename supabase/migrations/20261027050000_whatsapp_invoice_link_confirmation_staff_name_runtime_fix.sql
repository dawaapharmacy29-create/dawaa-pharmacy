-- Production staff_accounts has staff_name and name, but no display_name.
-- Repair the already-installed confirmation RPC without changing its
-- authorization, invoice identity checks, or existing EXECUTE grants.
do $migration$
declare
  v_definition text;
begin
  if to_regprocedure('public.dawaa_confirm_whatsapp_invoice_link_v1(uuid,text,text,text)') is null then
    raise exception 'invoice_confirmation_rpc_missing';
  end if;

  select pg_get_functiondef('public.dawaa_confirm_whatsapp_invoice_link_v1(uuid,text,text,text)'::regprocedure)
    into v_definition;

  if position('v_actor.display_name' in v_definition) > 0 then
    v_definition := replace(v_definition, 'v_actor.display_name', 'v_actor.name');
    execute v_definition;
  end if;

  if position('v_actor.display_name' in
      pg_get_functiondef('public.dawaa_confirm_whatsapp_invoice_link_v1(uuid,text,text,text)'::regprocedure)) > 0 then
    raise exception 'staff_name_runtime_fix_incomplete';
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
