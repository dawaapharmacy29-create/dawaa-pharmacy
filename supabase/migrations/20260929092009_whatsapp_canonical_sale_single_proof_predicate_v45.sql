-- V45: one sale-truth predicate across Customer Case -> Story/Recovery.
-- A human-confirmed outcome remains governance metadata, never an alternate sale-proof source.
-- The ONLY canonical sale predicate is case_json.canonicalSaleProof.state = 'proven'.

do $migration$
declare
  v_capture text;
  v_health text;
  v_capture_guard_old text :=
$old$  v_is_canonical :=
    new.confirmed_outcome='verified_sale'
    or coalesce(new.case_json #>> '{canonicalSaleProof,state}','')='proven';$old$;
  v_capture_guard_new text :=
$new$  v_is_canonical :=
    coalesce(new.case_json #>> '{canonicalSaleProof,state}','')='proven';$new$;
  v_capture_payload_old text :=
$old$      'canonicalSaleProofState',coalesce(
        new.case_json #>> '{canonicalSaleProof,state}',
        case when new.confirmed_outcome='verified_sale' then 'human_confirmed' else null end
      )$old$;
  v_capture_payload_new text :=
$new$      'canonicalSaleProofState',new.case_json #>> '{canonicalSaleProof,state}'$new$;
  v_health_old text :=
$old$        and (
          c.confirmed_outcome='verified_sale'
          or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
        )$old$;
  v_health_new text :=
$new$        and coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'$new$;
begin
  select pg_get_functiondef('public.dawaa_capture_whatsapp_canonical_purchase_v36()'::regprocedure)
    into v_capture;
  select pg_get_functiondef('public.dawaa_whatsapp_story_truth_health_v39()'::regprocedure)
    into v_health;

  if (length(v_capture)-length(replace(v_capture,v_capture_guard_old,''))) / nullif(length(v_capture_guard_old),0) <> 1 then
    raise exception 'unexpected_capture_guard_shape';
  end if;
  if (length(v_capture)-length(replace(v_capture,v_capture_payload_old,''))) / nullif(length(v_capture_payload_old),0) <> 1 then
    raise exception 'unexpected_capture_payload_shape';
  end if;
  if (length(v_health)-length(replace(v_health,v_health_old,''))) / nullif(length(v_health_old),0) <> 6 then
    raise exception 'unexpected_health_fallback_shape';
  end if;

  v_capture := replace(v_capture,v_capture_guard_old,v_capture_guard_new);
  v_capture := replace(v_capture,v_capture_payload_old,v_capture_payload_new);
  v_health := replace(v_health,v_health_old,v_health_new);

  if position('new.confirmed_outcome=''verified_sale''' in v_capture) <> 0 then
    raise exception 'capture_human_fallback_not_removed';
  end if;
  if position('c.confirmed_outcome=''verified_sale''' in v_health) <> 0 then
    raise exception 'health_human_fallback_not_removed';
  end if;

  execute v_capture;
  execute v_health;
end
$migration$;

revoke all on function public.dawaa_capture_whatsapp_canonical_purchase_v36()
from public, anon, authenticated;
grant execute on function public.dawaa_capture_whatsapp_canonical_purchase_v36()
to service_role;

revoke all on function public.dawaa_whatsapp_story_truth_health_v39()
from public, anon, authenticated;
grant execute on function public.dawaa_whatsapp_story_truth_health_v39()
to service_role;
